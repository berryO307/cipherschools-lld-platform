import type { Criterion } from '../domain/Rubric.js';

// The 4 fixed architectural dimensions the LLM evaluator scores every
// submission against (see LLMEvaluator's SYSTEM_PROMPT). Deterministic
// checks (submission present, minimum length) are no longer part of the
// rubric at all — they're rejected with an HTTP 400 at the API boundary
// before an Attempt is ever created (see SubmissionValidator), so they can
// never show up mixed in with real design feedback.
const RUBRIC: Criterion[] = [
  {
    id: 'responsibility-clarity',
    name: 'Responsibility Clarity',
    description: 'Single Responsibility, clear boundaries.',
  },
  {
    id: 'coupling-cohesion',
    name: 'Coupling & Cohesion',
    description: 'Information hiding, tight class focus.',
  },
  {
    id: 'solid-principles',
    name: 'SOLID & Pattern Adherence',
    description: 'Appropriate abstractions, no forced patterns.',
  },
  {
    id: 'extensibility',
    name: 'Extensibility & Trade-offs',
    description: 'Handling requirement changes.',
  },
];

export const SEED_PROBLEMS = [
  {
    slug: 'parking-lot',
    title: 'Design a Parking Lot',
    description:
      'Design the low-level classes for a multi-level parking lot system. Focus on how vehicles, spots, and the entry/exit flow are modeled — not the UI.',
    requirements: [
      'Support multiple vehicle types (motorcycle, car, bus) with different space needs.',
      'Support multiple spot sizes (small, medium, large) and match vehicles to compatible spots.',
      'Model entry: a vehicle arrives, is assigned an available compatible spot, and receives a ticket.',
      'Model exit: a vehicle presents its ticket, the fee is calculated based on duration, and the spot is freed.',
      'The design should make it easy to add a new vehicle type or a new pricing rule later.',
    ],
    rubric: RUBRIC,
  },
  {
    slug: 'elevator-system',
    title: 'Design an Elevator System',
    description:
      'Design the low-level classes for a multi-elevator system in a building. Focus on request scheduling and elevator state — not the physical hardware.',
    requirements: [
      'Support multiple elevators servicing multiple floors.',
      'Handle external requests (a floor button, up or down) and internal requests (a destination button inside a car).',
      'Decide which elevator should service a given request (a scheduling/dispatch strategy).',
      'Model each elevator\'s state (idle, moving up, moving down, doors open) and its transitions.',
      'The design should make it easy to swap the dispatch strategy (e.g., nearest-car vs. zone-based) later.',
    ],
    rubric: RUBRIC,
  },
  {
    slug: 'vending-machine',
    title: 'Design a Vending Machine',
    description:
      'Design the low-level classes for a vending machine. Focus on inventory, payment, and the dispensing workflow — not the physical mechanism.',
    requirements: [
      'Support multiple products, each with a price and a stock count.',
      'Accept payment (assume coins/cash for the MVP) and compute change.',
      'Model the machine\'s workflow as explicit states (idle, product selected, payment in progress, dispensing).',
      'Handle out-of-stock and insufficient-payment cases explicitly.',
      'The design should make it easy to add a new payment method (e.g., card) later without rewriting the core flow.',
    ],
    rubric: RUBRIC,
  },
];
