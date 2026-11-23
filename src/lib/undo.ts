/**
 * ノートの削除の取り消し。
 * 削除したノートと元の位置を覚えておき、元の位置に戻す（会議中の誤操作対策）。
 */
import type { Note, NotesFile } from "./notesFile";

export interface DeletedNote {
  /** 資料の相対パス */
  path: string;
  note: Note;
  /** 削除したときのノートファイル内の位置 */
  index: number;
}

/** 覚えておく削除の数（古いものから捨てる） */
export const UNDO_LIMIT = 20;

/** ノートを削除し、取り消し用の情報を返す（見つからなければ deleted は null） */
export function removeNote(file: NotesFile, id: string, path: string): { file: NotesFile; deleted: DeletedNote | null } {
  const index = file.notes.findIndex((n) => n.id === id);
  if (index < 0) return { file, deleted: null };
  return {
    file: { ...file, notes: file.notes.filter((_, i) => i !== index) },
    deleted: { path, note: file.notes[index], index },
  };
}

/**
 * 削除したノートを元の位置に戻す（その後ノートが減っていれば末尾）。
 * 同じ ID のノートが既にある（外部の変更で戻っていた等）ときは何もしない
 */
export function restoreNote(file: NotesFile, d: DeletedNote): NotesFile {
  if (file.notes.some((n) => n.id === d.note.id)) return file;
  const notes = [...file.notes];
  notes.splice(Math.min(d.index, notes.length), 0, d.note);
  return { ...file, notes };
}

/** 取り消し用の履歴に追加する（上限を超えたら古いものを捨てる） */
export function pushDeleted(list: DeletedNote[], d: DeletedNote): DeletedNote[] {
  return [...list, d].slice(-UNDO_LIMIT);
}

/** その資料で最後に削除したノートの、履歴内の位置（無ければ -1） */
export function lastDeletedIndex(list: DeletedNote[], path: string | null): number {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].path === path) return i;
  return -1;
}
