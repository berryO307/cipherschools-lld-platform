import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AttemptNotFoundError, AttemptService, InvalidRetryStateError } from '../services/AttemptService.js';
import { validateSubmissionText } from '../domain/SubmissionValidator.js';

const router = Router();
const attemptService = new AttemptService();

// Each submission triggers a Gemini API call — cap how often one client can
// trigger that to keep a shared/free-tier key from being exhausted by abuse.
const submitAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.SUBMIT_RATE_LIMIT) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this client — please wait before trying again.' },
});

const submitAttemptSchema = z.object({
  userId: z.string().uuid(),
  problemId: z.string().uuid(),
  text: z.string(),
  assumptions: z.string().optional(),
});

// POST /api/attempts — submit a design for evaluation. Persists synchronously
// and returns 202 immediately; evaluation runs asynchronously in the background.
router.post('/', submitAttemptLimiter, async (req, res) => {
  const parsed = submitAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  // Deterministic, fail-fast check — runs before any Attempt is persisted and
  // before Gemini is ever invoked, so a trivially-invalid submission never
  // consumes an LLM call and never shows up mixed in with real feedback.
  const validationError = validateSubmissionText(parsed.data.text);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const { attemptId } = await attemptService.submitAttempt(parsed.data);
    res.status(202).json({ attemptId, status: 'submitted' });
  } catch (err) {
    console.error('Failed to submit attempt:', err);
    res.status(500).json({ error: 'Failed to submit attempt' });
  }
});

// POST /api/attempts/:attemptId/retry — re-run the LLM evaluator on an
// existing, already-persisted submission (never deleted, never re-validated).
// Only a 'failed' attempt can be retried. Returns 202 immediately with the
// attempt back in 'evaluating' state; the LLM call runs in the background,
// same as the initial submission.
router.post('/:attemptId/retry', submitAttemptLimiter, async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.attemptId);
  if (!parsedId.success) {
    return res.status(400).json({ error: 'Invalid attempt id' });
  }

  try {
    const result = await attemptService.retryAttempt(parsedId.data);
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof AttemptNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof InvalidRetryStateError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Failed to retry attempt:', err);
    res.status(500).json({ error: 'Failed to retry attempt' });
  }
});

// GET /api/attempts/:userId/history — past attempts + latest feedback per attempt
router.get('/:userId/history', async (req, res) => {
  try {
    const history = await attemptService.getHistoryForUser(req.params.userId);
    res.json(history);
  } catch (err) {
    console.error('Failed to load attempt history:', err);
    res.status(500).json({ error: 'Failed to load attempt history' });
  }
});

export default router;
