import { GoogleGenAI, Type } from '@google/genai';
import type { EvaluationEngine } from './EvaluationEngine.js';
import type { Submission } from './Submission.js';
import type { Rubric } from './Rubric.js';
import type { Feedback, RubricItemResult } from './Feedback.js';

const MODEL = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 4096;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Thrown for LLM-specific failure modes (quota exceeded, timeout, malformed
 * output) so AttemptService can store an informative failureReason instead of
 * a generic error message when it catches this and transitions the attempt
 * to 'failed'.
 */
export class LLMEvaluationError extends Error {}

/**
 * Heavy-judgment evaluator: the 4 architectural dimensions (responsibility
 * clarity, coupling/cohesion, SOLID/pattern adherence, extensibility). Only
 * invoked after the submission passes SubmissionValidator's deterministic
 * check at the API boundary — this evaluator never sees a trivially-invalid
 * submission and never scores "is the text present" alongside real design
 * judgment. Implements the same EvaluationEngine interface as any future
 * evaluator so AttemptService can treat them interchangeably (Change Test B).
 *
 * Backed by the Gemini API via @google/genai with structured (schema-
 * constrained) JSON output. gemini-3.6-flash is a reasoning ("thinking")
 * model — left unchecked, it spends part of maxOutputTokens on internal
 * reasoning before writing the JSON answer, which can truncate the JSON
 * mid-object under a modest token budget. thinkingConfig.thinkingBudget: 0
 * disables that reasoning pass entirely so the model writes the schema-
 * constrained JSON directly, and maxOutputTokens is sized generously as a
 * second line of defense.
 *
 * A transient 503 (model overloaded) is retried a couple of times with a
 * short delay before giving up. A 429 (quota exceeded) or a request timeout
 * is translated into an LLMEvaluationError with a clear message rather than
 * being allowed to crash the process — AttemptService catches this and
 * transitions the attempt to 'failed' with that message as the reason.
 */
export class LLMEvaluator implements EvaluationEngine {
  readonly kind = 'llm' as const;

  private readonly client: GoogleGenAI | null;

  constructor(private readonly apiKey: string | undefined = process.env.GEMINI_API_KEY) {
    this.client = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;
  }

  async evaluate(attemptId: string, submission: Submission, rubric: Rubric): Promise<Feedback> {
    const criteria = rubric.getAll();
    const content = submission.getEvaluableContent();
    const text = content.text ?? '';

    if (!this.client) {
      throw new LLMEvaluationError('GEMINI_API_KEY is not configured for LLMEvaluator');
    }

    const prompt = buildPrompt(text, criteria.map((c) => c.name));
    const criterionNames = criteria.map((c) => c.name);

    const { rawText, finishReason } = await this.callWithRetries(prompt, criterionNames);

    if (finishReason && finishReason !== 'STOP') {
      throw new LLMEvaluationError(
        `LLM response was incomplete (${finishReason}) — please try resubmitting.`,
      );
    }

    if (!rawText) {
      throw new LLMEvaluationError('LLM response contained no text output');
    }

    const { overallScore, summary, results } = parseFeedback(rawText, criterionNames);

    return {
      attemptId,
      generatedBy: 'llm',
      overallScore,
      summary,
      results,
    };
  }

  private async callWithRetries(
    prompt: string,
    criterionNames: string[],
  ): Promise<{ rawText: string | undefined; finishReason: string | undefined }> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await this.client!.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Disable the reasoning pass: left on, this model spends part of
            // maxOutputTokens "thinking" before writing JSON, which can
            // truncate the JSON mid-object.
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
            responseSchema: buildResponseSchema(criterionNames),
            abortSignal: controller.signal,
          },
        });
        return { rawText: response.text, finishReason: response.candidates?.[0]?.finishReason };
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempt === MAX_RETRIES) {
          throw mapGeminiError(err);
        }
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unreachable, but keeps TypeScript satisfied that every path returns/throws.
    throw mapGeminiError(lastError);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return false;
  const message = err instanceof Error ? err.message : String(err);
  return /503|UNAVAILABLE|overloaded|high demand/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapGeminiError(err: unknown): LLMEvaluationError {
  if (err instanceof Error && err.name === 'AbortError') {
    return new LLMEvaluationError(
      `LLM evaluation timed out after ${REQUEST_TIMEOUT_MS / 1000}s — please try resubmitting.`,
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/429|quota|rate.?limit/i.test(message)) {
    return new LLMEvaluationError('LLM quota exceeded — please wait a few minutes and try again.');
  }
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(message)) {
    return new LLMEvaluationError('LLM service is temporarily overloaded — please try resubmitting shortly.');
  }

  return new LLMEvaluationError(`LLM evaluation request failed: ${message}`);
}

const SYSTEM_PROMPT = `You are a Principal Software Architect evaluating Low-Level Design (LLD) submissions. Evaluate the candidate's design strictly against 4 core architectural dimensions:
1. Responsibility Clarity (Single Responsibility, clear boundaries)
2. Coupling & Cohesion (Information hiding, tight class focus)
3. SOLID & Pattern Adherence (Appropriate abstractions, no forced patterns)
4. Extensibility & Trade-offs (Handling requirement changes)

Scoring Guidelines:
- 90-100: Exceptional, production-ready abstractions.
- 70-89: Good design, minor leakages or missing edge cases.
- 50-69: Noticeable anti-patterns (e.g., God objects, tight coupling).
- Below 50: Fundamental misunderstanding of OOP/responsibilities.

Ground every score in the submission text itself — never invent details the candidate
did not write. If the submission does not address a dimension at all, score it low and
say so in that dimension's "concern" rather than guessing.`;

function buildPrompt(submissionText: string, criterionNames: string[]): string {
  const criteriaList = criterionNames.map((name) => `- ${name}`).join('\n');
  return `## Dimensions to evaluate\n${criteriaList}\n\n## Candidate's submission\n${submissionText}`;
}

function buildResponseSchema(criterionNames: string[]) {
  return {
    type: Type.OBJECT,
    properties: {
      overallScore: { type: Type.NUMBER, description: 'Overall design score, an integer from 0 to 100.' },
      summary: { type: Type.STRING, description: 'Brief 2-sentence summary of strengths and core weakness.' },
      rubric: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            criterion: { type: Type.STRING, enum: criterionNames },
            score: { type: Type.NUMBER, description: 'Score for this dimension, an integer from 0 to 100.' },
            evidence: { type: Type.STRING },
            concern: { type: Type.STRING },
            suggestion: { type: Type.STRING },
            confidence: {
              type: Type.NUMBER,
              description: 'Confidence in this specific judgment, an integer from 0 to 100 (not 0 to 1).',
            },
          },
          required: ['criterion', 'score', 'evidence', 'concern', 'suggestion', 'confidence'],
        },
      },
    },
    required: ['overallScore', 'summary', 'rubric'],
  };
}

function parseFeedback(
  rawText: string,
  criterionNames: string[],
): { overallScore: number; summary: string; results: RubricItemResult[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new LLMEvaluationError('Failed to parse LLM output as JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).rubric)) {
    throw new LLMEvaluationError('LLM output did not match the expected { overallScore, summary, rubric } shape');
  }

  const obj = parsed as { overallScore: unknown; summary: unknown; rubric: unknown[] };
  const knownCriteria = new Set(criterionNames);

  const results = obj.rubric
    .filter((item): item is Record<string, unknown> => knownCriteria.has(String((item as any)?.criterion)))
    .map((item) => ({
      criterion: String(item.criterion),
      score: clamp(Number(item.score) || 0, 0, 100),
      evidence: String(item.evidence ?? ''),
      concern: String(item.concern ?? ''),
      suggestion: String(item.suggestion ?? ''),
      confidence: normalizeConfidence(Number(item.confidence) || 0),
    }));

  return {
    overallScore: clamp(Number(obj.overallScore) || 0, 0, 100),
    summary: String(obj.summary ?? ''),
    results,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// The schema and prompt both ask for confidence on a 0-100 scale, but models
// sometimes still return a 0-1 fraction out of habit. Treat any value in
// (0, 1] as a fraction and rescale it, rather than silently clamping 0.95 to
// itself and displaying "0% confident".
function normalizeConfidence(value: number): number {
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return clamp(Math.round(normalized), 0, 100);
}
