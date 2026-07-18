// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddWordModal } from './AddWordModal';

describe('AddWordModal (#259 C4 — replaces window.prompt)', () => {
  it('calls onAdd with the trimmed word and closes', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddWordModal onAdd={onAdd} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. 猫'), { target: { value: '  犬  ' } });
    fireEvent.click(screen.getByText('Add Word'));

    expect(onAdd).toHaveBeenCalledWith('犬');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits on Enter in the input', () => {
    const onAdd = vi.fn();
    render(<AddWordModal onAdd={onAdd} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('e.g. 猫');
    fireEvent.change(input, { target: { value: '鳥' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith('鳥');
  });

  it('does not call onAdd for an empty/whitespace-only word', () => {
    const onAdd = vi.fn();
    render(<AddWordModal onAdd={onAdd} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Add Word'));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('closes on Escape without adding', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddWordModal onAdd={onAdd} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
