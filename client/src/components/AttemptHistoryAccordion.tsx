import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FeedbackView } from '@/components/FeedbackView'
import type { AttemptHistoryItem } from '@/types'

function scoreVariant(score: number): 'success' | 'warning' | 'destructive' {
  if (score >= 75) return 'success'
  if (score >= 50) return 'warning'
  return 'destructive'
}

function statusVariant(status: AttemptHistoryItem['status']): 'success' | 'destructive' | 'secondary' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

interface Props {
  attempts: AttemptHistoryItem[]
  onTryAgain?: (attempt: AttemptHistoryItem) => void
  onRetry?: (attemptId: string) => void
  retryingIds?: Set<string>
}

export function AttemptHistoryAccordion({ attempts, onTryAgain, onRetry, retryingIds }: Props) {
  if (attempts.length === 0) {
    return <p className="text-sm text-muted-foreground">No attempts yet.</p>
  }

  return (
    <Accordion type="single" collapsible className="rounded-lg border border-border">
      {attempts.map((attempt) => (
        <AccordionItem key={attempt.id} value={attempt.id} className="px-4">
          <AccordionTrigger>
            <div className="flex flex-wrap items-center gap-2 pr-2 text-sm">
              <span className="text-muted-foreground">{new Date(attempt.createdAt).toLocaleString()}</span>
              <span className="font-semibold">{attempt.problemTitle}</span>
              {attempt.feedback && (
                <Badge variant={scoreVariant(attempt.feedback.overallScore)}>
                  {attempt.feedback.overallScore}/100
                </Badge>
              )}
              <Badge variant={statusVariant(attempt.status)}>{attempt.status}</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            {attempt.submission.text && (
              <div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">Your submission</p>
                <ScrollArea className="max-h-48 rounded-md border border-border">
                  <div className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs text-muted-foreground">
                    {attempt.submission.assumptions && (
                      <p className="mb-2">
                        <span className="font-semibold">Assumptions:</span> {attempt.submission.assumptions}
                      </p>
                    )}
                    {attempt.submission.text}
                  </div>
                </ScrollArea>
              </div>
            )}

            <FeedbackView
              attempt={attempt}
              showHeader={false}
              onRetry={onRetry}
              retrying={retryingIds?.has(attempt.id)}
            />

            {onTryAgain && (
              <Button variant="outline" size="sm" onClick={() => onTryAgain(attempt)}>
                Attempt Again
              </Button>
            )}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
