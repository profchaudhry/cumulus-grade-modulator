import { NextRequest, NextResponse } from 'next/server'
import { ParsedCourse, ParsedStudent, GradingScheme } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

function parseGradingScheme(tokens: string[]): GradingScheme {
  // tokens look like: ["A", ": 85-100,", "A-", ": 80-84,", ...]
  // join and parse
  const joined = tokens.join(' ')
  const scheme: GradingScheme = {}
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = (await import('pdf-parse')) as any
    const parser = new PDFParse()
    const data = await parser.parse(buffer)
    const text: string = data.text

    // Split by newlines, trim, remove empty
    const tokens = text.split('\n').map((t: string) => t.trim()).filter((t: string) => t.length > 0)

    const courses: ParsedCourse[] = []

    // State machine
    let i = 0
    let courseCode = ''
    let courseTitle = ''
    let teacherName = ''
    let className = ''
    let currentRoadmap = ''
    let currentScheme: GradingScheme = {}
    let pendingStudents: ParsedStudent[] = []
    let parsingStudents = false
    let studentBuffer: string[] = []

    const ENROLLMENT_RE = /^\d{2}-\d{6}-\d{3}$/
    const NUMBER_RE = /^\d+$/
    const GRADE_RE = /^[A-Z][+-]?$/
    const ROADMAP_RE = /^(Spring|Fall|Summer)-\d{4}$/

    function flushStudents(roadmap: string) {
      if (pendingStudents.length > 0 && courseCode) {
        courses.push({
          course_code: courseCode,
          course_title: courseTitle,
          teacher_name: teacherName,
          class_name: className,
          grading_scheme: currentScheme,
          students: pendingStudents,
          roadmap,
        })
        pendingStudents = []
      }
    }

    while (i < tokens.length) {
      const t = tokens[i]

      // Course metadata
      if (t === 'Course Code' && tokens[i+1] && !ENROLLMENT_RE.test(tokens[i+1])) {
        courseCode = tokens[i+1]; i += 2; continue
      }
      if (t === 'Course Title') { courseTitle = tokens[i+1]; i += 2; continue }
      if (t === 'Teacher Name') { teacherName = tokens[i+1]; i += 2; continue }
      if (t === 'Class') { className = tokens[i+1]; i += 2; continue }
      if (t === 'Roadmap' && tokens[i+1] && ROADMAP_RE.test(tokens[i+1])) {
        const newRoadmap = tokens[i+1]
        if (newRoadmap !== currentRoadmap && pendingStudents.length > 0) {
          flushStudents(currentRoadmap)
        }
        currentRoadmap = newRoadmap
        i += 2; continue
      }
      if (t === 'Grading  Scheme' || t === 'Grading Scheme') {
        // Collect the scheme tokens until we hit '#'
        i++
        const schemeTokens: string[] = []
        while (i < tokens.length && tokens[i] !== '#') {
          schemeTokens.push(tokens[i])
          i++
        }
        currentScheme = parseGradingScheme(schemeTokens)
        parsingStudents = false
        continue
      }

      // Table header - skip
      if (t === '#' && tokens[i+1] === 'Enrollment') {
        // Skip header row tokens
        while (i < tokens.length && tokens[i] !== '1') i++
        parsingStudents = true
        continue
      }

      // Student rows: # Enrollment Reg# Name ... marks ... Grade
      // Pattern: number, enrollment, reg#, name(s), assign, quiz, mid, final, total, grade
      if (parsingStudents && NUMBER_RE.test(t) && tokens[i+1] && ENROLLMENT_RE.test(tokens[i+1])) {
        // Row number
        i++ // skip row number
        const enrollment = tokens[i]; i++
        const regNo = tokens[i]; i++

        // Name: collect until we hit numbers (the marks)
        const nameParts: string[] = []
        while (i < tokens.length && !NUMBER_RE.test(tokens[i])) {
          // but stop if it looks like a new student row: digit after enrollment
          nameParts.push(tokens[i])
          i++
        }

        // Now collect 5 numbers: assign, quiz, mid, final, total
        const nums: number[] = []
        while (i < tokens.length && nums.length < 5 && NUMBER_RE.test(tokens[i])) {
          nums.push(parseInt(tokens[i]))
          i++
        }

        // Grade
        let grade = ''
        if (i < tokens.length && GRADE_RE.test(tokens[i])) {
          grade = tokens[i]; i++
        }

        if (nums.length >= 5) {
          pendingStudents.push({
            enrollment,
            reg_no: regNo,
            name: nameParts.join(' ').trim(),
            assign_marks: nums[0],
            quiz_marks: nums[1],
            mid_marks: nums[2],
            final_marks: nums[3],
            total: nums[4],
            original_grade: grade,
            roadmap: currentRoadmap,
          })
        }
        continue
      }

      // End of table markers
      if (t === 'A' && tokens[i+1] === 'A-' && tokens[i+2] === 'B') {
        parsingStudents = false
        flushStudents(currentRoadmap)
        i++; continue
      }

      i++
    }

    // Flush any remaining
    flushStudents(currentRoadmap)

    if (courses.length === 0) {
      return NextResponse.json({ error: 'No student data found in PDF', rawTokens: tokens.slice(0, 80) }, { status: 422 })
    }

    return NextResponse.json({ courses })
  } catch (err: unknown) {
    console.error('PDF parse error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
