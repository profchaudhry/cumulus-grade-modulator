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
  a: number      // range for boosting into A (e.g. A- student within 'a' marks of 85)
  other: number  // range for A- down to D+ (boosting to next grade up)
  f: number      // range for F (boosting out of F into D)
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
  pdf_row_order: number
  roadmap_row_order: number
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
  grading_scheme: GradingScheme | null
  roadmap_schemes: Record<string, GradingScheme> | null
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

// Grade order from lowest to highest
const GRADE_ORDER = ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']

export function computeSuggestion(
  student: ParsedStudent,
  ranges: Ranges,
  scheme: GradingScheme = STANDARD_GRADING
): { suggested_addition: number; new_total: number; new_grade: string } {
  const total = student.total
  const currentGrade = student.original_grade

  // Already at A — no uplift possible
  if (currentGrade === 'A') {
    return { suggested_addition: 0, new_total: total, new_grade: 'A' }
  }

  // Absent / withdrawn / not-yet-graded students (all component marks are 0)
  // should never receive a boost suggestion — they have no real performance to modulate.
  const hasNoMarks = student.assign_marks === 0 && student.quiz_marks === 0 &&
    student.mid_marks === 0 && student.final_marks === 0 && total === 0
  if (hasNoMarks) {
    return { suggested_addition: 0, new_total: total, new_grade: currentGrade }
  }

  // Determine the range bucket for this student's current grade
  let rangeBucket: number
  if (currentGrade === 'F') {
    rangeBucket = ranges.f
  } else if (currentGrade === 'A-') {
    // A- students are trying to reach A → use the 'a' range
    rangeBucket = ranges.a
  } else {
    rangeBucket = ranges.other
  }

  // Find what grade is one step above
  const currentIdx = GRADE_ORDER.indexOf(currentGrade)
  if (currentIdx === -1 || currentIdx === GRADE_ORDER.length - 1) {
    return { suggested_addition: 0, new_total: total, new_grade: currentGrade }
  }

  const nextGrade = GRADE_ORDER[currentIdx + 1]
  const nextGradeMin = scheme[nextGrade]?.min ?? (total + 999)
  const marksNeeded = nextGradeMin - total

  // Only suggest if the gap is within the range AND positive
  // e.g. range=2, need 2 marks → suggest +2 ✓
  // e.g. range=2, need 3 marks → no suggestion ✗
  // e.g. range=2, need 1 mark  → suggest +1 ✓ (within range)
  if (marksNeeded > 0 && marksNeeded <= rangeBucket) {
    const newTotal = total + marksNeeded
    return {
      suggested_addition: marksNeeded,
      new_total: newTotal,
      new_grade: getGradeForTotal(newTotal, scheme),
    }
  }

  return { suggested_addition: 0, new_total: total, new_grade: currentGrade }
}
