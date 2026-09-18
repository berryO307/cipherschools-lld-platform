# AI Usage Log

This project was built with Claude Code (Anthropic) as a pair-programming assistant.
This log documents four specific, meaningful instances where AI-proposed direction
was accepted, corrected, or rejected during development, and why.

## 1. Monolith vs. Microservices / Job Queue

**Context:** Deciding how to run LLM evaluation without blocking the
`POST /api/attempts` response, given the evaluator call can take several seconds.

**AI proposal:** Wire in a proper background job queue (BullMQ + Redis) with a
separate worker process consuming evaluation jobs — the "correct" production
pattern for decoupling slow work from the request/response cycle.

**Decision: rejected.** This was scope creep relative to the project's timebox and
its explicit "no over-engineering" goal. A single Express process with a
fire-and-forget async function (`void this.processNewAttempt(id).catch(...)`)
achieves the same non-blocking behavior for this scale, keeps the whole system a
single deployable monolith, and avoids introducing Redis as an infrastructure
dependency for an MVP with no measured load problem. The `Attempt` state machine
(`submitted → evaluating → completed/failed`) is written so a real queue could
replace the in-process trigger later without changing the states themselves — the
door is open, but walking through it wasn't justified yet.

## 2. Deterministic vs. AI Rubric Separation

**Context:** Early evaluation design had the LLM score "Submission present" and
"Minimum detail" as rubric criteria alongside real architectural dimensions
(Responsibility Clarity, SOLID, etc.), because it was simplest to fold every check
into one prompt.

**Problem surfaced:** This mixed trivial structural checks into the same feedback
list as real design judgment, confusing the UI (a learner would see "is your text
empty" scored next to "does this violate the Open/Closed Principle") and wasting an
LLM call on submissions that were obviously incomplete.

**Decision: refactored.** Moved deterministic validation
(`SubmissionValidator.validateSubmissionText`) into the Express route itself,
running synchronously *before* an `Attempt` is even created — a submission under 50
characters gets an immediate `400`, never touches the database, and never invokes
Gemini. The rubric sent to the LLM now contains only the four architectural
dimensions, and the resulting `Feedback` never contains a non-architectural entry.
This was a direct instruction ("Do NOT send 'Submission present' as a rubric
criterion to the LLM") that named a real bug in the existing design, not a
speculative improvement.

## 3. JSON Parsing Stability

**Context:** After switching the LLM evaluator to a newer Gemini model, evaluations
started intermittently failing with `Failed to parse LLM output as JSON`.

**Diagnosis (AI-assisted):** The model in use is a reasoning ("thinking") model —
it spends part of its `maxOutputTokens` budget on internal reasoning before writing
the actual JSON answer, and under a modest token cap that reasoning could consume
the whole budget and truncate the JSON mid-object.

**Decision: fixed, not worked around.** Rather than silently swapping to a
non-reasoning model (an earlier, since-reverted fix), the actual root cause was
addressed: `thinkingConfig.thinkingBudget: 0` disables the reasoning pass entirely
so the model writes the schema-constrained JSON directly, `responseMimeType:
"application/json"` + an explicit `responseSchema` constrain the output shape at
the API level (not just via prompt instructions), and the call is wrapped so a
`finishReason !== 'STOP'` (any other truncation cause) or a malformed JSON parse
both resolve to a specific, informative error rather than a generic failure — all
caught inside `AttemptService`'s try/catch and persisted as the attempt's
`failureReason`, never left as an unhandled rejection.

## 4. Data Preservation on Failure

**Context:** After the JSON-parsing bug above produced a handful of visibly
"corrupted" `failed` attempts in the database, a request came in to wipe them
manually via `DELETE FROM evaluations WHERE status = 'failed'` before taking
product screenshots, framed as balancing "preserve data on failure" with wanting a
clean demo.

**Decision: rejected the raw delete, built the actual feature instead.** The
suggested SQL was also incorrect on its own terms (`status` is a column on
`attempts`, not `evaluations` — a failed attempt has no evaluation row at all,
since one is only ever saved on success), but more importantly, deleting a failed
attempt to "clean up" a demo directly contradicts the assignment's requirement to
never lose a learner's submission on failure. Instead: extended the `Attempt` state
machine to allow `failed → evaluating`, added a dedicated
`POST /api/attempts/:id/retry` endpoint that re-runs the evaluator against the
*existing, untouched* submission, and replaced the raw error message in the UI with
a friendly alert plus a "Retry Evaluation" action. Verified live against the actual
corrupted row from the bug above: it now resolves to `completed` with real
feedback, with the original submission never deleted or re-typed.
