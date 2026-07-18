// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportModal } from './ImportModal';

describe('ImportModal dismissal (#259 C3)', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ImportModal onClose={onClose} onImport={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ImportModal onClose={onClose} onImport={vi.fn()} />);

    // The heading text is unique to the modal card content.
    const heading = screen.getByText('Import Custom Content');
    // Walk up to the backdrop (the outer fixed inset-0 element).
    const backdrop = heading.closest('.fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the modal card', () => {
    const onClose = vi.fn();
    render(<ImportModal onClose={onClose} onImport={vi.fn()} />);

    fireEvent.click(screen.getByText('Import Custom Content'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
