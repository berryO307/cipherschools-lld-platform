import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rubric, type Criterion } from './Rubric.js';
import { TextSubmission } from './Submission.js';

const AI_CRITERIA: Criterion[] = [
  { id: 'responsibility-clarity', name: 'Responsibility Clarity', description: '' },
  { id: 'solid-principles', name: 'SOLID & Pattern Adherence', description: '' },
];

const rubric = Rubric.fromRows(AI_CRITERIA);

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: generateContentMock },
  })),
  Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER' },
}));

const { LLMEvaluator, LLMEvaluationError } = await import('./LLMEvaluator.js');

function objectResponse(body: unknown, finishReason = 'STOP') {
  return { text: JSON.stringify(body), candidates: [{ finishReason }] };
}

describe('LLMEvaluator', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws LLMEvaluationError when no API key is configured', async () => {
    const evaluator = new LLMEvaluator(undefined);
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('parses a well-formed structured response into Feedback with overallScore/summary from the LLM', async () => {
    generateContentMock.mockResolvedValue(
      objectResponse({
        overallScore: 76,
        summary: 'Solid separation of concerns, but the payment interface leaks cash-specific details.',
        rubric: [
          {
            criterion: 'Responsibility Clarity',
            score: 80,
            evidence: 'The Vehicle class owns license plate and type.',
            concern: '',
            suggestion: 'Consider splitting parking fee logic into its own class.',
            confidence: 90,
          },
          {
            criterion: 'SOLID & Pattern Adherence',
            score: 40,
            evidence: 'if/else branching on vehicle type',
            concern: 'Violates Open/Closed Principle.',
            suggestion: 'Use polymorphism instead of type-based branching.',
            confidence: 80,
          },
        ],
      }),
    );

    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design with if/else branching on vehicle type.');
    const feedback = await evaluator.evaluate('attempt-1', submission, rubric);

    expect(feedback.generatedBy).toBe('llm');
    expect(feedback.overallScore).toBe(76);
    expect(feedback.summary).toMatch(/payment interface leaks/);
    expect(feedback.results).toHaveLength(2);
    expect(feedback.results[0].criterion).toBe('Responsibility Clarity');
    expect(feedback.results[0].confidence).toBe(90);

    // requests structured JSON output constrained to a schema, not free-form prose
    const callArgs = generateContentMock.mock.calls[0][0];
    expect(callArgs.config.responseMimeType).toBe('application/json');
    expect(callArgs.config.responseSchema).toBeDefined();
    // reasoning disabled — otherwise thinking tokens can truncate the JSON mid-object
    expect(callArgs.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('normalizes a 0-1 fraction confidence into the expected 0-100 scale', async () => {
    generateContentMock.mockResolvedValue(
      objectResponse({
        overallScore: 80,
        summary: 'x',
        rubric: [
          { criterion: 'Responsibility Clarity', score: 80, evidence: '', concern: '', suggestion: '', confidence: 0.9 },
        ],
      }),
    );

    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    const feedback = await evaluator.evaluate('attempt-1', submission, rubric);
    expect(feedback.results[0].confidence).toBe(90);
  });

  it('drops rubric items whose criterion name is not part of the rubric', async () => {
    generateContentMock.mockResolvedValue(
      objectResponse({
        overallScore: 60,
        summary: 'x',
        rubric: [
          { criterion: 'Not A Real Dimension', score: 100, evidence: '', concern: '', suggestion: '', confidence: 100 },
          {
            criterion: 'Responsibility Clarity',
            score: 60,
            evidence: '',
            concern: '',
            suggestion: '',
            confidence: 70,
          },
        ],
      }),
    );

    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    const feedback = await evaluator.evaluate('attempt-1', submission, rubric);
    expect(feedback.results).toHaveLength(1);
    expect(feedback.results[0].criterion).toBe('Responsibility Clarity');
  });

  it('wraps a JSON parse failure in an informative LLMEvaluationError', async () => {
    generateContentMock.mockResolvedValue({ text: 'not valid json', candidates: [{ finishReason: 'STOP' }] });
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/parse/i);
  });

  it('rejects a response that is valid JSON but not the expected { overallScore, summary, rubric } shape', async () => {
    generateContentMock.mockResolvedValue(objectResponse([{ foo: 'bar' }]));
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/expected/i);
  });

  it('maps a 429/quota error to a clear quota-exceeded message without crashing', async () => {
    generateContentMock.mockRejectedValue(new Error('429 Too Many Requests: quota exceeded'));
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/quota exceeded/i);
  });

  it('maps an aborted (timed out) request to a clear timeout message', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    generateContentMock.mockRejectedValue(abortError);

    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/timed out/i);
  });

  it('wraps an unexpected SDK error without letting it propagate raw', async () => {
    generateContentMock.mockRejectedValue(new Error('socket hang up'));
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/socket hang up/);
  });

  it('treats a non-STOP finishReason (e.g. truncated by the token budget) as a clear failure, not a parse error', async () => {
    generateContentMock.mockResolvedValue({ text: '{"overallScore":5', candidates: [{ finishReason: 'MAX_TOKENS' }] });
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(LLMEvaluationError);
    await expect(evaluator.evaluate('attempt-1', submission, rubric)).rejects.toThrow(/incomplete \(MAX_TOKENS\)/i);
  });

  it('retries a transient 503/overloaded error and succeeds on a later attempt', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'))
      .mockResolvedValueOnce(
        objectResponse({
          overallScore: 70,
          summary: 'x',
          rubric: [
            { criterion: 'Responsibility Clarity', score: 70, evidence: '', concern: '', suggestion: '', confidence: 50 },
          ],
        }),
      );

    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');

    vi.useFakeTimers();
    const resultPromise = evaluator.evaluate('attempt-1', submission, rubric);
    await vi.runAllTimersAsync();
    const feedback = await resultPromise;

    expect(feedback.overallScore).toBe(70);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated 503s with a clear overloaded message', async () => {
    generateContentMock.mockRejectedValue(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'));
    const evaluator = new LLMEvaluator('fake-key');
    const submission = new TextSubmission('A design.');

    vi.useFakeTimers();
    const resultPromise = evaluator.evaluate('attempt-1', submission, rubric);
    const assertion = expect(resultPromise).rejects.toThrow(/overloaded/i);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
