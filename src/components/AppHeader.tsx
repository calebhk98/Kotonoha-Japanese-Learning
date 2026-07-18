import { CheckCircle, Settings } from 'lucide-react';

export type AppView = 'home' | 'vocab' | 'scoring' | 'settings';

/**
 * Persistent top-level nav, shared across every screen (#259 I1).
 *
 * Before this, only Home/Vocab/Scoring/Settings had a nav bar — Content
 * Detail, the Reader, Word Detail, and the Lesson flashcard flow each
 * replaced the ENTIRE shell with their own back/exit-only header, so there
 * was no way to reach My Vocab or Settings from inside a story without
 * backing all the way out to Home first.
 *
 * This renders as a slim bar ABOVE each view's own back/exit affordance —
 * it's an addition, not a replacement, so it doesn't touch any existing
 * back-navigation/routing logic (owned elsewhere in #259's split of work).
 * `onNavigate` is expected to reset any nested view state (selectedContent /
 * selectedWord / the Content Detail intro-lesson-consume sub-view) before
 * switching top-level views — see App.tsx's `goToView`.
 */
export function AppHeader({
  activeView,
  onNavigate,
  knownCount,
}: {
  /** null when rendered from inside Content Detail/Reader/Word Detail/Lesson — no tab is "active" there. */
  activeView: AppView | null;
  onNavigate: (view: AppView) => void;
  knownCount: number;
}) {
  const tabClass = (view: AppView) =>
    `text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
      activeView === view ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'
    }`;

  return (
    <header className="bg-white px-3 sm:px-6 py-2 sm:py-2.5 shadow-sm border-b border-gray-200 sticky top-0 z-20 w-full">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-1">
        <button
          onClick={() => onNavigate('home')}
          className="text-sm sm:text-base font-semibold tracking-tight shrink-0"
        >
          Kotonoha
        </button>
        <nav className="flex items-center gap-1.5 sm:gap-4 min-w-0" aria-label="Main">
          <button onClick={() => onNavigate('home')} className={tabClass('home')}>
            Content
          </button>
          <button onClick={() => onNavigate('vocab')} className={tabClass('vocab')}>
            <span className="sm:hidden">Vocab</span>
            <span className="hidden sm:inline">My Vocab</span>
          </button>
          <button onClick={() => onNavigate('scoring')} className={tabClass('scoring')}>
            <span className="sm:hidden">Scoring</span>
            <span className="hidden sm:inline">Scoring Guide</span>
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className={`flex items-center gap-1 ${tabClass('settings')}`}
          >
            <Settings className="w-3.5 h-3.5 shrink-0" /> Settings
          </button>
          <div className="hidden sm:flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100 text-xs shrink-0">
            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            <span className="font-medium">{knownCount} Known</span>
          </div>
        </nav>
      </div>
    </header>
  );
}
