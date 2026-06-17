import { NextRequest, NextResponse } from 'next/server'
import { ParsedCourse, ParsedStudent, GradingScheme } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

function parseGradingScheme(line: string): GradingScheme {
  const scheme: GradingScheme = {}
  const regex = /([A-Z][+-]?)\s*:\s*(\d+)-(\d+)/g
  let m
  while ((m = regex.exec(line)) !== null) {
    scheme[m[1]] = { min: parseInt(m[2]), max: parseInt(m[3]) }
  }
  return scheme
}

/** 
 * Extract 5 marks + grade from a concatenated string like "181251550D"
 * Strategy: try all splits of (assign≤20)(quiz≤15)(mid≤25)(final≤40)(total≤100)(grade)
 * Validate by checking assign+quiz+mid+final === total
 */
function extractMarks(str: string): {
  assign: number; quiz: number; mid: number; final: number; total: number; grade: string
} | null {
  const gradeMatch = str.match(/([A-Z][+-]?)$/)
  if (!gradeMatch) return null
  const grade = gradeMatch[1]
  const nums = str.slice(0, -grade.length)

  for (const totalLen of [3, 2]) {
    const totalStr = nums.slice(-totalLen)
    const total = parseInt(totalStr)
    if (isNaN(total) || total < 0 || total > 100) continue

    const rest = nums.slice(0, -totalLen)
    const maxes = [20, 15, 25, 40]

    // Try LONGER digit splits first (2 digits before 1 digit) so "11" beats "1"
    // when both satisfy constraints — resolves ambiguous cases like quiz=11,mid=7 vs quiz=1,mid=17
    for (let a = 2; a >= 1; a--) {
      if (a > rest.length) continue
      const v0 = parseInt(rest.slice(0, a))
      if (v0 > maxes[0] || v0 === 0) continue
      for (let b = 2; b >= 1; b--) {
        if (a + b > rest.length) continue
        const v1 = parseInt(rest.slice(a, a + b))
        if (v1 > maxes[1] || v1 === 0) continue
        for (let c = 2; c >= 1; c--) {
          if (a + b + c > rest.length) continue
          const v2 = parseInt(rest.slice(a + b, a + b + c))
          if (v2 > maxes[2]) continue
          const tail = rest.slice(a + b + c)
          if (tail.length < 1 || tail.length > 2) continue
          const v3 = parseInt(tail)
          if (v3 > maxes[3]) continue
          // Validate: component sum must equal total
          if (v0 + v1 + v2 + v3 === total) {
            return { assign: v0, quiz: v1, mid: v2, final: v3, total, grade }
          }
        }
      }
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('pdf') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse')
    const data = await pdfParse(buffer)
    const text: string = data.text

    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)

    const courses: ParsedCourse[] = []
    let currentScheme: GradingScheme = {}
    let currentRoadmap = ''
    let courseCode = ''
    let courseTitle = ''
    let teacherName = ''
    let className = ''
    let currentStudents: ParsedStudent[] = []
    let inTable = false

    const ENROLL_RE = /(\d{2}-\d{6}-\d{3})/

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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Metadata (columns merged by pdfjs: "Course CodeMKT 650Credit Hours3")
      if (line.startsWith('Course Code')) {
        const m = line.match(/Course Code(.+?)(?:Credit Hours|$)/)
        if (m) courseCode = m[1].trim()
      }
      if (line.startsWith('Course Title')) {
        const m = line.match(/Course Title(.+?)(?:Category|Contact Hours|$)/)
        if (m) courseTitle = m[1].trim()
      }
      if (line.startsWith('Teacher Name')) {
        const m = line.match(/Teacher Name(.+?)(?:Visiting|$)/)
        if (m) teacherName = m[1].trim()
      }
      if (line.startsWith('Class')) {
        const m = line.match(/^Class(.+?)(?:Special|$)/)
        if (m) className = m[1].trim()
      }

      // New roadmap section → flush previous group
      if (line.startsWith('Program')) {
        const m = line.match(/Roadmap(.+?)$/)
        if (m) {
          const newRoadmap = m[1].trim()
          if (newRoadmap !== currentRoadmap) {
            flushCourse()
            currentRoadmap = newRoadmap
          }
        }
      }

      // Grading scheme line
      if (line.startsWith('Grading') && line.includes('A:')) {
        currentScheme = parseGradingScheme(line)
        inTable = false
      }

      // Table header
      if (line.startsWith('#Enrollment')) {
        inTable = true
        continue
      }

      // End of table
      if (line.includes('Bahria University') || line.includes('Award List') || line.includes('Printed on')) {
        inTable = false
      }

      // Student row: must contain an enrollment number
      if (inTable && ENROLL_RE.test(line)) {
        const enrollMatch = line.match(ENROLL_RE)
        if (!enrollMatch) continue

        const enrollment = enrollMatch[1]
        const enrollIdx = line.indexOf(enrollment)
        const afterEnroll = line.substring(enrollIdx + enrollment.length)

        // Reg# is first 5-6 digits right after enrollment
        const regMatch = afterEnroll.match(/^(\d{5,6})/)
        if (!regMatch) continue
        const regNo = regMatch[1]
        const afterReg = afterEnroll.substring(regMatch[1].length)

        // Find marks block: may be on this line or on a following line
        // Pattern A: marks on same line → "SOME NAME1812181550D"
        // Pattern B: name wraps, marks on next line → "SOME NAME\nPART2\n1812181550D"
        let marksBlock = ''
        let nameRaw = ''
        let skipLines = 0

        const inlineMatch = afterReg.match(/(\d{8,12}[A-Z][+-]?)$/)
        if (inlineMatch) {
          // Marks found on same line
          marksBlock = inlineMatch[1]
          nameRaw = afterReg.substring(0, afterReg.length - marksBlock.length).trim()

          // Still check if next line is a name continuation (not marks)
          if (i + 1 < lines.length) {
            const next = lines[i + 1]
            if (next && /^[A-Z][A-Z\s]+$/.test(next) && !ENROLL_RE.test(next) && next.length < 40 && !/^\d{8,12}[A-Z]/.test(next)) {
              nameRaw = (nameRaw + ' ' + next).trim()
              skipLines = 1
            }
          }
        } else {
          // Marks not on this line — name continues on next line(s), marks on a later line
          // Accumulate name continuation lines then find marks line
          let nameParts = [afterReg.trim()]
          let j = i + 1
          while (j < lines.length && j <= i + 3) {
            const nextLine = lines[j]
            // Is this the marks line? Pure digits + grade, no letters except trailing grade
            if (/^\d{8,12}[A-Z][+-]?$/.test(nextLine)) {
              marksBlock = nextLine
              skipLines = j - i
              break
            }
            // Is it a name continuation? All uppercase letters/spaces, no enrollment
            if (/^[A-Z][A-Z\s]+$/.test(nextLine) && !ENROLL_RE.test(nextLine) && nextLine.length < 40) {
              nameParts.push(nextLine)
              j++
              continue
            }
            break
          }
          nameRaw = nameParts.join(' ').trim()
        }

        if (!marksBlock) continue
        const parsed = extractMarks(marksBlock)
        if (!parsed) continue

        i += skipLines

        currentStudents.push({
          enrollment,
          reg_no: regNo,
          name: nameRaw,
          assign_marks: parsed.assign,
          quiz_marks: parsed.quiz,
          mid_marks: parsed.mid,
          final_marks: parsed.final,
          total: parsed.total,
          original_grade: parsed.grade,
          roadmap: currentRoadmap,
        })
      }
    }

    flushCourse()

    if (courses.length === 0) {
      return NextResponse.json({
        error: 'Could not parse student data from this PDF.',
        debug: lines.slice(0, 30)
      }, { status: 422 })
    }

    return NextResponse.json({ courses })
  } catch (err: unknown) {
    console.error('PDF parse error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
