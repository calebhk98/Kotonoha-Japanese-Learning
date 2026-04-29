import React, { useState } from 'react';
import { WordInfo, ScoreBreakdown } from '../types';
import { X, Save, Zap } from 'lucide-react';
import { WK_STAGE_NAMES } from '../lib/wanikani';

export const WordDetailModal: React.FC<{
  w: WordInfo;
  onClose: () => void;
  onSave: (wordStr: string, updatedWord: WordInfo) => void;
}> = ({ w, onClose, onSave }) => {
  const [reading, setReading] = useState(w.reading);
  const [meaning, setMeaning] = useState(w.meaning);
  const [jlpt, setJlpt] = useState(w.jlpt.toString());
  const [score, setScore] = useState(w.score.toString());
  const [highestGrade, setHighestGrade] = useState(w.breakdown?.highestGrade?.toString() || '');
  const [joyoPenalty, setJoyoPenalty] = useState(w.breakdown?.joyoPenalty?.toString() || '0');
  const [freqPenalty, setFreqPenalty] = useState(w.breakdown?.freqPenalty?.toString() || '0');
  const [priorities, setPriorities] = useState(w.breakdown?.priorities?.join(', ') || '');
  const [jlptScore, setJlptScore] = useState(w.breakdown?.jlptScore?.toString() || '0');
  const [wkSrsStage, setWkSrsStage] = useState(w.wkSrsStage?.toString() || '');

  const handleSave = () => {
    const stage = wkSrsStage !== '' ? parseInt(wkSrsStage) : undefined;
    const updated: WordInfo = {
      ...w,
      reading,
      meaning,
      jlpt: parseInt(jlpt) || 0,
      joyo: highestGrade !== '' ? parseInt(highestGrade) <= 8 : w.joyo,
      score: parseInt(score) || 0,
      wkSrsStage: stage,
      breakdown: {
        ...(w.breakdown || { jlptValues: [], gradeValues: [] }), // fallback
        jlptScore: parseInt(jlptScore) || 0,
        joyoPenalty: parseInt(joyoPenalty) || 0,
        highestGrade: highestGrade !== '' ? parseInt(highestGrade) : null,
        freqPenalty: parseInt(freqPenalty) || 0,
        priorities: priorities.split(',').map(p => p.trim()).filter(Boolean),
        jlptValues: w.breakdown?.jlptValues || [],
        gradeValues: w.breakdown?.gradeValues || [],
      } as ScoreBreakdown
    };
    onSave(w.word, updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{w.word}</h2>
            <p className="text-sm text-gray-500">Edit Word Details</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-grow space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Reading (Kana)</label>
              <input
                type="text"
                value={reading}
                onChange={e => setReading(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Meaning</label>
              <input
                type="text"
                value={meaning}
                onChange={e => setMeaning(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Total Score (Difficulty)</label>
              <input
                type="number"
                value={score}
                onChange={e => setScore(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">JLPT Level (0 for Native/None)</label>
              <input
                type="number"
                min="0"
                max="5"
                value={jlpt}
                onChange={e => setJlpt(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Highest Grade (Joyo)</label>
              <input
                type="number"
                value={highestGrade}
                onChange={e => setHighestGrade(e.target.value)}
                placeholder="1-8 or empty"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Priorities (Comma Separated)</label>
              <input
                type="text"
                value={priorities}
                onChange={e => setPriorities(e.target.value)}
                placeholder="news1, ichi1"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <h4 className="text-sm font-semibold text-gray-800 mb-4 uppercase tracking-widest">Scoring Parameters</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">JLPT Base Score</label>
                <input
                  type="number"
                  value={jlptScore}
                  onChange={e => setJlptScore(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Joyo Penalty Score</label>
                <input
                  type="number"
                  value={joyoPenalty}
                  onChange={e => setJoyoPenalty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Freq Penalty Score</label>
                <input
                  type="number"
                  value={freqPenalty}
                  onChange={e => setFreqPenalty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <h4 className="text-sm font-semibold text-gray-800 mb-4 uppercase tracking-widest flex items-center gap-2">
              <Zap className="w-4 h-4" /> WaniKani Status
            </h4>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">SRS Stage (1-9)</label>
              <select
                value={wkSrsStage}
                onChange={e => setWkSrsStage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                <option value="">Not in WaniKani</option>
                {Object.entries(WK_STAGE_NAMES).map(([stage, name]) => (
                  <option key={stage} value={stage}>{stage} - {name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex-shrink-0 flex gap-4">
          <button 
            onClick={handleSave}
            className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition flex items-center justify-center shadow-lg shadow-indigo-600/20"
          >
            <Save className="w-5 h-5 mr-2" /> Save Word Details
          </button>
        </div>
      </div>
    </div>
  );
};
