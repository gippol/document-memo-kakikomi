/**
 * ノートを書いた人・完了にした人の名前。
 * ノートファイルを Git や同期フォルダで共有したときに、誰のメモか分かるようにする。
 * 名前はこの PC の設定（localStorage）で、決めていなければ git の user.name を使う。
 */

/** 名前の長さの上限（一覧の見出しの行に収まるように） */
export const AUTHOR_MAX = 40;

/**
 * ノートに記録する名前。
 * setting はこの PC で決めた名前（null は決めていない → git の名前、空文字は「記録しない」）
 */
export function resolveAuthor(setting: string | null, gitName: string | null): string | undefined {
  const name = (setting ?? gitName ?? "").trim().slice(0, AUTHOR_MAX);
  return name || undefined;
}

/** 完了にした人の次の値。nextDoneAt と同じく、完了にしたときだけ記録し、完了のままなら前の値、未完了なら消す */
export function nextDoneBy(prev: { done?: boolean; doneBy?: string }, done: boolean | undefined, by: string | undefined): string | undefined {
  if (!done) return undefined;
  return prev.done ? prev.doneBy : by;
}
