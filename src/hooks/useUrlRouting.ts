import { useEffect, useRef, Dispatch, SetStateAction } from "react";

export function useUrlRouting({ setSelectedWord }: UseUrlRoutingParams): UseUrlRoutingReturn {
  // Tracks whether THIS app instance ever pushed a `/word/:word` history
  // entry itself (vs. the user landing on `/word/:word` directly — a shared
  // link, a bookmark, a reload). Deep-linked visits have no prior in-app
  // history entry to pop, so blindly calling `window.history.back()`
  // navigates the browser off the app entirely (#259 P9). Only pop real
  // browser history once we know we're the ones who pushed something.
  const hasPushedWordNav = useRef(false);

  const navigateToWord = (word: string, reading?: string, pos?: string) => {
    hasPushedWordNav.current = true;
    setSelectedWord(word);
    // Carry the in-context reading and POS so the detail page resolves the
    // same homograph the reader/vocab list showed (人 in 六人 reads にん;
    // かしら in a sentence is the noun 頭, standalone it parses as the
    // "I wonder" particle).
    const params = new URLSearchParams();
    if (reading && reading !== word) params.set('reading', reading);
    if (pos) params.set('pos', pos);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    window.history.pushState({ type: 'word', word, scrollPos: window.scrollY }, '', `/word/${encodeURIComponent(word)}${query}`);
  };

  // Leaves the word-detail view. If we got here via an in-app navigation
  // (hasPushedWordNav), pop that history entry with a real back-navigation
  // so the URL and browser history stay consistent with what the user
  // expects from Back. If we got here via a deep link (direct load / reload
  // on `/word/:word`, no prior push from us), `history.back()` would leave
  // the app (#259 P9) — instead just clear the in-app state and replace the
  // URL with `/` so this is a safe landing spot and a refresh doesn't
  // dead-end again.
  const navigateBack = () => {
    setSelectedWord(null);
    if (hasPushedWordNav.current) {
      window.history.back();
    } else {
      window.history.replaceState(null, '', '/');
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.startsWith('/word/')) {
        const word = decodeURIComponent(path.slice(6));
        setSelectedWord(word);
      } else {
        setSelectedWord(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    handlePopState();
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return { navigateToWord, navigateBack };
}

type UseUrlRoutingParams = {
  setSelectedWord: Dispatch<SetStateAction<string | null>>;
};

type UseUrlRoutingReturn = {
  navigateToWord: (word: string, reading?: string, pos?: string) => void;
  navigateBack: () => void;
};