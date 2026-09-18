/**
 * Integration-style tests for the Attempt submission/retry/resilience flow.
 *
 * Rather than pointing at a real Neon database and a real Gemini API key,
 * this file replaces the `db` module with a small in-memory fake and mocks
 * drizzle-orm's `eq`/`desc` helpers so that fake can interpret `.where(...)`
 * clauses. Everything else — Express routing, SubmissionValidator, the
 * Attempt state machine, AttemptService's orchestration — is the real code.
 * The LLM evaluator is swapped for a controllable test double via
 * AttemptService's constructor injection, never via network calls.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationEngine } from '../domain/EvaluationEngine.js';
import type { Feedback } from '../domain/Feedback.js';

// Both the submit and retry routes share one rate limiter (5/15min by
// default) — bump it so a full test run never trips 429 by accident.
process.env.SUBMIT_RATE_LIMIT = '1000';

// drizzle-orm's `eq`/`desc` build opaque SQL fragments against a real
// Postgres connection. Replaced with plain descriptors our fake db can read.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ __op: 'eq' as const, col, val }),
    desc: (col: unknown) => ({ __op: 'desc' as const, col }),
  };
});

const { fakeDb, seed, getRow, registerTable } = vi.hoisted(() => {
  const stores = new Map<object, Map<string, Record<string, unknown>>>();
  const columnKeyMap = new WeakMap<object, string>();

  function registerTable(table: object) {
    for (const [key, value] of Object.entries(table)) {
      if (value && typeof value === 'object') columnKeyMap.set(value as object, key);
    }
  }

  function storeFor(table: object) {
    if (!stores.has(table)) stores.set(table, new Map());
    return stores.get(table)!;
  }

  function matches(row: Record<string, unknown>, cond: { col: unknown; val: unknown } | undefined): boolean {
    if (!cond) return true;
    const key = columnKeyMap.get(cond.col as object);
    return key !== undefined && row[key] === cond.val;
  }

  function makeChain(computeRows: () => Record<string, unknown>[]): any {
    const chain: any = {
      where: (cond: any) => makeChain(() => computeRows().filter((r) => matches(r, cond))),
      orderBy: () => chain,
      limit: (n: number) => makeChain(() => computeRows().slice(0, n)),
      innerJoin: () => chain,
      leftJoin: () => chain,
      then: (resolve: (rows: Record<string, unknown>[]) => void, reject: (err: unknown) => void) => {
        try {
          resolve(computeRows());
        } catch (err) {
          reject(err);
        }
      },
    };
    return chain;
  }

  const fakeDb = {
    select: (_cols?: unknown) => ({
      from: (table: object) => makeChain(() => Array.from(storeFor(table).values())),
    }),
    insert: (table: object) => ({
      values: (obj: Record<string, unknown>) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          failureReason: null,
          ...obj,
        };
        storeFor(table).set(row.id as string, row);
        return {
          returning: () => Promise.resolve([row]),
          then: (resolve: (v: undefined) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: object) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: any) => {
          const rows = Array.from(storeFor(table).values()).filter((r) => matches(r, cond));
          rows.forEach((r) => Object.assign(r, patch));
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  function seed(table: object, row: Record<string, unknown>) {
    registerTable(table);
    const full = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), failureReason: null, ...row };
    storeFor(table).set(full.id as string, full);
    return full;
  }

  function getRow(table: object, id: string) {
    return storeFor(table).get(id);
  }

  return { fakeDb, seed, getRow, registerTable };
});

vi.mock('../db/index.js', () => ({ db: fakeDb }));

// Imported dynamically, after the mocks above are registered, so every
// downstream import (routes, services, schema) resolves against the fake db.
const schema = await import('../db/schema.js');
registerTable(schema.attempts);
registerTable(schema.problems);
registerTable(schema.evaluations);

const { AttemptService } = await import('../services/AttemptService.js');
const { createApp } = await import('../app.js');

function seedProblem(overrides: Partial<Record<string, unknown>> = {}) {
  return seed(schema.problems, {
    slug: 'test-problem',
    title: 'Test Problem',
    description: 'A problem for tests.',
    requirements: ['Do the thing.'],
    rubric: [{ id: 'responsibility-clarity', name: 'Responsibility Clarity', description: '' }],
    ...overrides,
  });
}

function seedAttempt(problemId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return seed(schema.attempts, {
    userId: randomUUID(),
    problemId,
    status: 'submitted',
    submissionKind: 'text',
    submissionContent: { text: 'A'.repeat(60), assumptions: '' },
    ...overrides,
  });
}

function makeEvaluator(impl: EvaluationEngine['evaluate']): EvaluationEngine {
  return { kind: 'llm', evaluate: vi.fn(impl) };
}

async function flush() {
  // Fake db operations resolve on the microtask queue with no real I/O — a
  // couple of macrotask ticks is more than enough for the whole fire-and-
  // forget evaluation chain (load -> evaluate -> save -> transition) to settle.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('POST /api/attempts — deterministic validation', () => {
  const app = createApp();

  it('rejects an empty submission with 400, never touching the evaluator', async () => {
    const res = await request(app)
      .post('/api/attempts')
      .send({ userId: randomUUID(), problemId: randomUUID(), text: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects a submission under 50 characters with 400', async () => {
    const res = await request(app)
      .post('/api/attempts')
      .send({ userId: randomUUID(), problemId: randomUUID(), text: 'way too short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50 characters/i);
  });

  it('rejects a malformed request body (bad uuid) with 400', async () => {
    const res = await request(app)
      .post('/api/attempts')
      .send({ userId: 'not-a-uuid', problemId: randomUUID(), text: 'A'.repeat(60) });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/attempts/:id/retry — state machine', () => {
  const app = createApp();

  it('transitions a failed attempt to evaluating and responds 202', async () => {
    const problem = seedProblem();
    const attempt = seedAttempt(problem.id as string, {
      status: 'failed',
      failureReason: 'Failed to parse LLM output as JSON',
    });

    const res = await request(app).post(`/api/attempts/${attempt.id}/retry`);

    // retryAttempt awaits the 'evaluating' status update before responding,
    // so this response body is proof the transition already happened. We
    // don't re-read the row afterward: the route's LLMEvaluator has no real
    // API key in this test environment, so by the time the HTTP round-trip
    // completes, the background evaluation may already have failed fast and
    // moved the attempt on to 'failed' again — a separate, later transition
    // this test isn't about.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'evaluating' });
  });

  it('returns 409 Conflict when retrying an already-completed attempt', async () => {
    const problem = seedProblem();
    const attempt = seedAttempt(problem.id as string, { status: 'completed' });

    const res = await request(app).post(`/api/attempts/${attempt.id}/retry`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only 'failed' attempts can be retried/i);
    // A rejected retry must never mutate the attempt's status.
    expect(getRow(schema.attempts, attempt.id as string)?.status).toBe('completed');
  });

  it('returns 404 when the attempt does not exist', async () => {
    const res = await request(app).post(`/api/attempts/${randomUUID()}/retry`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed attempt id', async () => {
    const res = await request(app).post('/api/attempts/not-a-uuid/retry');
    expect(res.status).toBe(400);
  });
});

describe('Evaluation pipeline resilience', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('catches an evaluator error and marks the attempt failed, without throwing out of submitAttempt', async () => {
    const problem = seedProblem();
    const evaluator = makeEvaluator(async () => {
      throw new Error('LLM quota exceeded — please wait a few minutes and try again.');
    });
    const service = new AttemptService(undefined, evaluator);

    const { attemptId } = await service.submitAttempt({
      userId: randomUUID(),
      problemId: problem.id as string,
      text: 'A'.repeat(80),
    });
    await flush();

    const row = getRow(schema.attempts, attemptId);
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toMatch(/quota exceeded/i);
    expect(evaluator.evaluate).toHaveBeenCalledOnce();
    // The internal try/catch in AttemptService handled it — the outer
    // fire-and-forget safety net (console.error) was never needed.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('handles a non-Error rejection from the evaluator without crashing', async () => {
    const problem = seedProblem();
    const evaluator = makeEvaluator(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'a plain string rejection';
    });
    const service = new AttemptService(undefined, evaluator);

    const { attemptId } = await service.submitAttempt({
      userId: randomUUID(),
      problemId: problem.id as string,
      text: 'A'.repeat(80),
    });
    await flush();

    const row = getRow(schema.attempts, attemptId);
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('Unknown evaluation error');
  });

  it('does not run the evaluator at all when the attempt is missing its problem', async () => {
    const evaluator = makeEvaluator(async () => ({ attemptId: 'x', generatedBy: 'llm', overallScore: 0, summary: '', results: [] }) satisfies Feedback);
    const service = new AttemptService(undefined, evaluator);

    const missingProblemId = randomUUID();
    const { attemptId } = await service.submitAttempt({
      userId: randomUUID(),
      problemId: missingProblemId,
      text: 'A'.repeat(80),
    });
    await flush();

    const row = getRow(schema.attempts, attemptId);
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toMatch(/problem no longer exists/i);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });
});
