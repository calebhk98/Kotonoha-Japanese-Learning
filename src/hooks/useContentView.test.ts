// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentView } from './useContentView';

describe('useContentView (#259 B3)', () => {
  it('starts at intro', () => {
    const { result } = renderHook(({ id }) => useContentView(id), {
      initialProps: { id: 'story-1' },
    });
    expect(result.current[0]).toBe('intro');
  });

  it('persists the view across re-renders with the same content id', () => {
    const { result, rerender } = renderHook(({ id }) => useContentView(id), {
      initialProps: { id: 'story-1' },
    });

    act(() => {
      result.current[1]('consume');
    });
    expect(result.current[0]).toBe('consume');

    // Same id re-rendering (e.g. an in-place content edit, or a parent
    // re-render triggered by unrelated state) must NOT reset the view.
    rerender({ id: 'story-1' });
    expect(result.current[0]).toBe('consume');
  });

  it('resets to intro when the content id changes', () => {
    const { result, rerender } = renderHook(({ id }) => useContentView(id), {
      initialProps: { id: 'story-1' },
    });

    act(() => {
      result.current[1]('consume');
    });
    expect(result.current[0]).toBe('consume');

    rerender({ id: 'story-2' });
    expect(result.current[0]).toBe('intro');
  });

  it('survives an unmount/remount cycle when the parent keeps the setter state alive (simulated)', () => {
    // This mirrors the real bug: App unmounts ContentDetail while
    // WordDetailPage is shown, then remounts it on Back. Since useContentView
    // lives in the PARENT (not ContentDetail), a component that merely stops
    // rendering ContentDetail and later renders it again keeps the same hook
    // instance/state as long as the parent itself didn't unmount.
    const { result, rerender } = renderHook(({ id }) => useContentView(id), {
      initialProps: { id: 'story-1' },
    });

    act(() => {
      result.current[1]('consume');
    });

    // Re-render with the SAME id (simulating "ContentDetail temporarily not
    // rendered, then rendered again" from the parent's perspective — the
    // parent's hook state itself is untouched by whether a sibling
    // WordDetailPage was shown).
    rerender({ id: 'story-1' });
    expect(result.current[0]).toBe('consume');
  });
});
