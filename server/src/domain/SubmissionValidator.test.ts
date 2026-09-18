import { describe, expect, it } from 'vitest';
import { MIN_SUBMISSION_LENGTH, validateSubmissionText } from './SubmissionValidator.js';

describe('validateSubmissionText', () => {
  it('rejects undefined/missing text', () => {
    expect(validateSubmissionText(undefined)).toMatch(/required/i);
  });

  it('rejects an empty string', () => {
    expect(validateSubmissionText('')).toMatch(/required/i);
  });

  it('rejects whitespace-only text', () => {
    expect(validateSubmissionText('   \n\t  ')).toMatch(/required/i);
  });

  it('rejects text shorter than the minimum length', () => {
    const short = 'a'.repeat(MIN_SUBMISSION_LENGTH - 1);
    const result = validateSubmissionText(short);
    expect(result).toMatch(new RegExp(String(MIN_SUBMISSION_LENGTH)));
  });

  it('accepts text at exactly the minimum length', () => {
    const exact = 'a'.repeat(MIN_SUBMISSION_LENGTH);
    expect(validateSubmissionText(exact)).toBeNull();
  });

  it('accepts text longer than the minimum length', () => {
    expect(validateSubmissionText('a'.repeat(MIN_SUBMISSION_LENGTH + 100))).toBeNull();
  });

  it('measures length after trimming surrounding whitespace', () => {
    const padded = `   ${'a'.repeat(MIN_SUBMISSION_LENGTH)}   `;
    expect(validateSubmissionText(padded)).toBeNull();
  });
});
