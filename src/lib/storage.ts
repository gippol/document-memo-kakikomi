/** localStorage の読み書き（使えない環境でも落ちないようにする） */

const PREFIX = "document-memo-kakikomi:";

export const LS_KEYS = {
  lastRoot: `${PREFIX}lastRoot`,
  lastDoc: (root: string) => `${PREFIX}lastDoc:${root}`,
  layout: `${PREFIX}layout`,
  paneSize: (layout: string) => `${PREFIX}notesSize:${layout}`,
};

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* noop */
  }
}
