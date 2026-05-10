import { useEffect, Dispatch, SetStateAction } from "react";

export function useUrlRouting({ setSelectedWord }: UseUrlRoutingParams): UseUrlRoutingReturn {
  const navigateToWord = (word: string) => {
    setSelectedWord(word);
    window.history.pushState({ type: 'word', word, scrollPos: window.scrollY }, '', `/word/${encodeURIComponent(word)}`);
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
  navigateToWord: (word: string) => void;
};