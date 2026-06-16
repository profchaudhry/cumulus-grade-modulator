export interface GradingScheme {
  [grade: string]: { min: number; max: number }
}

export interface ParsedStudent {
  enrollment: string
  reg_no: string
  name: string
  assign_marks: number
  quiz_marks: number
  mid_marks: number
  final_marks: number
  total: number
  original_grade: string
  roadmap: string
}

export interface ParsedCourse {
  course_code: string
  course_title: string
  teacher_name: string
  class_name: string
  grading_scheme: GradingScheme
  students: ParsedStudent[]
  roadmap: string
}

export interface Ranges {
  a: number    // range for grade A (exactly A, not A-)
  other: number // range for A- through D
  f: number    // range for F
}

export interface StudentRow {
  id: string
  session_id: string
  enrollment: string
  reg_no: string
  name: string
  assign_marks: number
  quiz_marks: number
  mid_marks: number
  final_marks: number
  total: number
  original_grade: string
  roadmap: string
  suggested_addition: number
  new_total: number
  new_grade: string
}

export interface Session {
  id: string
  created_at: string
  pdf_name: string
  course_code: string
  course_title: string
  teacher_name: string
  class: string
  ranges: Ranges | null
}

// Standard Bahria grading scheme
export const STANDARD_GRADING: GradingScheme = {
  'A':  { min: 85, max: 100 },
  'A-': { min: 80, max: 84 },
  'B+': { min: 75, max: 79 },
  'B':  { min: 71, max: 74 },
  'B-': { min: 68, max: 70 },
  'C+': { min: 64, max: 67 },
  'C':  { min: 60, max: 63 },
  'C-': { min: 57, max: 59 },
  'D+': { min: 53, max: 56 },
  'D':  { min: 50, max: 52 },
  'F':  { min: 0,  max: 49 },
}

export function getGradeForTotal(total: number, scheme: GradingScheme = STANDARD_GRADING): string {
  for (const [grade, range] of Object.entries(scheme)) {
    if (total >= range.min && total <= range.max) return grade
  }
  return 'F'
}

export function computeSuggestion(
  student: ParsedStudent,
  ranges: Ranges,
  scheme: GradingScheme = STANDARD_GRADING
): { suggested_addition: number; new_total: number; new_grade: string } {
  const total = student.total
  const currentGrade = student.original_grade

  // Determine which range bucket applies
  let rangeBucket: number
  if (currentGrade === 'F') {
    rangeBucket = ranges.f
  } else if (currentGrade === 'A') {
    rangeBucket = ranges.a
  } else {
    rangeBucket = ranges.other
  }

  // Find the boundary the student is trying to cross
  // i.e. what's the minimum of the next grade up?
  const gradeOrder = ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']
  const currentIdx = gradeOrder.indexOf(currentGrade)

  if (currentGrade === 'A') {
    // Already at top grade, no suggestion needed
    return { suggested_addition: 0, new_total: total, new_grade: 'A' }
  }

  const nextGrade = gradeOrder[currentIdx + 1]
  if (!nextGrade) {
    return { suggested_addition: 0, new_total: total, new_grade: currentGrade }
  }

  const nextGradeMin = scheme[nextGrade]?.min ?? total + 999
  const marksNeeded = nextGradeMin - total

  if (marksNeeded <= rangeBucket && marksNeeded > 0) {
    // Suggest adding exactly the marks needed to hit the next grade
    const addition = marksNeeded
    const newTotal = total + addition
    return {
      suggested_addition: addition,
      new_total: newTotal,
      new_grade: getGradeForTotal(newTotal, scheme),
    }
  }

  // No change suggestion
  return { suggested_addition: 0, new_total: total, new_grade: currentGrade }
}
