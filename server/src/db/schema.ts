import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  integer,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const attemptStatusEnum = pgEnum('attempt_status', [
  'submitted',
  'evaluating',
  'completed',
  'failed',
]);

export const submissionKindEnum = pgEnum('submission_kind', [
  'text',
  // 'class_diagram' — reserved for a future submission format (Change Test A)
]);

export const evaluatorKindEnum = pgEnum('evaluator_kind', [
  'deterministic', // legacy value, no longer written — kept because Postgres enums can't drop values
  'llm',
  // 'human', 'rule_based' — reserved for future EvaluationStrategy implementations
]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

// ---------------------------------------------------------------------------
// problems
// ---------------------------------------------------------------------------

export const problems = pgTable('problems', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  // Ordered list of requirement strings shown in the practice workspace.
  requirements: jsonb('requirements').$type<string[]>().notNull(),
  // The rubric used to evaluate attempts for this problem — see domain/Rubric.ts
  // for the shape stored here. Kept per-problem so criteria can vary by problem
  // (today every problem uses the same fixed 4 architectural dimensions).
  rubric: jsonb('rubric').$type<RubricCriterionRow[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('problems_slug_idx').on(table.slug),
}));

export interface RubricCriterionRow {
  id: string;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// attempts
// ---------------------------------------------------------------------------

export const attempts = pgTable('attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  problemId: uuid('problem_id').notNull().references(() => problems.id),
  status: attemptStatusEnum('status').notNull().default('submitted'),

  // --- Submission payload (Change Test A: kind discriminates the shape) ---
  submissionKind: submissionKindEnum('submission_kind').notNull().default('text'),
  submissionContent: jsonb('submission_content').$type<Record<string, unknown>>().notNull(),

  failureReason: text('failure_reason'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// evaluations
// ---------------------------------------------------------------------------

export const evaluations = pgTable('evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id').notNull().references(() => attempts.id),
  generatedBy: evaluatorKindEnum('generated_by').notNull(),
  overallScore: integer('overall_score').notNull(),
  // 2-sentence overview of the design's strengths and core weakness.
  summary: text('summary').notNull().default(''),
  // Array of RubricItemResult objects — see domain/Feedback.ts for the shape.
  results: jsonb('results').$type<RubricItemResultRow[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export interface RubricItemResultRow {
  criterion: string;
  score: number;
  evidence: string;
  concern: string;
  suggestion: string;
  confidence: number;
}
