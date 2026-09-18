import express from 'express';
import cors from 'cors';
import problemsRouter from './routes/problems.routes.js';
import attemptsRouter from './routes/attempts.routes.js';
import usersRouter from './routes/users.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/problems', problemsRouter);
  app.use('/api/attempts', attemptsRouter);
  app.use('/api/me', usersRouter);

  return app;
}
