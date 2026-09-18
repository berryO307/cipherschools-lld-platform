export interface RubricItemResult {
  criterion: string; // display name, e.g. "Responsibility Clarity" — matches Criterion.name
  score: number; // 0-100
  evidence: string; // quote/reference drawn from the submission
  concern: string; // what's risky or missing ('' if none)
  suggestion: string; // concrete next step ('' if none)
  confidence: number; // 0-100, evaluator's confidence in this judgment
}

export type EvaluatorKind = 'llm' | 'human' | 'rule_based';

export interface Feedback {
  attemptId: string;
  generatedBy: EvaluatorKind;
  overallScore: number; // 0-100, reported directly by the evaluator
  summary: string; // 2-sentence overview of strengths + core weakness
  results: RubricItemResult[];
}
