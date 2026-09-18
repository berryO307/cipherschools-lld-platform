import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { attempts, evaluations, problems } from '../db/schema.js';
import { Attempt, type AttemptStatus } from '../domain/Attempt.js';
import { TextSubmission, type Submission } from '../domain/Submission.js';
import { Rubric } from '../domain/Rubric.js';
import { LLMEvaluator } from '../domain/LLMEvaluator.js';
import type { Feedback } from '../domain/Feedback.js';
import { ProblemRepository } from './ProblemRepository.js';
import type { EvaluationEngine } from '../domain/EvaluationEngine.js';

export interface SubmitAttemptInput {
  userId: string;
  problemId: string;
  text: string;
  assumptions?: string;
}

export class AttemptNotFoundError extends Error {
  constructor(attemptId: string) {
    super(`Attempt ${attemptId} not found`);
    this.name = 'AttemptNotFoundError';
  }
}

export class InvalidRetryStateError extends Error {
  constructor(currentStatus: AttemptStatus) {
    super(`Cannot retry an attempt in '${currentStatus}' state — only 'failed' attempts can be retried.`);
    this.name = 'InvalidRetryStateError';
  }
}

/**
 * Orchestrates the Attempt lifecycle. The deterministic "is this submission
 * even worth evaluating" check happens synchronously at the API boundary
 * (see SubmissionValidator + attempts.routes.ts) before an Attempt is ever
 * created, so every Attempt this service processes is guaranteed non-trivial
 * — this class only ever runs the LLM (architectural-judgment) evaluator.
 * It depends only on the EvaluationEngine interface, so swapping LLMEvaluator
 * for a different implementation (human review, rule-based) requires no
 * change here (Change Test B). It depends only on the Submission interface
 * for the payload, so a new submission kind requires no change either
 * (Change Test A).
 */
export class AttemptService {
  constructor(
    private readonly problemRepo: ProblemRepository = new ProblemRepository(),
    private readonly llmEvaluator: EvaluationEngine = new LLMEvaluator(),
  ) {}

  /**
   * Persists the Attempt in `submitted` state synchronously (so it is never
   * lost even if evaluation later fails/times out), then kicks off async
   * evaluation without blocking the caller. Returns immediately so the route
   * handler can respond 202 Accepted.
   */
  async submitAttempt(input: SubmitAttemptInput): Promise<{ attemptId: string }> {
    const submission = new TextSubmission(input.text, input.assumptions);

    const [row] = await db
      .insert(attempts)
      .values({
        userId: input.userId,
        problemId: input.problemId,
        status: 'submitted',
        submissionKind: submission.kind,
        submissionContent: submission.toPersistedContent(),
      })
      .returning();

    // Fire-and-forget: not awaited, so the HTTP response isn't blocked on the
    // (potentially slow) LLM call. Errors are caught and persisted as a
    // 'failed' attempt rather than crashing the process.
    void this.processNewAttempt(row.id).catch((err) => {
      console.error(`Unhandled error evaluating attempt ${row.id}:`, err);
    });

    return { attemptId: row.id };
  }

  /**
   * Re-runs the LLM evaluator on an existing, already-persisted submission —
   * the original text/assumptions are never touched or re-validated, only
   * re-evaluated. Only a 'failed' attempt can be retried (Attempt's state
   * machine enforces this); a 'completed' one is done, and a 'submitted' or
   * 'evaluating' one is already mid-flight.
   */
  async retryAttempt(attemptId: string): Promise<{ status: AttemptStatus }> {
    const row = await this.loadAttemptRow(attemptId);
    if (!row) {
      throw new AttemptNotFoundError(attemptId);
    }
    if (row.status !== 'failed') {
      throw new InvalidRetryStateError(row.status as AttemptStatus);
    }

    const attempt = new Attempt(row.id, row.userId, row.problemId, row.status as AttemptStatus);
    attempt.transitionTo('evaluating');
    await this.updateStatus(attemptId, 'evaluating');

    // Same fire-and-forget pattern as a fresh submission: the caller gets an
    // immediate 'evaluating' status, the actual LLM call runs in the background.
    void this.evaluateAndPersist(attemptId).catch((err) => {
      console.error(`Unhandled error retrying attempt ${attemptId}:`, err);
    });

    return { status: 'evaluating' };
  }

  /**
   * A single joined query rather than one attempts query plus a per-row
   * evaluations lookup (N+1): attempts -> problems (for display info) ->
   * evaluations (left join, since a still-evaluating or failed attempt has
   * none yet). Each Attempt has at most one saved Evaluation, so the join
   * can't fan out rows.
   */
  async getHistoryForUser(userId: string) {
    const rows = await db
      .select({
        id: attempts.id,
        problemId: attempts.problemId,
        problemTitle: problems.title,
        problemSlug: problems.slug,
        status: attempts.status,
        createdAt: attempts.createdAt,
        failureReason: attempts.failureReason,
        submissionContent: attempts.submissionContent,
        overallScore: evaluations.overallScore,
        summary: evaluations.summary,
        generatedBy: evaluations.generatedBy,
        results: evaluations.results,
      })
      .from(attempts)
      .innerJoin(problems, eq(attempts.problemId, problems.id))
      .leftJoin(evaluations, eq(evaluations.attemptId, attempts.id))
      .where(eq(attempts.userId, userId))
      .orderBy(desc(attempts.createdAt));

    return rows.map((row) => ({
      id: row.id,
      problemId: row.problemId,
      problemTitle: row.problemTitle,
      problemSlug: row.problemSlug,
      status: row.status,
      createdAt: row.createdAt,
      failureReason: row.failureReason,
      submission: {
        text: String(row.submissionContent?.text ?? ''),
        assumptions: String(row.submissionContent?.assumptions ?? ''),
      },
      feedback:
        row.overallScore !== null
          ? {
              overallScore: row.overallScore,
              summary: row.summary ?? '',
              generatedBy: row.generatedBy!,
              results: row.results ?? [],
            }
          : null,
    }));
  }

  /**
   * Idempotency guard: only ever processes an attempt that is still in
   * 'submitted' state. If this were invoked twice for the same attemptId
   * (e.g. a retried background job), the second call is a no-op.
   */
  private async processNewAttempt(attemptId: string): Promise<void> {
    const row = await this.loadAttemptRow(attemptId);
    if (!row || row.status !== 'submitted') {
      return;
    }

    const attempt = new Attempt(row.id, row.userId, row.problemId, row.status as AttemptStatus);
    attempt.transitionTo('evaluating');
    await this.updateStatus(attempt.id, 'evaluating');

    await this.evaluateAndPersist(attemptId);
  }

  /**
   * Shared by both a fresh submission and a retry: assumes the Attempt is
   * already in 'evaluating' state, runs the LLM evaluator against the
   * (already-persisted, untouched) submission, and transitions to
   * 'completed' or 'failed' based on the outcome.
   */
  private async evaluateAndPersist(attemptId: string): Promise<void> {
    const row = await this.loadAttemptRow(attemptId);
    if (!row) return;

    const attempt = new Attempt(row.id, row.userId, row.problemId, row.status as AttemptStatus);
    const problem = await this.problemRepo.getById(row.problemId);
    if (!problem) {
      attempt.transitionTo('failed');
      await this.updateStatus(attemptId, 'failed', 'Problem no longer exists.');
      return;
    }

    const rubric = Rubric.fromRows(problem.rubric);
    const submission: Submission = TextSubmission.fromPersistedContent(row.submissionContent);

    try {
      const feedback = await this.llmEvaluator.evaluate(attemptId, submission, rubric);
      await this.saveEvaluation(attemptId, feedback);
      attempt.transitionTo('completed');
      await this.updateStatus(attemptId, 'completed');
    } catch (err) {
      attempt.transitionTo('failed');
      const reason = err instanceof Error ? err.message : 'Unknown evaluation error';
      await this.updateStatus(attemptId, 'failed', reason);
    }
  }

  private async loadAttemptRow(attemptId: string) {
    const [row] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
    return row ?? null;
  }

  private async updateStatus(attemptId: string, status: AttemptStatus, failureReason?: string) {
    await db
      .update(attempts)
      .set({ status, failureReason: failureReason ?? null, updatedAt: new Date() })
      .where(eq(attempts.id, attemptId));
  }

  private async saveEvaluation(attemptId: string, feedback: Feedback) {
    await db.insert(evaluations).values({
      attemptId,
      generatedBy: feedback.generatedBy as 'llm',
      overallScore: feedback.overallScore,
      summary: feedback.summary,
      results: feedback.results,
    });
  }
}
