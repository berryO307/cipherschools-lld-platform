import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

const router = Router();
const DEMO_EMAIL = 'demo@lld-practice.local';

// GET /api/me — MVP has no auth; returns (or lazily creates) a single demo
// user so the frontend has a stable userId to attribute attempts to.
router.get('/', async (_req, res) => {
  try {
    const [existing] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
    if (existing) {
      return res.json({ id: existing.id, displayName: existing.displayName, email: existing.email });
    }

    const [created] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, displayName: 'Demo Learner' })
      .returning();

    res.json({ id: created.id, displayName: created.displayName, email: created.email });
  } catch (err) {
    console.error('Failed to resolve demo user:', err);
    res.status(500).json({ error: 'Failed to resolve current user' });
  }
});

export default router;
