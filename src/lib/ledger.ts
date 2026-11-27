/**
 * 決定事項の台帳。
 * フォルダ内のすべての資料の決定事項を日付ごとにまとめ、文字で検索する（「あれいつ決めたっけ？」用）。
 */
import { collectFolderNotes, itemText, sourceLabel, type CurrentNotes, type FolderNote, type FolderNotes, type NotesFileEntry } from "./board";
import { indentRest, oneLine } from "./minutes";
import { formatDate } from "./noteMeta";
import { sessionOf } from "./session";
import { noteKey, resolveDoc, type DecisionLinks } from "./supersede";

export type LedgerData = FolderNotes<FolderNote>;

/** 新しい順 / 古い順 */
export type LedgerOrder = "newest" | "oldest";

export interface LedgerGroup {
  /** 決めた日 YYYY-MM-DD（作成日時の、この PC の時刻での日付） */
  date: string;
  items: FolderNote[];
}

export function collectDecisions(entries: NotesFileEntry[], current: CurrentNotes | null): LedgerData {
  return collectFolderNotes(entries, current, (i) => (i.note.kind === "decision" ? i : null));
}

/** 決めた日（その決定を書いた会議の回） */
export function decidedOn(item: FolderNote): string {
  return sessionOf(item.note);
}

/** 検索用に文字をそろえる（全角英数・半角カナの違い、大文字小文字を無視する） */
function fold(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

/** 検索の対象: 決定の内容・付けた文言・資料のパス・位置（見出しなど） */
function haystack(item: FolderNote): string {
  return fold([item.note.comment, item.note.anchor.quote, item.docPath, item.where ?? ""].join("\n"));
}

/** 空白で区切った語をすべて含むものに絞る（空なら全部） */
export function searchLedger(items: FolderNote[], query: string): FolderNote[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((i) => {
    const h = haystack(i);
    return words.every((w) => h.includes(w));
  });
}

/** 日付ごとにまとめる。日付の並びと日付の中の並びは order に従う（作成日時順） */
export function groupLedger(items: FolderNote[], order: LedgerOrder): LedgerGroup[] {
  const sign = order === "newest" ? -1 : 1;
  const sorted = [...items].sort(
    (a, b) => sign * a.note.createdAt.localeCompare(b.note.createdAt) || a.docPath.localeCompare(b.docPath, "ja"),
  );
  const groups: LedgerGroup[] = [];
  for (const i of sorted) {
    const date = decidedOn(i);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.items.push(i);
    else groups.push({ date, items: [i] });
  }
  return groups;
}

/** 置き換えられた（新しい決定がある）決定を除く */
export function withoutReplaced(items: FolderNote[], links: DecisionLinks): FolderNote[] {
  return items.filter((i) => !links.replacedBy.get(noteKey(i))?.length);
}

/** 置き換え元の表示（見つからなければ控えの内容と記録した資料） */
export function replacesLabel(item: FolderNote, links: DecisionLinks): string | null {
  const s = item.note.supersedes;
  if (!s) return null;
  const target = links.replaces.get(noteKey(item));
  if (target) return `${oneLineText(target)}（${sourceLabel(target)}）`;
  return `${s.text || "（内容不明）"}（${resolveDoc(item.docPath, s.doc) ?? s.doc}・見つかりません）`;
}

/** 1 行にした内容（一覧・Markdown の経緯の行に使う） */
export const oneLineText = (i: FolderNote) => oneLine(itemText(i), 80);

/** 台帳を Markdown にする（Slack・Confluence にそのまま貼れる）。置き換えた・置き換えられた決定は下に経緯を添える */
export function ledgerMarkdown(groups: LedgerGroup[], today: Date, query = "", links?: DecisionLinks): string {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const out = [`# 決定事項（${formatDate(today)}）`, ""];
  if (query.trim()) out.push(`- 検索: ${query.trim()}`);
  out.push(`- 全 ${total}件`);
  if (groups.length === 0) out.push("", "（決定事項はありません）");
  for (const g of groups) {
    out.push("", `## ${g.date}`, "");
    for (const i of g.items) {
      const newer = links?.replacedBy.get(noteKey(i)) ?? [];
      const text = indentRest(itemText(i), "  ");
      out.push(`- ${newer.length > 0 ? `~~${text}~~` : text}（${sourceLabel(i)}）`);
      const older = links && replacesLabel(i, links);
      if (older) out.push(`  - 置き換え元: ${older}`);
      for (const n of newer) out.push(`  - 置き換え先: ${oneLineText(n)}（${sourceLabel(n)}）`);
    }
  }
  return out.join("\n") + "\n";
}
