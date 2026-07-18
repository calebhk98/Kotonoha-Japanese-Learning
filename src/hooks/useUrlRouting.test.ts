// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlRouting } from './useUrlRouting';

describe('useUrlRouting (#259 B3 / P9)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('navigateToWord pushes a /word/:word URL and sets selectedWord', () => {
    const setSelectedWord = vi.fn();
    const { result } = renderHook(() => useUrlRouting({ setSelectedWord }));

    act(() => {
      result.current.navigateToWord('猫');
    });

    expect(setSelectedWord).toHaveBeenCalledWith('猫');
    expect(window.location.pathname).toBe(`/word/${encodeURIComponent('猫')}`);
  });

  it('navigateBack pops browser history (via history.back) when the word view was reached by an in-app navigation', () => {
    const setSelectedWord = vi.fn();
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { result } = renderHook(() => useUrlRouting({ setSelectedWord }));

    act(() => {
      result.current.navigateToWord('猫');
    });
    act(() => {
      result.current.navigateBack();
    });

    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(setSelectedWord).toHaveBeenLastCalledWith(null);
    backSpy.mockRestore();
  });

  it('navigateBack does NOT call history.back() for a deep link with no prior in-app navigation (#259 P9)', () => {
    // Simulate landing directly on /word/:word (e.g. a shared link, or a
    // reload) — no navigateToWord call happened in this app instance.
    window.history.replaceState(null, '', '/word/%E7%8C%AB');

    const setSelectedWord = vi.fn();
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { result } = renderHook(() => useUrlRouting({ setSelectedWord }));

    act(() => {
      result.current.navigateBack();
    });

    expect(backSpy).not.toHaveBeenCalled();
    expect(setSelectedWord).toHaveBeenLastCalledWith(null);
    // Should land the user somewhere sane in-app (not mid-dead-end at the
    // stale /word/ URL) rather than leaving the app.
    expect(window.location.pathname).toBe('/');
    backSpy.mockRestore();
  });

  it('popstate sets selectedWord from the URL on back navigation', () => {
    const setSelectedWord = vi.fn();
    renderHook(() => useUrlRouting({ setSelectedWord }));

    act(() => {
      window.history.pushState({ type: 'word', word: '猫' }, '', '/word/%E7%8C%AB');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(setSelectedWord).toHaveBeenLastCalledWith('猫');
  });
});
