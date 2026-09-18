export type AttemptStatus = 'submitted' | 'evaluating' | 'completed' | 'failed';

const VALID_TRANSITIONS: Record<AttemptStatus, AttemptStatus[]> = {
  submitted: ['evaluating'],
  evaluating: ['completed', 'failed'],
  completed: [],
  // A failed evaluation (LLM timeout/quota/malformed output) can be retried
  // without losing the original submission — the data is never deleted, only
  // re-evaluated. 'completed' is terminal: once feedback exists, resubmitting
  // is a new Attempt, not a mutation of this one.
  failed: ['evaluating'],
};

/**
 * Encapsulates the Attempt lifecycle state machine. AttemptService is the
 * only place that mutates status, and it always goes through
 * Attempt.transitionTo so an invalid transition (e.g. completed -> evaluating)
 * throws instead of silently corrupting state.
 */
export class Attempt {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly problemId: string,
    private status: AttemptStatus,
  ) {}

  getStatus(): AttemptStatus {
    return this.status;
  }

  canTransitionTo(next: AttemptStatus): boolean {
    return VALID_TRANSITIONS[this.status].includes(next);
  }

  transitionTo(next: AttemptStatus): void {
    if (!this.canTransitionTo(next)) {
      throw new InvalidAttemptTransitionError(this.status, next);
    }
    this.status = next;
  }
}

export class InvalidAttemptTransitionError extends Error {
  constructor(from: AttemptStatus, to: AttemptStatus) {
    super(`Invalid attempt state transition: ${from} -> ${to}`);
    this.name = 'InvalidAttemptTransitionError';
  }
}
