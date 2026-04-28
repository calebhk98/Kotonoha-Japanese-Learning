import { useState } from 'react';
import { X, Download, Check } from 'lucide-react';
import { WordInfo } from '../types';
import { generateAnkiExport, downloadAnkiFile, AnkiExportOptions } from '../lib/anki';

const JLPT_LEVELS = [
  { value: 5, label: 'N5' },
  { value: 4, label: 'N4' },
  { value: 3, label: 'N3' },
  { value: 2, label: 'N2' },
  { value: 1, label: 'N1' },
  { value: 0, label: 'Native' },
];

export function AnkiExportModal({
  contentTitle,
  words,
  knownWordSet,
  onClose,
}: {
  contentTitle: string;
  words: WordInfo[];
  knownWordSet: Set<string>;
  onClose: () => void;
}) {
  const [deckName, setDeckName] = useState(contentTitle);
  const [includeKnown, setIncludeKnown] = useState(false);
  const [jlptFilter, setJlptFilter] = useState<number[]>([]);
  const [exported, setExported] = useState(false);

  const toggleJlpt = (level: number) => {
    setJlptFilter(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  const preview = (() => {
    let filtered = words;
    if (!includeKnown) filtered = filtered.filter(w => !knownWordSet.has(w.word));
    if (jlptFilter.length > 0) filtered = filtered.filter(w => jlptFilter.includes(w.jlpt));
    const seen = new Set<string>();
    return filtered.filter(w => { if (seen.has(w.word)) return false; seen.add(w.word); return true; });
  })();

  const handleExport = () => {
    const options: AnkiExportOptions = {
      deckName: deckName.trim() || contentTitle,
      includeKnown,
      jlptFilter,
    };
    const content = generateAnkiExport(words, knownWordSet, options);
    const safeName = (deckName.trim() || contentTitle).replace(/[^a-zA-Z0-9_\-　-鿿]/g, '_');
    downloadAnkiFile(content, `anki-${safeName}.txt`);
    setExported(true);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export to Anki</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Deck Name</label>
            <input
              type="text"
              value={deckName}
              onChange={e => setDeckName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              placeholder="Deck name..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Filter by JLPT Level</label>
            <p className="text-xs text-gray-400 mb-2">Leave unchecked to include all levels.</p>
            <div className="flex flex-wrap gap-2">
              {JLPT_LEVELS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleJlpt(value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    jlptFilter.includes(value)
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-purple-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIncludeKnown(v => !v)}
              className={`w-10 h-6 rounded-full transition-colors relative ${includeKnown ? 'bg-purple-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${includeKnown ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm text-gray-700">Include known words</span>
          </div>

          <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-sm text-purple-800">
            <strong>{preview.length}</strong> words will be exported.
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">How to import into Anki:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Open Anki → File → Import</li>
              <li>Select the downloaded <code className="bg-amber-100 px-1 rounded">.txt</code> file</li>
              <li>Confirm the deck name and field mapping, then click Import</li>
            </ol>
          </div>
        </div>

        <div className="px-6 py-5 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={preview.length === 0}
            className="px-5 py-2 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {exported ? (
              <><Check className="w-4 h-4" /> Downloaded!</>
            ) : (
              <><Download className="w-4 h-4" /> Download Deck</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
