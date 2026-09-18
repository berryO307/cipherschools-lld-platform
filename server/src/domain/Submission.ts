/**
 * Normalized shape that evaluators consume. Every current/future Submission
 * kind must be able to reduce itself to this — evaluators never see the raw
 * per-kind payload directly.
 */
export interface EvaluableContent {
  text?: string;
  // structuredGraph?: Graph; — reserved for a future ClassDiagramSubmission
}

export type SubmissionKind = 'text'; // extend with 'class_diagram' later (Change Test A)

/**
 * A Submission is whatever a learner hands in for an Attempt. The evaluation
 * flow (EvaluationEngine implementations, AttemptService) depends only on
 * this interface, never on a concrete submission shape — so adding a new
 * submission format means adding one new class here, with zero changes to
 * the evaluation flow or persistence layer.
 */
export interface Submission {
  kind: SubmissionKind;
  isEmpty(): boolean;
  getEvaluableContent(): EvaluableContent;
  toPersistedContent(): Record<string, unknown>;
}

export class TextSubmission implements Submission {
  readonly kind = 'text' as const;

  constructor(
    private readonly text: string,
    private readonly assumptions: string = '',
  ) {}

  isEmpty(): boolean {
    return this.text.trim().length === 0;
  }

  getEvaluableContent(): EvaluableContent {
    const combined = this.assumptions
      ? `Assumptions:\n${this.assumptions}\n\nDesign:\n${this.text}`
      : this.text;
    return { text: combined };
  }

  toPersistedContent(): Record<string, unknown> {
    return { text: this.text, assumptions: this.assumptions };
  }

  static fromPersistedContent(content: Record<string, unknown>): TextSubmission {
    return new TextSubmission(
      String(content.text ?? ''),
      String(content.assumptions ?? ''),
    );
  }
}
