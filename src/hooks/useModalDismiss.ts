import { useEffect, type MouseEvent } from 'react';

/**
 * Standard modal dismiss behavior (#259 C3): Escape key closes the modal,
 * and clicking the backdrop (but not the modal card itself) closes it too.
 * Before this hook, ImportModal / AnkiExportModal / WordDetailModal only
 * closed via their explicit ✕ button — verified in a real browser that
 * Escape and backdrop-click were both no-ops, which is surprising and (per
 * the linked issue) actively got in the way during review when a modal's
 * overlay kept intercepting clicks after Escape failed to dismiss it.
 *
 * Usage:
 *   const { onBackdropClick } = useModalDismiss(onClose);
 *   <div onClick={onBackdropClick}>  // the fixed inset-0 backdrop
 *     <div onClick={e => e.stopPropagation()}>  // the modal card itself
 */
export function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const onBackdropClick = (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return { onBackdropClick };
}
