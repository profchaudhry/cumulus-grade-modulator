'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ParsedCourse, Ranges, computeSuggestion, STANDARD_GRADING } from '@/lib/types'

interface SessionListItem {
  id: string
  pdf_name: string
  created_at: string
  course_code: string
  course_title: string
  teacher_name: string
  class: string
}

export default function Home() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [ranges, setRanges] = useState<Ranges>({ a: 3, other: 1, f: 3 })
  const [step, setStep] = useState<'upload' | 'ranges' | 'processing'>('upload')
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsFetched, setSessionsFetched] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Delete this session and all its student data?')) return
    setDeletingId(id)
    await supabase.from('students').delete().eq('session_id', id)
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeletingId(null)
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    const { data } = await supabase
      .from('sessions')
      .select('id, pdf_name, created_at, course_code, course_title, teacher_name, class')
      .order('created_at', { ascending: false })
      .limit(10)
    setSessions(data || [])
    setLoadingSessions(false)
    setSessionsFetched(true)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Please upload a PDF file.'); return }
    if (f.size > 20 * 1024 * 1024) { setError('PDF is too large (max 20MB). Try splitting it into smaller files.'); return }
    setFile(f); setStep('ranges'); setError('')
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Please upload a PDF file.'); return }
    if (f.size > 20 * 1024 * 1024) { setError('PDF is too large (max 20MB). Try splitting it into smaller files.'); return }
    setFile(f); setStep('ranges'); setError('')
  }

  const handleProcess = async () => {
    if (!file) return
    setStep('processing')
    setError('')
    try {
      // 1. Parse PDF
      const fd = new FormData()
      fd.append('pdf', file)
      const res = await fetch('/api/parse-pdf', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'PDF parsing failed')

      const courses: ParsedCourse[] = json.courses
      if (!courses.length) throw new Error('No courses found in PDF')

      // Use metadata from first course (most PDFs are one course across multiple roadmaps)
      const first = courses[0]

      // Sanity check: if the PDF actually contains multiple DIFFERENT courses
      // (not just roadmap variants of the same course), warn — only the first
      // course's metadata is stored on the session, but all students are still saved.
      const distinctCourseCodes = new Set(courses.map(c => c.course_code))
      if (distinctCourseCodes.size > 1) {
        console.warn(`PDF contains ${distinctCourseCodes.size} distinct course codes; only "${first.course_code}" metadata will be shown on the session header. All students from all courses are still saved.`)
      }

      // 2. Create session
      // Use the grading scheme from whichever course has one defined (most PDFs
      // repeat the same scheme per roadmap section, so the first non-empty one is authoritative)
      const schemeSource = courses.find(c => Object.keys(c.grading_scheme).length > 0)
      const sessionScheme = schemeSource ? schemeSource.grading_scheme : STANDARD_GRADING

      // Build a roadmap → grading scheme map so each section can display (and use)
      // its own scheme, since different roadmaps can technically carry different schemes
      const roadmapSchemes: Record<string, typeof sessionScheme> = {}
      courses.forEach(course => {
        if (course.roadmap && Object.keys(course.grading_scheme).length > 0) {
          roadmapSchemes[course.roadmap] = course.grading_scheme
        }
      })

      const { data: session, error: sErr } = await supabase
        .from('sessions')
        .insert({
          pdf_name: file.name,
          course_code: first.course_code,
          course_title: first.course_title,
          teacher_name: first.teacher_name,
          class: first.class_name,
          ranges,
          grading_scheme: sessionScheme,
          roadmap_schemes: roadmapSchemes,
        })
        .select()
        .single()
      if (sErr) throw sErr

      // 3. Insert all students with computed suggestions
      let globalOrder = 0
      const allStudents = courses.flatMap(course =>
        course.students.map((s, roadmapIdx) => {
          const scheme = Object.keys(course.grading_scheme).length > 0
            ? course.grading_scheme
            : STANDARD_GRADING
          const suggestion = computeSuggestion(s, ranges, scheme)
          globalOrder++
          return {
            session_id: session.id,
            enrollment: s.enrollment,
            reg_no: s.reg_no,
            name: s.name,
            assign_marks: s.assign_marks,
            quiz_marks: s.quiz_marks,
            mid_marks: s.mid_marks,
            final_marks: s.final_marks,
            total: s.total,
            original_grade: s.original_grade,
            roadmap: s.roadmap,
            pdf_row_order: globalOrder,
            roadmap_row_order: roadmapIdx + 1,
            suggested_addition: suggestion.suggested_addition,
            new_total: suggestion.new_total,
            new_grade: suggestion.new_grade,
          }
        })
      )

      const { error: stErr } = await supabase.from('students').insert(allStudents)
      if (stErr) throw stErr

      router.push(`/session/${session.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('ranges')
    }
  }

  const gradeColor = (g: string) => {
    if (g === 'A') return '#059669'
    if (g.startsWith('A')) return '#10B981'
    if (g.startsWith('B')) return '#2563EB'
    if (g.startsWith('C')) return '#D97706'
    if (g.startsWith('D')) return '#DC2626'
    return '#7C3AED'
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 50%, #0EA5E9 100%)' }}>
      {/* Header */}
      <header style={{ padding: '24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #38BDF8, #0EA5E9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, boxShadow: '0 4px 14px rgba(14,165,233,0.4)'
          }}>☁️</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>Cumulus</div>
            <div style={{ color: '#7DD3FC', fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Grade Modulator</div>
          </div>
        </div>
        <button
          onClick={() => { if (!sessionsFetched) loadSessions(); else setSessionsFetched(!sessionsFetched) }}
          style={{ color: '#7DD3FC', fontSize: 13, background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}
        >
          {sessionsFetched ? 'Hide' : 'Past Sessions'}
        </button>
      </header>

      {/* Past sessions dropdown */}
      {sessionsFetched && (
        <div style={{ margin: '0 40px 0', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 16 }}>
          {loadingSessions ? (
            <p style={{ color: '#7DD3FC', textAlign: 'center', padding: 16 }}>Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p style={{ color: '#7DD3FC', textAlign: 'center', padding: 16 }}>No past sessions found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={() => router.push(`/session/${s.id}`)}
                    style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 10, cursor: 'pointer', color: '#fff', textAlign: 'left', gap: 12 }}>
                    {/* Left: course info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                      <span style={{ color: '#38BDF8', fontWeight: 700, fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{s.course_code}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>·</span>
                      <span style={{ color: '#fff', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{s.course_title}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>·</span>
                      <span style={{ color: '#94A3B8', fontSize: 12, whiteSpace: 'nowrap' }}>{s.class}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>·</span>
                      <span style={{ color: '#7DD3FC', fontSize: 12, whiteSpace: 'nowrap' }}>{s.teacher_name}</span>
                    </div>
                    {/* Right: date + time */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: '#7DD3FC', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                      <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
                        {new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteSession(e, s.id)}
                    disabled={deletingId === s.id}
                    style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: deletingId === s.id ? '#475569' : '#FCA5A5', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    title="Delete session"
                  >
                    {deletingId === s.id ? '…' : '🗑'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hero */}
      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ color: '#fff', fontSize: 'clamp(32px,5vw,52px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: 16 }}>
            Intelligent Grade<br />
            <span style={{ background: 'linear-gradient(90deg, #38BDF8, #7DD3FC)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Modulation
            </span>
          </h1>
          <p style={{ color: '#94A3B8', fontSize: 16, maxWidth: 480, margin: '0 auto' }}>
            Upload an Award List PDF. Define your modulation ranges. See exactly which students should receive grade boosts — and by how much.
          </p>
        </div>

        <div style={{ width: '100%', maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Step 1: Upload */}
          <div style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: step === 'upload' ? '1px solid rgba(14,165,233,0.5)' : '1px solid rgba(255,255,255,0.1)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: file ? '#059669' : '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                {file ? '✓' : '1'}
              </span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>Upload Award List PDF</span>
            </div>
            <div style={{ padding: 24 }}>
              <label
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{
                  display: 'block', border: `2px dashed ${dragging ? '#38BDF8' : file ? '#059669' : 'rgba(148,163,184,0.3)'}`,
                  borderRadius: 12, padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
                  background: dragging ? 'rgba(14,165,233,0.1)' : file ? 'rgba(5,150,105,0.08)' : 'rgba(255,255,255,0.02)',
                  transition: 'all 0.2s'
                }}
              >
                <input type="file" accept=".pdf" onChange={onFileChange} style={{ display: 'none' }} />
                <div style={{ fontSize: 32, marginBottom: 10 }}>{file ? '✅' : '📄'}</div>
                {file ? (
                  <div>
                    <div style={{ color: '#10B981', fontWeight: 600, fontSize: 14 }}>{file.name}</div>
                    <div style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB · Click to change</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ color: '#94A3B8', fontWeight: 500, fontSize: 14 }}>Drop your PDF here or click to browse</div>
                    <div style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>Bahria University Award List format</div>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* Step 2: Ranges */}
          {(step === 'ranges' || step === 'processing') && (
            <div style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>2</span>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>Set Modulation Ranges</span>
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <p style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.6 }}>
                  Define how many marks within a range should trigger a grade boost. A student within <em>range</em> marks of the next grade boundary will be suggested an uplift.
                </p>

                {[
                  { key: 'a' as const, label: 'Grade A−→ A', sublabel: '80–84', desc: 'Marks gap for A− students to reach A (85)', color: '#059669', readonly: false },
                  { key: 'other' as const, label: 'Grades B+→ A−, D→ B+', sublabel: '50–79', desc: 'Marks gap to qualify for a one-grade uplift', color: '#2563EB', readonly: false },
                  { key: 'f' as const, label: 'Grade F → D', sublabel: '0–49', desc: 'Marks gap to suggest boosting out of F', color: '#7C3AED', readonly: false },
                ].map(({ key, label, sublabel, desc, color }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{label}</span>
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: color + '22', color, fontWeight: 600 }}>{sublabel}</span>
                      </div>
                      <div style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{desc}</div>
                    </div>
                    <input
                        type="number" min={1} max={15}
                        value={ranges[key]}
                        onChange={e => setRanges(r => ({ ...r, [key]: parseInt(e.target.value) || 1 }))}
                        style={{ width: 70, height: 38, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: `1px solid ${color}44`, color: '#fff', fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                      />
                  </div>
                ))}

                {/* Preview example */}
                <div style={{ padding: '12px 16px', background: 'rgba(14,165,233,0.08)', borderRadius: 10, border: '1px solid rgba(14,165,233,0.2)' }}>
                  <div style={{ color: '#7DD3FC', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>PREVIEW EXAMPLE</div>
                  <div style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.8 }}>
                    <strong style={{ color: '#7DD3FC' }}>A−→A range = {ranges.a}:</strong> Student with 83 (A-) and range=2 → suggest +2 → becomes A (85). Student with 82 and range=2 → no suggestion (gap is 3, exceeds range).
                    <br />
                    <strong style={{ color: '#7DD3FC' }}>A−→D range = {ranges.other}:</strong> Student with C (62) within {ranges.other} marks of C+ (64) → suggest +{Math.min(2, ranges.other)}.
                    <br />
                    <strong style={{ color: '#7DD3FC' }}>F range = {ranges.f}:</strong> Student with 47 (F) and range=3 → suggest +3 → becomes D (50). Student with 46 → no suggestion.
                  </div>
                </div>

                {error && (
                  <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#FCA5A5', fontSize: 13 }}>
                    ⚠️ {error}
                  </div>
                )}

                <button
                  onClick={handleProcess}
                  disabled={step === 'processing'}
                  style={{
                    padding: '14px 24px', borderRadius: 12, border: 'none', cursor: step === 'processing' ? 'wait' : 'pointer',
                    background: step === 'processing' ? 'rgba(14,165,233,0.4)' : 'linear-gradient(135deg, #0EA5E9, #0284C7)',
                    color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em',
                    boxShadow: '0 4px 20px rgba(14,165,233,0.3)', transition: 'all 0.2s'
                  }}
                >
                  {step === 'processing' ? '⏳ Processing PDF…' : '🚀 Analyse & Modulate Grades'}
                </button>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
