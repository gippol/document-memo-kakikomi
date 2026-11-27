/** localStorage の読み書き（使えない環境でも落ちないようにする） */

const PREFIX = "document-memo-kakikomi:";

export const LS_KEYS = {
  lastRoot: `${PREFIX}lastRoot`,
  lastDoc: (root: string) => `${PREFIX}lastDoc:${root}`,
  layout: `${PREFIX}layout`,
  /** Word・Markdown の見出しの目次を開いているか（"0" で閉じている） */
  tocOpen: `${PREFIX}tocOpen`,
  /** PowerPoint の表示（"cards" で文字のカード。既定は図） */
  pptxView: `${PREFIX}pptxView`,
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
