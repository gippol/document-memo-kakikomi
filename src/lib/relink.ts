import type { DocEntry } from "./api";
import { docKind } from "./document";
import { baseName } from "./notesFile";

export type RelinkReason = "moved" | "renamed";

export interface RelinkCandidate {
  doc: DocEntry;
  /** moved: 同じファイル名の資料が別の場所にある / renamed: 同じフォルダにあるノートの無い同じ形式の資料 */
  reason: RelinkReason;
}

const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/**
 * 孤立したノートファイルの付け替え先の候補。
 * 1. 同じファイル名の資料（フォルダを移動した）
 * 2. 同じフォルダ・同じ形式で、ノートがまだ無い資料（名前を変えた）
 */
export function relinkCandidates(orphanPath: string, docs: DocEntry[], limit = 5): RelinkCandidate[] {
  const name = baseName(orphanPath).toLowerCase();
  const dir = dirName(orphanPath);
  const kind = docKind(orphanPath);
  const moved = docs.filter((d) => baseName(d.path).toLowerCase() === name);
  const renamed = docs.filter(
    (d) => dirName(d.path) === dir && !d.hasNotes && docKind(d.path) === kind && !moved.includes(d),
  );
  return [
    ...moved.map((doc) => ({ doc, reason: "moved" as const })),
    ...renamed.map((doc) => ({ doc, reason: "renamed" as const })),
  ].slice(0, limit);
}
