import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import type { AttemptHistoryItem, ProblemDetail } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FeedbackView } from '@/components/FeedbackView'
import { AttemptHistoryAccordion } from '@/components/AttemptHistoryAccordion'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 60000
const MIN_SUBMISSION_LENGTH = 50

export function Workspace() {
  const { problemId } = useParams<{ problemId: string }>()
  const { user } = useCurrentUser()

  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [assumptions, setAssumptions] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeAttempt, setActiveAttempt] = useState<AttemptHistoryItem | null>(null)
  const [history, setHistory] = useState<AttemptHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('design')
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!problemId) return
    api.getProblem(problemId).then(setProblem).catch((err) => setError(err.message))
  }, [problemId])

  const loadHistory = async () => {
    if (!user) return
    const items = await api.getHistory(user.id)
    setHistory(items.filter((item) => item.problemId === problemId))
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, problemId])

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [])

  const pollForCompletion = (attemptId: string) => {
    const startedAt = Date.now()
    if (pollTimer.current) clearInterval(pollTimer.current)

    pollTimer.current = setInterval(async () => {
      if (!user) return
      try {
        const items = await api.getHistory(user.id)
        setHistory(items.filter((item) => item.problemId === problemId))
        const attempt = items.find((item) => item.id === attemptId)
        if (attempt) {
          // Only overwrite the live Design-tab preview if it's the same
          // attempt — a retry triggered from History shouldn't hijack an
          // unrelated in-progress preview.
          setActiveAttempt((prev) => (prev && prev.id === attempt.id ? attempt : prev))
          if (attempt.status === 'completed' || attempt.status === 'failed') {
            clearInterval(pollTimer.current!)
          }
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(pollTimer.current!)
        }
      } catch {
        clearInterval(pollTimer.current!)
      }
    }, POLL_INTERVAL_MS)
  }

  const handleSubmit = async () => {
    if (!user || !problem) return
    setError(null)
    setSubmitting(true)
    try {
      const { attemptId } = await api.submitAttempt({
        userId: user.id,
        problemId: problem.id,
        text,
        assumptions,
      })
      setActiveAttempt({
        id: attemptId,
        problemId: problem.id,
        problemTitle: problem.title,
        problemSlug: problem.slug,
        status: 'submitted',
        createdAt: new Date().toISOString(),
        failureReason: null,
        submission: { text, assumptions },
        feedback: null,
      })
      pollForCompletion(attemptId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit attempt')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetry = async (attemptId: string) => {
    setRetryingIds((prev) => new Set(prev).add(attemptId))
    // Optimistic: flip to 'evaluating' immediately so the UI shows the
    // pending state without waiting for the first poll tick.
    setHistory((prev) =>
      prev.map((a) => (a.id === attemptId ? { ...a, status: 'evaluating', failureReason: null } : a)),
    )
    setActiveAttempt((prev) =>
      prev && prev.id === attemptId ? { ...prev, status: 'evaluating', failureReason: null } : prev,
    )
    try {
      await api.retryAttempt(attemptId)
      pollForCompletion(attemptId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry evaluation')
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(attemptId)
        return next
      })
    }
  }

  const handleTryAgain = () => {
    setText('')
    setAssumptions('')
    setActiveAttempt(null)
    setError(null)
    setActiveTab('design')
  }

  if (!problem) {
    return <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">Loading problem…</div>
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← All problems
      </Link>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="history">History ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="design">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h1 className="text-xl font-semibold">{problem.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{problem.description}</p>
              <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Requirements
              </h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {problem.requirements.map((req, i) => (
                  <li key={i}>{req}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Assumptions (optional)</label>
                <Textarea
                  value={assumptions}
                  onChange={(e) => setAssumptions(e.target.value)}
                  placeholder="Any assumptions you're making about scope, scale, or constraints..."
                  className="min-h-16"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Your design</label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Describe your classes, their responsibilities, relationships, and reasoning..."
                  className="min-h-64"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {text.trim().length}/{MIN_SUBMISSION_LENGTH} characters minimum
                </p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                onClick={handleSubmit}
                disabled={submitting || text.trim().length < MIN_SUBMISSION_LENGTH}
                className="self-start"
              >
                {submitting ? 'Submitting…' : 'Submit for feedback'}
              </Button>

              {activeAttempt && (
                <div className="mt-4">
                  <FeedbackView
                    attempt={activeAttempt}
                    onRetry={handleRetry}
                    retrying={retryingIds.has(activeAttempt.id)}
                  />
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <AttemptHistoryAccordion
            attempts={history}
            onTryAgain={handleTryAgain}
            onRetry={handleRetry}
            retryingIds={retryingIds}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
