/**
 * 決定の「置き換え」: 決定を変えたときに、新しい決定から前の決定へ付けるリンク。
 * 前の決定は別の資料（第3回 → 第4回のような別ファイル）にあってもよい。
 */
import { itemText, type FolderNote } from "./board";
import { oneLine } from "./minutes";
import type { Supersedes } from "./notesFile";

/** 資料の相対パス（フォルダからの相対・区切りは /）のフォルダ部分 */
function dirOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts;
}

/** 資料 from のフォルダから見た、資料 to の相対パス（どちらもフォルダからの相対パス） */
export function relativeDoc(from: string, to: string): string {
  const a = dirOf(from);
  const b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

/** 資料 from のフォルダから見た相対パス rel を、フォルダからの相対パスにする（フォルダの外を指していれば null） */
export function resolveDoc(from: string, rel: string): string | null {
  const parts = dirOf(from);
  for (const seg of rel.split("/")) {
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

export const noteKey = (i: { docPath: string; note: { id: string } }) => `${i.docPath}#${i.note.id}`;

/** 決定どうしの置き換えの関係 */
export interface DecisionLinks {
  /** 新しい決定 → 置き換えた前の決定（見つからなければ null） */
  replaces: Map<string, FolderNote | null>;
  /** 前の決定 → それを置き換えた新しい決定 */
  replacedBy: Map<string, FolderNote[]>;
}

/**
 * 決定の置き換えのリンクをたどる。
 * 前の決定は ID で探す（同じ ID が複数あれば、記録した資料のものを選ぶ）。
 */
export function linkDecisions(items: FolderNote[]): DecisionLinks {
  const byId = new Map<string, FolderNote[]>();
  for (const i of items) byId.set(i.note.id, [...(byId.get(i.note.id) ?? []), i]);
  const replaces = new Map<string, FolderNote | null>();
  const replacedBy = new Map<string, FolderNote[]>();
  for (const i of items) {
    const s = i.note.supersedes;
    if (!s) continue;
    const doc = resolveDoc(i.docPath, s.doc);
    const cands = (byId.get(s.id) ?? []).filter((c) => c !== i);
    const target = cands.find((c) => c.docPath === doc) ?? (cands.length === 1 ? cands[0] : null);
    replaces.set(noteKey(i), target);
    if (target) replacedBy.set(noteKey(target), [...(replacedBy.get(noteKey(target)) ?? []), i]);
  }
  return { replaces, replacedBy };
}

/** 資料 fromDoc の新しい決定から、前の決定 target を指すリンクを作る */
export function supersedesOf(target: FolderNote, fromDoc: string): Supersedes {
  return { id: target.note.id, doc: relativeDoc(fromDoc, target.docPath), text: oneLine(itemText(target), 80) };
}

/**
 * 置き換え元に選べない決定: 自分自身と、自分を（間接的に）置き換えている新しい決定（リンクが循環しないように）
 */
export function unpickable(self: { docPath: string; note: { id: string } }, links: DecisionLinks): Set<string> {
  const out = new Set([noteKey(self)]);
  const queue = [noteKey(self)];
  while (queue.length > 0) {
    for (const n of links.replacedBy.get(queue.shift()!) ?? []) {
      const k = noteKey(n);
      if (!out.has(k)) {
        out.add(k);
        queue.push(k);
      }
    }
  }
  return out;
}
