// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LessonProcess } from './LessonProcess';
import type { WordInfo } from '../types';

// #259 P8: LessonProcess silently does `words.slice(0, 50)` — if the caller
// passes more than 50 unknown words, the rest are just dropped with no
// indication to the user that anything was cut.

function makeWord(word: string): WordInfo {
  return {
    word,
    reading: word,
    meaning: `meaning of ${word}`,
    jlpt: 5,
    joyo: true,
    score: 10,
  } as WordInfo;
}

describe('LessonProcess word cap indicator (#259 P8)', () => {
  it('shows a note when there are more unknown words than the 50-word lesson cap', () => {
    const words = Array.from({ length: 73 }, (_, i) => makeWord(`word${i}`));
    render(<LessonProcess words={words} onComplete={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/50 of 73/)).toBeTruthy();
  });

  it('shows no cap note when the word count is within the 50-word limit', () => {
    const words = Array.from({ length: 12 }, (_, i) => makeWord(`word${i}`));
    render(<LessonProcess words={words} onComplete={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText(/of 12/)).toBeNull();
  });
});
