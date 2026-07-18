import { useEffect, useRef, useState } from 'react';

export type ContentDetailView = 'intro' | 'lesson' | 'consume';

/**
 * Owns the ContentDetail "intro / lesson / consume" (reader) view state
 * OUTSIDE of ContentDetail itself, in a parent that stays mounted across
 * word-detail navigation (#259 B3).
 *
 * Before this hook, ContentDetail held `view` in local `useState`. Clicking
 * a word inside the reader pushes `/word/:word` and App renders
 * WordDetailPage *instead of* ContentDetail (an early return), which
 * unmounts ContentDetail. Pressing browser Back cleared `selectedWord` and
 * remounted ContentDetail fresh — local state doesn't survive an unmount, so
 * `view` reset to its default `'intro'` and the user lost their place in the
 * reader.
 *
 * Lifting `view` into the parent (which never unmounts while `selectedWord`
 * is set) means the state simply survives the ContentDetail unmount/remount
 * cycle. The hook resets to `'intro'` only when the caller's `contentId`
 * actually changes — a fresh piece of content should always start at the
 * intro screen — but leaves `view` alone when the same content is updated in
 * place (e.g. an edit) or when a word-detail overlay opens and closes.
 */
export function useContentView(contentId: string | undefined | null) {
  const [view, setView] = useState<ContentDetailView>('intro');
  const prevId = useRef<string | undefined | null>(contentId);

  useEffect(() => {
    if (contentId !== prevId.current) {
      setView('intro');
      prevId.current = contentId;
    }
  }, [contentId]);

  return [view, setView] as const;
}
