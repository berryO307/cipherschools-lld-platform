import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { problems } from '../db/schema.js';
import type { Problem } from '../domain/Problem.js';

export class ProblemRepository {
  async listAll(): Promise<Problem[]> {
    const rows = await db.select().from(problems);
    return rows.map(toDomain);
  }

  async getById(id: string): Promise<Problem | null> {
    const rows = await db.select().from(problems).where(eq(problems.id, id));
    return rows[0] ? toDomain(rows[0]) : null;
  }
}

function toDomain(row: typeof problems.$inferSelect): Problem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    requirements: row.requirements,
    rubric: row.rubric,
  };
}
