import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalDismiss } from '../hooks/useModalDismiss';

/**
 * Styled replacement for the old `prompt("Enter the new word:")` call in
 * ContentDetail's "Add Custom Word" button (#259 C4). A native prompt() is
 * unstyled, blocking, and stands out jarringly next to the app's otherwise
 * custom modals (Import, Anki export, Word detail edit) — this matches their
 * look and supports the same Escape/backdrop-click dismissal as the rest
 * (#259 C3).
 */
export function AddWordModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (word: string) => void;
}) {
  const [word, setWord] = useState('');
  const { onBackdropClick } = useModalDismiss(onClose);

  const handleAdd = () => {
    const trimmed = word.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm"
      onClick={onBackdropClick}
    >
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-lg font-bold">Add Custom Word</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-2">
          <label className="block text-sm font-medium text-gray-700">Word</label>
          <input
            type="text"
            autoFocus
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            placeholder="e.g. 猫"
          />
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 font-medium text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!word.trim()}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
          >
            Add Word
          </button>
        </div>
      </div>
    </div>
  );
}
