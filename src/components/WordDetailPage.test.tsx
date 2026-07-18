// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WordDetailPage } from './WordDetailPage';
import type { WordInfo } from '../types';

// A stable (module-level) empty array — WordDetailPage's data-fetch effect
// depends on [word, allWords], and passing a fresh `[]` literal on every
// render (the default parameter value does this too when the prop is
// omitted) causes an effect/re-render loop. Not one of the #259 findings in
// this session's scope, but worth flagging: production code
// (`allWords={Object.values(contentVocab).flat() as WordInfo[]}` in
// App.tsx) recomputes a new array each render too, which could cause
// unnecessary re-fetches whenever App re-renders for an unrelated reason.
const STABLE_WORDS: WordInfo[] = [];

// #259 I4: the loading/error states wired their header Back button to
// handleBack (restores window.scrollY from history.state.scrollPos), but the
// loaded/success state wired the SAME control straight to onBack, skipping
// the scroll restore. Same control, two behaviors depending on load timing.

describe('WordDetailPage back button (#259 I4)', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the saved scroll position on Back once word data has loaded (success state)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        word: '猫',
        reading: 'ねこ',
        meaning: 'cat',
        jlpt: 5,
        joyo: true,
        score: 10,
      }),
    });

    window.history.pushState({ scrollPos: 456 }, '', '/word/%E7%8C%AB');
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const onBack = vi.fn();

    render(<WordDetailPage word="猫" onBack={onBack} allWords={STABLE_WORDS} />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('猫'));

    fireEvent.click(screen.getByText('Back'));

    expect(onBack).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith(0, 456));
  });
});
