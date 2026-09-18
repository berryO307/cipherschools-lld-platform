import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { problems, users } from '../db/schema.js';
import { SEED_PROBLEMS } from './problems.data.js';

async function seed() {
  console.log('Seeding problems...');

  for (const problem of SEED_PROBLEMS) {
    await db
      .insert(problems)
      .values(problem)
      .onConflictDoUpdate({
        target: problems.slug,
        set: {
          title: problem.title,
          description: problem.description,
          requirements: problem.requirements,
          rubric: problem.rubric,
        },
      });
  }

  console.log('Seeding demo user...');
  await db
    .insert(users)
    .values({ email: 'demo@lld-practice.local', displayName: 'Demo Learner' })
    .onConflictDoNothing({ target: users.email });

  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'demo@lld-practice.local'))
    .limit(1);

  console.log('Seed complete.');
  console.log(`Demo user id: ${demoUser?.id}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
