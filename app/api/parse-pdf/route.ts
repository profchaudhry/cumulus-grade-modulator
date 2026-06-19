import { NextRequest, NextResponse } from 'next/server'
import { ParsedCourse, ParsedStudent, GradingScheme } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

const ENROLL_RE = /^\d{2}-\d{6}-\d{3}$/
const GRADE_RE = /^[A-Z][+-]?$/
const NUM_RE = /^\d+$/

interface TextRow {
  y: number
  items: string[]
}

/**
 * Extract text from a PDF as position-grouped rows using pdfjs-dist directly.
 * Each row groups text items that share the same Y coordinate (within tolerance),
 * sorted left-to-right by X coordinate. This preserves the PDF's actual column
 * structure instead of guessing digit boundaries from concatenated text.
 */
async function extractRows(buffer: Buffer): Promise<string[][]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
  const data = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise

  const allRows: string[][] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = content.items as any[]

    const pageRows: TextRow[] = []
    items.forEach(it => {
      const str = (it.str || '').trim()
      if (!str) return
      const y = Math.round(it.transform[5])
      let row = pageRows.find(r => Math.abs(r.y - y) < 2)
      if (!row) {
        row = { y, items: [] }
        pageRows.push(row)
      }
      // Store with x for sorting, stash temporarily
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(row.items as any).push({ x: it.transform[4], str })
    })

    pageRows.sort((a, b) => b.y - a.y) // top to bottom
    pageRows.forEach(r => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(r.items as any).sort((a: any, b: any) => a.x - b.x)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.items = (r.items as any).map((i: any) => i.str)
    })

    allRows.push(...pageRows.map(r => r.items))
  }
  return allRows
}

function parseGradingScheme(tokens: string[]): GradingScheme {
  const scheme: GradingScheme = {}
  const joined = tokens.join(' ')
  const regex = /([A-Z][+-]?)\s*:\s*(\d+)-(\d+)/g
  let m
  while ((m = regex.exec(joined)) !== null) {
    scheme[m[1]] = { min: parseInt(m[2]), max: parseInt(m[3]) }
  }
  return scheme
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('pdf') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const rows = await extractRows(buffer)

    const courses: ParsedCourse[] = []
    let courseCode = ''
    let courseTitle = ''
    let teacherName = ''
    let className = ''
    let currentRoadmap = ''
    let currentScheme: GradingScheme = {}
    let inTable = false
    let currentStudents: ParsedStudent[] = []

    function flushCourse() {
      if (currentStudents.length > 0 && courseCode) {
        courses.push({
          course_code: courseCode,
          course_title: courseTitle,
          teacher_name: teacherName,
          class_name: className,
          grading_scheme: { ...currentScheme },
          students: [...currentStudents],
          roadmap: currentRoadmap,
        })
        currentStudents = []
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.length === 0) continue

      if (row[0] === 'Course Code' && row[1]) courseCode = row[1]
      if (row[0] === 'Course Title' && row[1]) courseTitle = row[1]
      if (row[0] === 'Teacher Name' && row[1]) teacherName = row[1]
      if (row[0] === 'Class' && row[1]) className = row[1]

      if (row[0] === 'Program') {
        const roadmapIdx = row.indexOf('Roadmap')
        const newRoadmap = roadmapIdx >= 0 ? row[roadmapIdx + 1] : ''
        if (newRoadmap && newRoadmap !== currentRoadmap) {
          flushCourse()
          currentRoadmap = newRoadmap
        }
      }

      if (row[0] === 'Grading Scheme') {
        currentScheme = parseGradingScheme(row.slice(1))
        inTable = false
      }

      if (row[0] === '#' && row[1] === 'Enrollment') {
        inTable = true
        continue
      }

      if (row[0] && (row[0].includes('Bahria University') || row[0].includes('Printed on'))) {
        inTable = false
      }

      // Student row: first cell is the row index number, second is enrollment
      if (inTable && NUM_RE.test(row[0]) && row[1] && ENROLL_RE.test(row[1])) {
        const enrollment = row[1]
        const regNo = row[2] || ''
        let name = row[3] || ''
        const rest = row.slice(4)

        // Handle multi-line names: subsequent row(s) containing only continuation text
        let j = i + 1
        while (j < rows.length) {
          const nextRow = rows[j]
          if (
            nextRow.length === 1 &&
            !ENROLL_RE.test(nextRow[0]) &&
            !NUM_RE.test(nextRow[0]) &&
            !GRADE_RE.test(nextRow[0]) &&
            nextRow[0] !== 'Course Code'
          ) {
            name += ' ' + nextRow[0]
            j++
          } else break
        }
        i = j - 1

        if (rest.length === 0) continue

        // Last cell is the grade letter; everything before is numeric marks
        const grade = rest[rest.length - 1]
        if (!GRADE_RE.test(grade)) continue
        const marks = rest.slice(0, -1).map(Number)

        let assign = 0, quiz = 0, mid = 0, final = 0, total = 0

        if (marks.length === 5) {
          ;[assign, quiz, mid, final, total] = marks
        } else if (marks.length === 4) {
          // Some rows omit the final mark (e.g. final not submitted) → [assign, quiz, mid, total]
          ;[assign, quiz, mid, total] = marks
        } else if (marks.length === 3) {
          // Absent / withdrawn students: [0, 0, 0] with F grade, no total column
          ;[assign, quiz, mid] = marks
        } else {
          // Unexpected shape — skip this row rather than store garbage
          continue
        }

        currentStudents.push({
          enrollment,
          reg_no: regNo,
          name: name.trim(),
          assign_marks: assign,
          quiz_marks: quiz,
          mid_marks: mid,
          final_marks: final,
          total,
          original_grade: grade,
          roadmap: currentRoadmap,
        })
      }
    }

    flushCourse()

    if (courses.length === 0) {
      return NextResponse.json({
        error: 'Could not parse student data from this PDF.',
        debug: rows.slice(0, 30),
      }, { status: 422 })
    }

    return NextResponse.json({ courses })
  } catch (err: unknown) {
    console.error('PDF parse error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
