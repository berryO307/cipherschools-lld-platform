import type { RubricItemResult } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function scoreVariant(score: number): 'success' | 'warning' | 'destructive' {
  if (score >= 75) return 'success'
  if (score >= 50) return 'warning'
  return 'destructive'
}

// Rescale a legacy 0-1 confidence value into the current 0-100 scale, and
// guard against non-numeric/out-of-range values from older or malformed
// stored evaluations (the rubric shape has changed more than once).
function normalizeConfidence(value: unknown): number {
  const num = typeof value === 'number' && !Number.isNaN(value) ? value : 0
  const scaled = num > 0 && num <= 1 ? num * 100 : num
  return Math.min(100, Math.max(0, Math.round(scaled)))
}

function normalizeScore(value: unknown): number {
  const num = typeof value === 'number' && !Number.isNaN(value) ? value : 0
  return Math.min(100, Math.max(0, Math.round(num)))
}

interface Props {
  // Partial + unknown fallbacks: older stored evaluations may use a
  // different field name (criterionId) or be missing fields entirely.
  result: Partial<RubricItemResult> & { criterionId?: string }
}

export function CriterionResultCard({ result }: Props) {
  const label = result.criterion?.trim() || result.criterionId || 'Criterion'
  const score = normalizeScore(result.score)
  const confidence = normalizeConfidence(result.confidence)
  const evidence = result.evidence?.trim()
  const concern = result.concern?.trim()
  const suggestion = result.suggestion?.trim()

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{label}</CardTitle>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={scoreVariant(score)}>{score}/100</Badge>
          <Badge variant="outline">{confidence}% confident</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {evidence && (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Evidence</p>
            <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground">
              "{evidence}"
            </blockquote>
          </div>
        )}
        {concern && (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Concern</p>
            <p className={cn(score < 50 && 'text-destructive')}>{concern}</p>
          </div>
        )}
        {suggestion && (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Suggestion</p>
            <p>{suggestion}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
