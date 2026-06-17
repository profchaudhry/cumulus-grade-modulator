'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { StudentRow, Session, Ranges, computeSuggestion, STANDARD_GRADING } from '@/lib/types'

const GRADE_ORDER = ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']

type SortKey = 'pdf_row_order' | 'enrollment' | 'name' | 'roadmap' | 'assign_marks' | 'quiz_marks' | 'mid_marks' | 'final_marks' | 'total' | 'original_grade' | 'suggested_addition'
type SortDir = 'asc' | 'desc'

function gradeColor(g: string) {
  if (g === 'A')  return { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' }
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
  const { suggested_addition, new_grade, original_grade } = student
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
  const [sortKey, setSortKey] = useState<SortKey>('pdf_row_order')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const [{ data: sess }, { data: studs }] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', id).single(),
        supabase.from('students').select('*').eq('session_id', id).order('pdf_row_order', { ascending: true }),
      ])
      setSession(sess)
      setStudents(studs || [])
      if (sess?.ranges) setRanges(sess.ranges)
      setLoading(false)
    }
    load()
  }, [id])

  const roadmaps = useMemo(() => {
    // Preserve roadmap order as they appear in the PDF
    const seen = new Set<string>()
    const ordered: string[] = []
    ;(students as StudentRow[]).forEach(s => {
      if (s.roadmap && !seen.has(s.roadmap)) { seen.add(s.roadmap); ordered.push(s.roadmap) }
    })
    return ordered
  }, [students])

  const grades = [...new Set(students.map(s => s.original_grade))].sort((a, b) => GRADE_ORDER.indexOf(b) - GRADE_ORDER.indexOf(a))

  const boostedCount = students.filter(s => s.suggested_addition > 0).length
  const gradeDistrib: Record<string, number> = {}
  students.forEach(s => { gradeDistrib[s.original_grade] = (gradeDistrib[s.original_grade] || 0) + 1 })

  // Sort function
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Apply filter then sort
  const filtered = useMemo(() => {
    let rows = students.filter(s => {
      if (filter === 'boosted' && s.suggested_addition === 0) return false
      if (filter === 'unchanged' && s.suggested_addition > 0) return false
      if (gradeFilter !== 'all' && s.original_grade !== gradeFilter) return false
      if (roadmapFilter !== 'all' && s.roadmap !== roadmapFilter) return false
      return true
    })

    // Sort
    rows = [...rows].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sortKey === 'original_grade') {
        av = GRADE_ORDER.indexOf(a.original_grade)
        bv = GRADE_ORDER.indexOf(b.original_grade)
      } else if (sortKey === 'roadmap') {
        av = a.roadmap ?? ''
        bv = b.roadmap ?? ''
      } else if (sortKey === 'name' || sortKey === 'enrollment') {
        av = (a[sortKey] ?? '').toString()
        bv = (b[sortKey] ?? '').toString()
      } else {
        av = (a[sortKey] as number) ?? 0
        bv = (b[sortKey] as number) ?? 0
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return rows
  }, [students, filter, gradeFilter, roadmapFilter, sortKey, sortDir])

  // Group by roadmap when in original order and no roadmap filter
  const groupByRoadmap = sortKey === 'pdf_row_order' && roadmapFilter === 'all'

  // Build display groups
  const displayGroups: { roadmap: string; rows: StudentRow[] }[] = useMemo(() => {
    if (!groupByRoadmap) return [{ roadmap: '', rows: filtered }]
    const groups: { roadmap: string; rows: StudentRow[] }[] = []
    const map = new Map<string, StudentRow[]>()
    filtered.forEach(s => {
      const r = s.roadmap || 'Unknown'
      if (!map.has(r)) map.set(r, [])
      map.get(r)!.push(s)
    })
    // Preserve roadmap order from PDF
    roadmaps.forEach(r => { if (map.has(r)) groups.push({ roadmap: r, rows: map.get(r)! }) })
    return groups
  }, [filtered, groupByRoadmap, roadmaps])

  const handleDelete = async () => {
    if (!confirm('Delete this session and all student data? This cannot be undone.')) return
    await supabase.from('students').delete().eq('session_id', id)
    await supabase.from('sessions').delete().eq('id', id)
    router.push('/')
  }

  const [exporting, setExporting] = useState<'xls' | 'pdf' | null>(null)

  const getExportRows = () => {
    // Always export ALL students in current view order (respects active sort/filter)
    return filtered.map((s, i) => ({
      '#': i + 1,
      'Enrollment': s.enrollment,
      'Name': s.name,
      'Roadmap': s.roadmap,
      'Assign (20)': s.assign_marks,
      'Quiz (15)': s.quiz_marks,
      'Mid (25)': s.mid_marks,
      'Final (40)': s.final_marks,
      'Total (100)': s.total,
      'Grade': s.original_grade,
      'Marks Added': s.suggested_addition || '',
      'New Total': s.suggested_addition > 0 ? s.new_total : '',
      'New Grade': s.suggested_addition > 0 ? s.new_grade : 'No change',
    }))
  }

  const exportXLS = async () => {
    setExporting('xls')
    try {
      const XLSX = await import('xlsx')
      const rows = getExportRows()
      const ws = XLSX.utils.json_to_sheet(rows)

      // Column widths
      ws['!cols'] = [
        { wch: 4 }, { wch: 18 }, { wch: 28 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Grade Modulation')

      // Summary sheet
      const summaryData = [
        ['Cumulus Grade Modulator — Export'],
        [''],
        ['Course Code', session!.course_code],
        ['Course Title', session!.course_title],
        ['Teacher', session!.teacher_name],
        ['Class', session!.class],
        [''],
        ['Ranges Used'],
        ['A- → A Range', ranges.a],
        ['A- to D Range', ranges.other],
        ['F Range', ranges.f],
        [''],
        ['Summary'],
        ['Total Students', students.length],
        ['Boosts Suggested', students.filter(s => s.suggested_addition > 0).length],
        ['No Change', students.filter(s => s.suggested_addition === 0).length],
        [''],
        ['Exported On', new Date().toLocaleString()],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(summaryData)
      ws2['!cols'] = [{ wch: 20 }, { wch: 30 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Summary')

      const filename = `${session!.course_code}_${session!.course_title}_GradeModulation.xlsx`
        .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      XLSX.writeFile(wb, filename)
    } finally {
      setExporting(null)
    }
  }

  const exportPDF = async () => {
    setExporting('pdf')
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const PW = 297 // page width
      const ML = 12 // margin left
      const MR = 12 // margin right
      const TW = PW - ML - MR // table width

      // ── HEADER BLOCK ──────────────────────────────────────────────
      // Dark navy background
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 0, PW, 34, 'F')

      // Sky blue accent bar on left
      doc.setFillColor(14, 165, 233)
      doc.rect(0, 0, 4, 34, 'F')

      // App name
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.setTextColor(255, 255, 255)
      doc.text('CUMULUS GRADE MODULATOR', ML + 4, 11)

      // Course info line
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(148, 163, 184)
      const courseInfo = `${session!.course_code}   ${session!.course_title}   ${session!.class}   ${session!.teacher_name}`
      doc.text(courseInfo, ML + 4, 19)

      // Ranges + export date
      doc.setFontSize(7.5)
      doc.setTextColor(100, 116, 139)
      const rangeInfo = `Ranges  |  A- to A: ${ranges.a} marks   A- to D: ${ranges.other} marks   F: ${ranges.f} marks`
      doc.text(rangeInfo, ML + 4, 25)
      const exportDate = `Exported: ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}  ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:true })}`
      doc.text(exportDate, PW - MR, 25, { align: 'right' })

      // Summary pills
      const pills = [
        { label: 'Total Students', value: String(students.length), color: [14, 165, 233] as [number,number,number] },
        { label: 'Boosts Suggested', value: String(boostedCount), color: [16, 185, 129] as [number,number,number] },
        { label: 'No Change', value: String(students.length - boostedCount), color: [100, 116, 139] as [number,number,number] },
      ]
      let pillX = ML + 4
      pills.forEach(p => {
        const tw = doc.getTextWidth(p.label + '  ' + p.value) + 8
        doc.setFillColor(p.color[0], p.color[1], p.color[2])
        doc.setGState(new (doc as any).GState({ opacity: 0.15 }))
        doc.roundedRect(pillX, 27.5, tw, 5, 1, 1, 'F')
        doc.setGState(new (doc as any).GState({ opacity: 1 }))
        doc.setFontSize(6.5)
        doc.setTextColor(p.color[0], p.color[1], p.color[2])
        doc.text(`${p.label}  ${p.value}`, pillX + 2, 31)
        pillX += tw + 3
      })

      // ── TABLE ─────────────────────────────────────────────────────
      // Build body with roadmap section headers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableBody: any[][] = []
      let lastRoadmap = ''
      let rowNum = 0

      filtered.forEach((s) => {
        // Roadmap section header row
        if (groupByRoadmap && s.roadmap !== lastRoadmap) {
          lastRoadmap = s.roadmap
          tableBody.push([{
            content: `PROGRAM ROADMAP: ${s.roadmap.toUpperCase()}`,
            colSpan: 12,
            styles: {
              fillColor: [30, 58, 95],
              textColor: [125, 211, 252],
              fontStyle: 'bold',
              fontSize: 7.5,
              cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
            }
          }])
        }

        rowNum++
        const suggestion = s.suggested_addition > 0
          ? `+${s.suggested_addition} -> ${s.new_total}`
          : 'No change'
        const newGrade = s.suggested_addition > 0 ? s.new_grade : ''

        tableBody.push([
          rowNum,
          s.enrollment,
          s.name,
          s.roadmap,
          s.assign_marks,
          s.quiz_marks,
          s.mid_marks,
          s.final_marks,
          s.total,
          s.original_grade,
          suggestion,
          newGrade,
        ])
      })

      autoTable(doc, {
        startY: 36,
        head: [[
          '#', 'Enrollment', 'Name', 'Roadmap',
          'Assign\n(20)', 'Quiz\n(15)', 'Mid\n(25)', 'Final\n(40)',
          'Total\n(100)', 'Grade',
          'Suggestion', 'New\nGrade'
        ]],
        body: tableBody,
        styles: {
          fontSize: 8,
          cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
          overflow: 'ellipsize',
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
          minCellHeight: 8,
        },
        headStyles: {
          fillColor: [14, 165, 233],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
          halign: 'center',
          valign: 'middle',
          cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0:  { cellWidth: 7,  halign: 'center', textColor: [148, 163, 184] },
          1:  { cellWidth: 32, font: 'courier',  fontSize: 7.5, textColor: [71, 85, 105] },
          2:  { cellWidth: 52, fontStyle: 'bold', textColor: [15, 23, 42] },
          3:  { cellWidth: 20, halign: 'center', fontSize: 7.5, textColor: [100, 116, 139] },
          4:  { cellWidth: 14, halign: 'center' },
          5:  { cellWidth: 14, halign: 'center' },
          6:  { cellWidth: 14, halign: 'center' },
          7:  { cellWidth: 14, halign: 'center' },
          8:  { cellWidth: 16, halign: 'center', fontStyle: 'bold', fontSize: 9 },
          9:  { cellWidth: 16, halign: 'center', fontStyle: 'bold', fontSize: 9 },
          10: { cellWidth: 40, halign: 'center', fontSize: 8 },
          11: { cellWidth: 16, halign: 'center', fontStyle: 'bold', fontSize: 9 },
        },
        didParseCell: (data) => {
          if (data.row.section !== 'body') return

          // Skip roadmap header rows
          if (data.cell.colSpan && data.cell.colSpan > 1) return

          // Find the actual student for this row
          // Count non-header rows up to this point
          let studentRow = 0
          for (let ri = 0; ri <= data.row.index; ri++) {
            const cell = data.table.body[ri]?.cells[0]
            if (cell && !(data.table.body[ri]?.cells[0] as any)?.colSpan) studentRow++
          }
          const s = filtered[studentRow - 1]
          if (!s) return

          // Highlight boosted rows with a subtle blue tint
          if (s.suggested_addition > 0) {
            data.cell.styles.fillColor = [224, 242, 254]
          }

          // Grade column colouring
          if (data.column.index === 9) {
            const grade = String(data.cell.raw)
            if (grade === 'A')       data.cell.styles.textColor = [5, 150, 105]
            else if (grade === 'A-') data.cell.styles.textColor = [16, 185, 129]
            else if (grade.startsWith('B')) data.cell.styles.textColor = [37, 99, 235]
            else if (grade.startsWith('C')) data.cell.styles.textColor = [180, 83, 9]
            else if (grade.startsWith('D')) data.cell.styles.textColor = [185, 28, 28]
            else if (grade === 'F')  data.cell.styles.textColor = [109, 40, 217]
          }

          // New grade column colouring
          if (data.column.index === 11 && String(data.cell.raw)) {
            const grade = String(data.cell.raw)
            if (grade === 'A')       data.cell.styles.textColor = [5, 150, 105]
            else if (grade === 'A-') data.cell.styles.textColor = [16, 185, 129]
            else if (grade.startsWith('B')) data.cell.styles.textColor = [37, 99, 235]
            else if (grade.startsWith('C')) data.cell.styles.textColor = [180, 83, 9]
            else if (grade.startsWith('D')) data.cell.styles.textColor = [185, 28, 28]
          }

          // Suggestion column: colour the +N text
          if (data.column.index === 10 && s.suggested_addition > 0) {
            data.cell.styles.textColor = [14, 165, 233]
            data.cell.styles.fontStyle = 'bold'
          }
        },
        margin: { left: ML, right: MR, top: 36 },
      })

      // ── FOOTER ────────────────────────────────────────────────────
      const pageCount = (doc as any).internal.getNumberOfPages()
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p)
        const pageH = doc.internal.pageSize.height

        // Footer bar
        doc.setFillColor(248, 250, 252)
        doc.rect(0, pageH - 10, PW, 10, 'F')
        doc.setDrawColor(226, 232, 240)
        doc.line(0, pageH - 10, PW, pageH - 10)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(148, 163, 184)
        doc.text(`Page ${p} of ${pageCount}`, ML, pageH - 4)
        doc.text('Cumulus Grade Modulator  |  Bahria University E-8 Campus', PW / 2, pageH - 4, { align: 'center' })
        doc.text(`${students.length} students  |  ${boostedCount} boosts`, PW - MR, pageH - 4, { align: 'right' })
      }

      const now = new Date()
      const datePart = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const timePart = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
      const filename = `Award List - ${session!.course_title} - ${session!.class} - ${datePart} ${timePart}.pdf`
        .replace(/[/\\:*?"<>|]/g, '-')
      doc.save(filename)
    } finally {
      setExporting(null)
    }
  }

  const handleRecalculate = async () => {
    setSaving(true)
    await supabase.from('sessions').update({ ranges }).eq('id', id)
    const updates = students.map(s => {
      const suggestion = computeSuggestion(
        { enrollment: s.enrollment, reg_no: s.reg_no, name: s.name, assign_marks: s.assign_marks, quiz_marks: s.quiz_marks, mid_marks: s.mid_marks, final_marks: s.final_marks, total: s.total, original_grade: s.original_grade, roadmap: s.roadmap },
        ranges, STANDARD_GRADING
      )
      return supabase.from('students').update({
        suggested_addition: suggestion.suggested_addition,
        new_total: suggestion.new_total,
        new_grade: suggestion.new_grade,
      }).eq('id', s.id)
    })
    await Promise.all(updates)
    const { data } = await supabase.from('students').select('*').eq('session_id', id).order('pdf_row_order', { ascending: true })
    setStudents(data || [])
    setSaving(false)
    setEditing(false)
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span style={{ color: '#CBD5E1', marginLeft: 4 }}>↕</span>
    return <span style={{ color: '#0EA5E9', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const thStyle = (col: SortKey): React.CSSProperties => ({
    padding: '11px 14px',
    textAlign: col === 'name' || col === 'enrollment' || col === 'roadmap' ? 'left' : 'center',
    color: sortKey === col ? '#0EA5E9' : '#64748B',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    background: sortKey === col ? '#F0F9FF' : '#F8FAFC',
    borderBottom: sortKey === col ? '2px solid #0EA5E9' : '1px solid #E2E8F0',
    transition: 'all 0.15s',
  })

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
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{session.course_code} · {session.course_title}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: 12 }}>{session.teacher_name}</span>
            <button onClick={() => setEditing(!editing)}
              style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(14,165,233,0.15)', border: '1px solid rgba(14,165,233,0.3)', color: '#7DD3FC', fontSize: 13, cursor: 'pointer' }}>
              {editing ? 'Cancel' : '⚙️ Adjust Ranges'}
            </button>
            <button onClick={handleDelete}
              style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5', fontSize: 13, cursor: 'pointer' }}>
              🗑 Delete
            </button>
          </div>
        </div>

        {editing && (
          <div style={{ padding: '16px 0 20px', display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {([
              { key: 'a' as const, label: 'A−→ A range' },
              { key: 'other' as const, label: 'A− to D range' },
              { key: 'f' as const, label: 'F range' },
            ]).map(({ key, label }) => (
              <div key={key}>
                <div style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
                <input type="number" min={1} max={15} value={ranges[key]}
                  onChange={e => setRanges(r => ({ ...r, [key]: parseInt(e.target.value) || 1 }))}
                  style={{ width: 70, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(14,165,233,0.4)', color: '#fff', fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none' }} />
              </div>
            ))}
            <button onClick={handleRecalculate} disabled={saving}
              style={{ padding: '9px 18px', borderRadius: 8, background: '#0EA5E9', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {saving ? 'Recalculating…' : '↻ Recalculate'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, padding: '16px 0', flexWrap: 'wrap' }}>
          {[
            { label: 'Total Students', value: students.length, color: '#fff' },
            { label: 'Grade Boosts Suggested', value: boostedCount, color: '#10B981' },
            { label: 'No Change', value: students.length - boostedCount, color: '#94A3B8' },
            { label: 'Ranges Used', value: `A-→A:${ranges.a} / Other:${ranges.other} / F:${ranges.f}`, color: '#7DD3FC' },
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

          {sortKey !== 'pdf_row_order' && (
            <button onClick={() => { setSortKey('pdf_row_order'); setSortDir('asc') }}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', fontSize: 12, cursor: 'pointer' }}>
              ↺ Original Order
            </button>
          )}

          <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>{filtered.length} students shown</span>

          {/* Export buttons */}
          <button
            onClick={exportXLS}
            disabled={exporting !== null}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #10B981', background: exporting === 'xls' ? '#D1FAE5' : '#ECFDF5', color: '#065F46', fontSize: 12, fontWeight: 600, cursor: exporting ? 'wait' : 'pointer' }}
          >
            <span style={{ fontSize: 14 }}>📊</span>
            {exporting === 'xls' ? 'Exporting…' : 'Export XLS'}
          </button>
          <button
            onClick={exportPDF}
            disabled={exporting !== null}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #EF4444', background: exporting === 'pdf' ? '#FEE2E2' : '#FFF5F5', color: '#991B1B', fontSize: 12, fontWeight: 600, cursor: exporting ? 'wait' : 'pointer' }}
          >
            <span style={{ fontSize: 14 }}>📄</span>
            {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>

        {/* Table — grouped by roadmap when in original order */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle('pdf_row_order')} onClick={() => handleSort('pdf_row_order')}>#<SortIcon col="pdf_row_order" /></th>
                  <th style={thStyle('enrollment')} onClick={() => handleSort('enrollment')}>Enrollment<SortIcon col="enrollment" /></th>
                  <th style={thStyle('name')} onClick={() => handleSort('name')}>Name<SortIcon col="name" /></th>
                  <th style={thStyle('roadmap')} onClick={() => handleSort('roadmap')}>Roadmap<SortIcon col="roadmap" /></th>
                  <th style={thStyle('assign_marks')} onClick={() => handleSort('assign_marks')}>Assign<SortIcon col="assign_marks" /></th>
                  <th style={thStyle('quiz_marks')} onClick={() => handleSort('quiz_marks')}>Quiz<SortIcon col="quiz_marks" /></th>
                  <th style={thStyle('mid_marks')} onClick={() => handleSort('mid_marks')}>Mid<SortIcon col="mid_marks" /></th>
                  <th style={thStyle('final_marks')} onClick={() => handleSort('final_marks')}>Final<SortIcon col="final_marks" /></th>
                  <th style={thStyle('total')} onClick={() => handleSort('total')}>Total<SortIcon col="total" /></th>
                  <th style={thStyle('original_grade')} onClick={() => handleSort('original_grade')}>Grade<SortIcon col="original_grade" /></th>
                  <th style={thStyle('suggested_addition')} onClick={() => handleSort('suggested_addition')}>Suggestion<SortIcon col="suggested_addition" /></th>
                </tr>
              </thead>
              <tbody>
                {displayGroups.map(({ roadmap, rows }, gi) => (
                  <>
                    {/* Roadmap section header — only when grouped */}
                    {groupByRoadmap && roadmap && (
                      <tr key={`header-${roadmap}`}>
                        <td colSpan={11} style={{
                          padding: '10px 16px',
                          background: 'linear-gradient(90deg, #0F172A, #1E3A5F)',
                          borderTop: gi > 0 ? '3px solid #0EA5E9' : undefined,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ color: '#7DD3FC', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                              📚 Program Roadmap: {roadmap}
                            </span>
                            <span style={{ color: '#475569', fontSize: 11 }}>· {rows.length} students</span>
                            {(() => {
                              const boosted = rows.filter(r => r.suggested_addition > 0).length
                              return boosted > 0 ? <span style={{ color: '#10B981', fontSize: 11 }}>· {boosted} boosts suggested</span> : null
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                    {rows.map((s, i) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid #F1F5F9', background: s.suggested_addition > 0 ? 'rgba(14,165,233,0.03)' : '#fff' }}>
                        <td style={{ padding: '10px 14px', color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>
                          {/* Show original row number in original order, sequential otherwise */}
                          {sortKey === 'pdf_row_order' ? (s.roadmap_row_order || i + 1) : (displayGroups[0].rows.indexOf(s) + 1 || i + 1)}
                        </td>
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
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><GradeBadge grade={s.original_grade} /></td>
                        <td style={{ padding: '10px 14px', minWidth: 200 }}><SuggestionCell student={s} /></td>
                      </tr>
                    ))}
                  </>
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
          {sortKey !== 'pdf_row_order' && <span style={{ marginLeft: 8, color: '#0EA5E9' }}>Sorted by {sortKey.replace('_', ' ')} {sortDir}</span>}
        </div>
      </div>
    </div>
  )
}
