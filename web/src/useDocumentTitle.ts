import { useEffect } from 'react';

export const APP_NAME = 'BailResearch';

/** Kanoon titles carry the judgment date; a browser tab has no room for it. */
export function shortCaseTitle(title: string) {
  return title.replace(/\s+on\s+\d{1,2}\s+\w+,\s*\d{4}\s*$/i, '');
}

/**
 * Sets the tab title for a page and restores the app name on unmount, so a
 * case title never lingers in the tab after navigating away from it.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME} — Supreme Court bail law`;
    return () => {
      document.title = `${APP_NAME} — Supreme Court bail law`;
    };
  }, [title]);
}
