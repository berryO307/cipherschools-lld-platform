import { describe, expect, it } from 'vitest';
import { Attempt, InvalidAttemptTransitionError } from './Attempt.js';

function makeAttempt(status: 'submitted' | 'evaluating' | 'completed' | 'failed' = 'submitted') {
  return new Attempt('attempt-1', 'user-1', 'problem-1', status);
}

describe('Attempt state machine', () => {
  it('starts in the given status', () => {
    const attempt = makeAttempt('submitted');
    expect(attempt.getStatus()).toBe('submitted');
  });

  it('allows submitted -> evaluating', () => {
    const attempt = makeAttempt('submitted');
    attempt.transitionTo('evaluating');
    expect(attempt.getStatus()).toBe('evaluating');
  });

  it('allows evaluating -> completed', () => {
    const attempt = makeAttempt('evaluating');
    attempt.transitionTo('completed');
    expect(attempt.getStatus()).toBe('completed');
  });

  it('allows evaluating -> failed', () => {
    const attempt = makeAttempt('evaluating');
    attempt.transitionTo('failed');
    expect(attempt.getStatus()).toBe('failed');
  });

  it('rejects submitted -> completed (skipping evaluating)', () => {
    const attempt = makeAttempt('submitted');
    expect(() => attempt.transitionTo('completed')).toThrow(InvalidAttemptTransitionError);
    expect(attempt.getStatus()).toBe('submitted');
  });

  it('rejects submitted -> failed (skipping evaluating)', () => {
    const attempt = makeAttempt('submitted');
    expect(() => attempt.transitionTo('failed')).toThrow(InvalidAttemptTransitionError);
  });

  it('allows failed -> evaluating (retrying a failed evaluation)', () => {
    const attempt = makeAttempt('failed');
    attempt.transitionTo('evaluating');
    expect(attempt.getStatus()).toBe('evaluating');
  });

  it('rejects failed -> completed directly (must go through evaluating again)', () => {
    const attempt = makeAttempt('failed');
    expect(() => attempt.transitionTo('completed')).toThrow(InvalidAttemptTransitionError);
  });

  it('rejects any transition out of the terminal completed state', () => {
    const attempt = makeAttempt('completed');
    expect(() => attempt.transitionTo('evaluating')).toThrow(InvalidAttemptTransitionError);
    expect(() => attempt.transitionTo('failed')).toThrow(InvalidAttemptTransitionError);
  });

  it('canTransitionTo reports validity without mutating state', () => {
    const attempt = makeAttempt('submitted');
    expect(attempt.canTransitionTo('evaluating')).toBe(true);
    expect(attempt.canTransitionTo('completed')).toBe(false);
    expect(attempt.getStatus()).toBe('submitted');
  });
});
