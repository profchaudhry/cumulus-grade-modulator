'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { StudentRow, Session, Ranges, computeSuggestion, STANDARD_GRADING } from '@/lib/types'

const GRADE_ORDER = ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']

function gradeColor(g: string) {
  if (g === 'A') return { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' }
  if (g === 'A-') return { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' }
  if (g.startsWith('B')) return { bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' }
  if (g.startsWith('C')) return { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' }
  if (g.startsWith('D')) return { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' }
  return { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' }
}

function GradeBadge({ grade }: { grade: string }) {
  const c = gradeColor(grade)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 36, padding: '3px 8px', borderRadius: 6,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      fontSize: 12, fontWeight: 700, fontFamily: 'monospace'
    }}>{grade}</span>
  )
}

function SuggestionCell({ student }: { student: StudentRow }) {
  const { suggested_addition, new_grade, original_grade, total } = student
  if (suggested_addition === 0) {
    return <span style={{ color: '#94A3B8', fontSize: 12 }}>No change</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#0EA5E9', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>+{suggested_addition}</span>
      <span style={{ color: '#64748B', fontSize: 11 }}>→ {student.new_total}</span>
      <GradeBadge grade={original_grade} />
      <span style={{ color: '#64748B', fontSize: 11 }}>→</span>
      <GradeBadge grade={new_grade} />
    </div>
  )
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'boosted' | 'unchanged'>('all')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [roadmapFilter, setRoadmapFilter] = useState('all')
  const [editing, setEditing] = useState(false)
  const [ranges, setRanges] = useState<Ranges>({ a: 3, other: 3, f: 3 })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const [{ data: sess }, { data: studs }] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', id).single(),
        supabase.from('students').select('*').eq('session_id', id).order('name'),
      ])
      setSession(sess)
      setStudents(studs || [])
      if (sess?.ranges) setRanges(sess.ranges)
      setLoading(false)
    }
    load()
  }, [id])

  const roadmaps = [...new Set(students.map(s => s.roadmap).filter(Boolean))]
  const grades = [...new Set(students.map(s => s.original_grade))].sort((a, b) => GRADE_ORDER.indexOf(b) - GRADE_ORDER.indexOf(a))

  const filtered = students.filter(s => {
    if (filter === 'boosted' && s.suggested_addition === 0) return false
    if (filter === 'unchanged' && s.suggested_addition > 0) return false
    if (gradeFilter !== 'all' && s.original_grade !== gradeFilter) return false
    if (roadmapFilter !== 'all' && s.roadmap !== roadmapFilter) return false
    return true
  })

  const boostedCount = students.filter(s => s.suggested_addition > 0).length
  const gradeDistrib: Record<string, number> = {}
  students.forEach(s => { gradeDistrib[s.original_grade] = (gradeDistrib[s.original_grade] || 0) + 1 })

  const handleDelete = async () => {
    if (!confirm('Delete this session and all student data? This cannot be undone.')) return
    await supabase.from('students').delete().eq('session_id', id)
    await supabase.from('sessions').delete().eq('id', id)
    router.push('/')
  }

  const handleRecalculate = async () => {
    setSaving(true)
    // Update ranges on session
    await supabase.from('sessions').update({ ranges }).eq('id', id)
    // Recompute all students
    const updates = students.map(s => {
      const suggestion = computeSuggestion(
        { enrollment: s.enrollment, reg_no: s.reg_no, name: s.name, assign_marks: s.assign_marks, quiz_marks: s.quiz_marks, mid_marks: s.mid_marks, final_marks: s.final_marks, total: s.total, original_grade: s.original_grade, roadmap: s.roadmap },
        ranges,
        STANDARD_GRADING
      )
      return supabase.from('students').update({
        suggested_addition: suggestion.suggested_addition,
        new_total: suggestion.new_total,
        new_grade: suggestion.new_grade,
      }).eq('id', s.id)
    })
    await Promise.all(updates)
    // Reload
    const { data } = await supabase.from('students').select('*').eq('session_id', id).order('name')
    setStudents(data || [])
    setSaving(false)
    setEditing(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>☁️</div>
        <div style={{ color: '#7DD3FC', fontSize: 16 }}>Loading session…</div>
      </div>
    </div>
  )

  if (!session) return (
    <div style={{ minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#EF4444', fontSize: 16 }}>Session not found.</div>
        <button onClick={() => router.push('/')} style={{ marginTop: 16, color: '#7DD3FC', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Back</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      {/* Top bar */}
      <div style={{ background: 'linear-gradient(135deg, #0F172A, #1E3A5F)', padding: '0 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => router.push('/')} style={{ color: '#7DD3FC', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>☁️</button>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>/</div>
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
              {session.course_code} · {session.course_title}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: 12 }}>{session.teacher_name}</span>
            <button
              onClick={() => setEditing(!editing)}
              style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(14,165,233,0.15)', border: '1px solid rgba(14,165,233,0.3)', color: '#7DD3FC', fontSize: 13, cursor: 'pointer' }}
            >
              {editing ? 'Cancel' : '⚙️ Adjust Ranges'}
            </button>
            <button
              onClick={handleDelete}
              style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5', fontSize: 13, cursor: 'pointer' }}
              title="Delete this session"
            >
              🗑 Delete
            </button>
          </div>
        </div>

        {/* Adjust ranges panel */}
        {editing && (
          <div style={{ padding: '16px 0 20px', display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {[
              { key: 'a' as const, label: 'A−→ A range' },
              { key: 'other' as const, label: 'A− to D range' },
              { key: 'f' as const, label: 'F range' },
            ].map(({ key, label }) => (
              <div key={key}>
                <div style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
                <input
                  type="number" min={1} max={15} value={ranges[key]}
                  onChange={e => setRanges(r => ({ ...r, [key]: parseInt(e.target.value) || 1 }))}
                  style={{ width: 70, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(14,165,233,0.4)', color: '#fff', fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                />
              </div>
            ))}
            <button
              onClick={handleRecalculate}
              disabled={saving}
              style={{ padding: '9px 18px', borderRadius: 8, background: '#0EA5E9', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {saving ? 'Recalculating…' : '↻ Recalculate'}
            </button>
          </div>
        )}

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 24, padding: '16px 0', flexWrap: 'wrap' }}>
          {[
            { label: 'Total Students', value: students.length, color: '#fff' },
            { label: 'Grade Boosts Suggested', value: boostedCount, color: '#10B981' },
            { label: 'No Change', value: students.length - boostedCount, color: '#94A3B8' },
            { label: 'Ranges Used', value: `${ranges.other} / F:${ranges.f}`, color: '#7DD3FC' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ color: '#475569', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ color, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>
        {/* Grade distribution */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(gradeDistrib).sort(([a], [b]) => GRADE_ORDER.indexOf(b) - GRADE_ORDER.indexOf(a)).map(([grade, count]) => {
            const c = gradeColor(grade)
            return (
              <div key={grade} style={{ padding: '6px 12px', borderRadius: 8, background: c.bg, border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: c.text, fontWeight: 700, fontSize: 13 }}>{grade}</span>
                <span style={{ color: c.text, opacity: 0.7, fontSize: 12 }}>× {count}</span>
              </div>
            )
          })}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: '#E2E8F0', borderRadius: 10, padding: 4 }}>
            {(['all', 'boosted', 'unchanged'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: filter === f ? '#fff' : 'transparent',
                  color: filter === f ? '#0F172A' : '#64748B',
                  boxShadow: filter === f ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
                {f === 'all' ? '📋 All' : f === 'boosted' ? '⬆️ Boosted' : '➖ Unchanged'}
              </button>
            ))}
          </div>

          <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <option value="all">All Grades</option>
            {grades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          {roadmaps.length > 1 && (
            <select value={roadmapFilter} onChange={e => setRoadmapFilter(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 13, color: '#334155', cursor: 'pointer' }}>
              <option value="all">All Roadmaps</option>
              {roadmaps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}

          <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>{filtered.length} students shown</span>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  {['#', 'Enrollment', 'Name', 'Roadmap', 'Assign', 'Quiz', 'Mid', 'Final', 'Total', 'Grade', 'Suggestion'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', color: '#64748B', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #F1F5F9', background: s.suggested_addition > 0 ? 'rgba(14,165,233,0.02)' : '#fff' }}>
                    <td style={{ padding: '10px 14px', color: '#94A3B8', fontSize: 12 }}>{i + 1}</td>
                    <td style={{ padding: '10px 14px', color: '#475569', fontSize: 12, fontFamily: 'monospace' }}>{s.enrollment}</td>
                    <td style={{ padding: '10px 14px', color: '#0F172A', fontWeight: 500 }}>{s.name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: '#F1F5F9', color: '#64748B' }}>{s.roadmap}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>{s.assign_marks}</td>
                    <td style={{ padding: '10px 14px', color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>{s.quiz_marks}</td>
                    <td style={{ padding: '10px 14px', color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>{s.mid_marks}</td>
                    <td style={{ padding: '10px 14px', color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>{s.final_marks}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>{s.total}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}><GradeBadge grade={s.original_grade} /></td>
                    <td style={{ padding: '10px 14px', minWidth: 200 }}><SuggestionCell student={s} /></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>No students match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 16, color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>
          Session ID: <span style={{ fontFamily: 'monospace' }}>{id}</span> · PDF: {session.pdf_name}
        </div>
      </div>
    </div>
  )
}
