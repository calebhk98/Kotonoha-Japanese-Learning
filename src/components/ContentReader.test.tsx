// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ContentReader } from './ContentReader';
import type { Content } from '../data/content';

const content: Content = {
  id: 'story-1',
  title: 'Test Story',
  type: 'story',
  description: 'desc',
  text: '猫が好きです。',
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ContentReader loading/error states (#259 B2)', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading indicator before the story tokens arrive', async () => {
    const d = deferred<Response>();
    (global.fetch as any).mockReturnValue(d.promise);

    render(<ContentReader content={content} onBack={vi.fn()} />);

    expect(screen.getByRole('status', { name: /loading/i })).toBeTruthy();

    // Resolve so the pending promise doesn't leak into other tests.
    d.resolve({ ok: true, json: async () => ({ tokens: [] }) } as any);
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).toBeNull());
  });

  it('shows an error affordance when both the content and fallback fetches fail', async () => {
    (global.fetch as any).mockImplementation(() => Promise.reject(new Error('network down')));

    render(<ContentReader content={content} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
  });

  it('renders the article once tokens load successfully (no loading/error UI left)', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        tokens: [
          {
            surface: '猫',
            startIndex: 0,
            endIndex: 1,
            isVocabWord: true,
            wordInfo: { word: '猫', reading: 'ねこ', meaning: 'cat', jlpt: 5, score: 10 },
          },
        ],
      }),
    });

    render(<ContentReader content={content} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Test Story')).toBeTruthy();
  });
});

describe('ContentReader word-token keyboard accessibility (#259 P3)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tokens: [
          {
            surface: '猫',
            startIndex: 0,
            endIndex: 1,
            isVocabWord: true,
            wordInfo: { word: '猫', reading: 'ねこ', meaning: 'cat', jlpt: 5, score: 10 },
          },
        ],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('word tokens are focusable and activate onWordClick on Enter', async () => {
    const onWordClick = vi.fn();
    render(<ContentReader content={content} onBack={vi.fn()} onWordClick={onWordClick} />);

    const focusable = await screen.findByRole('button', { name: /猫/ });
    expect(focusable.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(focusable, { key: 'Enter' });
    expect(onWordClick).toHaveBeenCalledWith('猫', 'ねこ', undefined);
  });

  it('word tokens activate onWordClick on Space', async () => {
    const onWordClick = vi.fn();
    render(<ContentReader content={content} onBack={vi.fn()} onWordClick={onWordClick} />);

    const focusable = await screen.findByRole('button', { name: /猫/ });

    fireEvent.keyDown(focusable, { key: ' ' });
    expect(onWordClick).toHaveBeenCalledWith('猫', 'ねこ', undefined);
  });
});
