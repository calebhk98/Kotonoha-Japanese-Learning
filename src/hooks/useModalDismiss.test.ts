// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useModalDismiss } from './useModalDismiss';

describe('useModalDismiss (#259 C3)', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderHook(() => useModalDismiss(onClose));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose for other keys', () => {
    const onClose = vi.fn();
    renderHook(() => useModalDismiss(onClose));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('onBackdropClick closes only when the event target IS the backdrop element itself', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useModalDismiss(onClose));

    const backdrop = document.createElement('div');
    const card = document.createElement('div');
    backdrop.appendChild(card);

    // Click bubbled up from an inner element (card) — currentTarget (backdrop)
    // differs from target (card), so this must NOT close the modal.
    result.current.onBackdropClick({ target: card, currentTarget: backdrop } as any);
    expect(onClose).not.toHaveBeenCalled();

    // Click directly on the backdrop — target === currentTarget — closes.
    result.current.onBackdropClick({ target: backdrop, currentTarget: backdrop } as any);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes the keydown listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useModalDismiss(onClose));
    unmount();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
