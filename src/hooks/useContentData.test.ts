// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentData } from './useContentData';
import type { WordInfo } from '../types';

vi.mock('../lib/api', () => ({
  extractVocabulary: vi.fn().mockResolvedValue([]),
}));

const makeWord = (word: string, score: number): WordInfo => ({
  word,
  reading: word,
  meaning: 'test',
  jlpt: 5,
  joyo: true,
  score,
  breakdown: {
    jlptScore: 15,
    joyoPenalty: 0,
    highestGrade: 1,
    freqPenalty: 0,
    jlptValues: [5],
    gradeValues: [1],
    priorities: [],
  },
});

const WORD_A = makeWord('水', 20);
const WORD_B = makeWord('食べる', 30);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// localStorage restore
// ---------------------------------------------------------------------------

describe('localStorage restore', () => {
  it('restores known words on mount', () => {
    localStorage.setItem('knownWords', JSON.stringify(['水', '食べる']));
    const { result } = renderHook(() => useContentData());
    expect(result.current.knownWords.has('水')).toBe(true);
    expect(result.current.knownWords.has('食べる')).toBe(true);
  });

  it('handles corrupted knownWords gracefully', () => {
    localStorage.setItem('knownWords', 'not json {{');
    expect(() => renderHook(() => useContentData())).not.toThrow();
  });

  it('restores content vocab on mount', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A, WORD_B] }));
    const { result } = renderHook(() => useContentData());
    expect(result.current.contentVocab['story-1']).toHaveLength(2);
  });

  it('discards vocab cache when jlptScore is missing from breakdown', () => {
    const outdated = { 'story-1': [{ ...WORD_A, breakdown: {} }] };
    localStorage.setItem('contentVocab', JSON.stringify(outdated));
    const { result } = renderHook(() => useContentData());
    expect(result.current.contentVocab['story-1']).toBeUndefined();
    expect(localStorage.getItem('contentVocab')).toBeNull();
  });

  it('discards vocab cache when highestGrade is missing from breakdown', () => {
    const outdated = { 'story-1': [{ ...WORD_A, breakdown: { jlptScore: 15 } }] };
    localStorage.setItem('contentVocab', JSON.stringify(outdated));
    const { result } = renderHook(() => useContentData());
    expect(result.current.contentVocab['story-1']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// markWordAsKnown
// ---------------------------------------------------------------------------

describe('markWordAsKnown', () => {
  it('adds the word to the known set', () => {
    const { result } = renderHook(() => useContentData());
    act(() => result.current.markWordAsKnown('水'));
    expect(result.current.knownWords.has('水')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useContentData());
    act(() => result.current.markWordAsKnown('水'));
    const saved = JSON.parse(localStorage.getItem('knownWords')!);
    expect(saved).toContain('水');
  });

  it('does not remove other known words', () => {
    const { result } = renderHook(() => useContentData());
    act(() => result.current.markWordAsKnown('水'));
    act(() => result.current.markWordAsKnown('食べる'));
    expect(result.current.knownWords.has('水')).toBe(true);
    expect(result.current.knownWords.has('食べる')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getContentStatus
// ---------------------------------------------------------------------------

describe('getContentStatus', () => {
  it('returns all zeros for unloaded content', () => {
    const { result } = renderHook(() => useContentData());
    const status = result.current.getContentStatus('nonexistent');
    expect(status.unknownCount).toBe(0);
    expect(status.totalCount).toBe(0);
    expect(status.score).toBe(0);
  });

  it('counts all words as unknown initially', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A, WORD_B] }));
    const { result } = renderHook(() => useContentData());
    const status = result.current.getContentStatus('story-1');
    expect(status.unknownCount).toBe(2);
    expect(status.totalCount).toBe(2);
  });

  it('reduces unknown count when words are marked known', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A, WORD_B] }));
    localStorage.setItem('knownWords', JSON.stringify(['水']));
    const { result } = renderHook(() => useContentData());
    const status = result.current.getContentStatus('story-1');
    expect(status.unknownCount).toBe(1);
    expect(status.totalCount).toBe(2);
  });

  it('returns zero unknown score when all words are known', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A, WORD_B] }));
    localStorage.setItem('knownWords', JSON.stringify(['水', '食べる']));
    const { result } = renderHook(() => useContentData());
    const status = result.current.getContentStatus('story-1');
    expect(status.unknownCount).toBe(0);
    expect(status.totalUnknownScore).toBe(0);
  });

  it('difficulty score accounts for both known and unknown words', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A, WORD_B] }));
    localStorage.setItem('knownWords', JSON.stringify(['水'])); // WORD_A known, WORD_B unknown
    const { result } = renderHook(() => useContentData());
    const status = result.current.getContentStatus('story-1');
    // score = totalUnknownScore + 0.5 * totalKnownScore = WORD_B.score + 0.5 * WORD_A.score
    expect(status.score).toBe(WORD_B.score + 0.5 * WORD_A.score);
  });
});

// ---------------------------------------------------------------------------
// clearContentVocab
// ---------------------------------------------------------------------------

describe('clearContentVocab', () => {
  it('resets contentVocab state to empty object', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A] }));
    const { result } = renderHook(() => useContentData());
    expect(result.current.contentVocab['story-1']).toBeDefined();
    act(() => result.current.clearContentVocab());
    expect(result.current.contentVocab).toEqual({});
  });

  it('removes contentVocab from localStorage', () => {
    localStorage.setItem('contentVocab', JSON.stringify({ 'story-1': [WORD_A] }));
    const { result } = renderHook(() => useContentData());
    act(() => result.current.clearContentVocab());
    expect(localStorage.getItem('contentVocab')).toBeNull();
  });

  it('does not affect known words', () => {
    localStorage.setItem('knownWords', JSON.stringify(['水']));
    const { result } = renderHook(() => useContentData());
    act(() => result.current.clearContentVocab());
    expect(result.current.knownWords.has('水')).toBe(true);
  });
});
