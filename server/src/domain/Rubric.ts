export interface Criterion {
  id: string;
  name: string;
  description: string;
}

export class Rubric {
  constructor(private readonly criteria: Criterion[]) {}

  getAll(): Criterion[] {
    return this.criteria;
  }

  static fromRows(rows: Criterion[]): Rubric {
    return new Rubric(rows);
  }
}
