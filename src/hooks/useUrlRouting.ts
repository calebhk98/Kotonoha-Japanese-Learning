import { useEffect, Dispatch, SetStateAction } from "react";

export function useUrlRouting({ setSelectedWord }: UseUrlRoutingParams): UseUrlRoutingReturn {
  const navigateToWord = (word: string, reading?: string, pos?: string) => {
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

  return { navigateToWord };
}

type UseUrlRoutingParams = {
  setSelectedWord: Dispatch<SetStateAction<string | null>>;
};

type UseUrlRoutingReturn = {
  navigateToWord: (word: string, reading?: string, pos?: string) => void;
};