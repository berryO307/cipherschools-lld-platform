import type { Criterion } from './Rubric.js';

export interface Problem {
  id: string;
  slug: string;
  title: string;
  description: string;
  requirements: string[];
  rubric: Criterion[];
}
