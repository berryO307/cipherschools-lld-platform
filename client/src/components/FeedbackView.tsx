import { AlertTriangle } from 'lucide-react'
import type { AttemptHistoryItem } from '@/types'
import { CriterionResultCard } from '@/components/CriterionResultCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface Props {
  attempt: AttemptHistoryItem
  /** Hide the "Feedback" title + score/generatedBy badges — use when a
   * parent (e.g. an accordion trigger) already displays the score. */
  showHeader?: boolean
  /** Called with the attempt id when "Retry Evaluation" is clicked. Omit to
   * hide the retry action (e.g. for a fresh, not-yet-persisted preview). */
  onRetry?: (attemptId: string) => void
  /** Shows a disabled/loading state on the retry button while a retry is in flight. */
  retrying?: boolean
}

const STATUS_LABEL: Record<AttemptHistoryItem['status'], string> = {
  submitted: 'Submitted',
  evaluating: 'Evaluating…',
  completed: 'Completed',
  failed: 'Failed',
}

export function FeedbackView({ attempt, showHeader = true, onRetry, retrying = false }: Props) {
  if (attempt.status === 'submitted' || attempt.status === 'evaluating') {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-6 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        {STATUS_LABEL[attempt.status]} — this can take a few seconds while the AI reviews your design.
      </div>
    )
  }

  // A 'failed' attempt only ever means the LLM evaluation itself errored
  // (quota, timeout, malformed output) — trivially-invalid submissions are
  // rejected with a 400 before an Attempt is ever created, so they never
  // reach this state with feedback attached. The submission itself is never
  // deleted on failure — only re-evaluated, via the retry action below.
  if (!attempt.feedback) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Evaluation failed</AlertTitle>
        <AlertDescription>
          <p>The AI evaluator timed out or returned an invalid response. Your submission is saved.</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={() => onRetry(attempt.id)} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry Evaluation'}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Feedback</h3>
          <div className="flex items-center gap-2">
            <Badge>Overall: {attempt.feedback.overallScore}/100</Badge>
            <Badge variant="outline">via {attempt.feedback.generatedBy}</Badge>
          </div>
        </div>
      )}
      {attempt.feedback.summary && (
        <p className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">{attempt.feedback.summary}</p>
      )}
      <div className="space-y-3">
        {attempt.feedback.results.map((result, i) => (
          // Older stored results may be missing `criterion` (renamed from
          // `criterionId`) — fall back to index so the key is always stable.
          <CriterionResultCard key={result.criterion ?? (result as { criterionId?: string }).criterionId ?? i} result={result} />
        ))}
      </div>
    </div>
  )
}
