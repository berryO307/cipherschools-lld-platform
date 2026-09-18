export interface ProblemSummary {
  id: string
  slug: string
  title: string
  description: string
}

export interface Criterion {
  id: string
  name: string
  description: string
}

export interface ProblemDetail extends ProblemSummary {
  requirements: string[]
  rubric: Criterion[]
}

export type AttemptStatus = 'submitted' | 'evaluating' | 'completed' | 'failed'

export interface RubricItemResult {
  criterion: string
  score: number
  evidence: string
  concern: string
  suggestion: string
  confidence: number // 0-100
}

export interface FeedbackSummary {
  overallScore: number
  summary: string
  generatedBy: 'llm' | 'human' | 'rule_based'
  results: RubricItemResult[]
}

export interface AttemptHistoryItem {
  id: string
  problemId: string
  problemTitle: string
  problemSlug: string
  status: AttemptStatus
  createdAt: string
  failureReason: string | null
  submission: {
    text: string
    assumptions?: string
  }
  feedback: FeedbackSummary | null
}
