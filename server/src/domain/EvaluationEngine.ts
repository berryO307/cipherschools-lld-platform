import type { Submission } from './Submission.js';
import type { Rubric } from './Rubric.js';
import type { Feedback } from './Feedback.js';

/**
 * Strategy interface (Change Test B). AttemptService depends only on this
 * interface — swapping LLMEvaluator for a HumanEvaluator or RuleBasedEvaluator
 * later requires no change here and no change to the API layer, since every
 * implementation returns a Feedback. Deterministic checks are a separate,
 * synchronous concern handled at the API boundary (see SubmissionValidator)
 * before an Attempt is ever created, so they don't implement this interface.
 */
export interface EvaluationEngine {
  readonly kind: 'llm' | 'human' | 'rule_based';
  evaluate(attemptId: string, submission: Submission, rubric: Rubric): Promise<Feedback>;
}
