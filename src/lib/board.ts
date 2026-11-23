/**
 * フォルダ全体の宿題・質問ボード。
 * フォルダ内のすべてのノートファイルから未完了の宿題・未回答の質問を集め、担当者別・期限順に並べて集計する。
 * 資料を開かずに作るので、位置はノートに記録してある情報（スライド番号・見出し・行・段落・セル）で表す。
 */
import { indentRest, oneLine } from "./minutes";
import { dueLabel, formatDate, isOpen, isOverdue } from "./noteMeta";
import { parseNotesFile, type Note, type NotesFile } from "./notesFile";

/** バックエンドの list_all_notes が返すノートファイル 1 つ分 */
export interface NotesFileEntry {
  /** 資料の相対パス */
  path: string;
  /** ノートファイルの内容（読めなければ null） */
  json: string | null;
  /** 対応する資料があるか（無ければ孤立したノート） */
  docExists: boolean;
}

export interface BoardItem {
  docPath: string;
  docExists: boolean;
  note: Note;
  kind: "action" | "question";
  /** 資料上の位置（記録してある情報から。分からなければ null） */
  where: string | null;
}

export interface BoardData {
  items: BoardItem[];
  /** 読めなかったノートファイルの資料のパス */
  unreadable: string[];
}

export interface BoardSummary {
  total: number;
  overdue: number;
  /** 今日から今週の日曜までが期限のもの（期限切れは含めない） */
  thisWeek: number;
  /** 担当者が空の宿題（質問は誰に聞くか決めずに書くことも多いので数えない） */
  unassigned: number;
}

export type BoardFilter = "all" | "overdue" | "thisWeek" | "unassigned";
export type BoardGrouping = "assignee" | "due";

export interface BoardGroup {
  key: string;
  label: string;
  /** 目立たせるグループ（担当なし・期限切れ） */
  warn: boolean;
  items: BoardItem[];
}

/** 開いている資料のノート（未保存の編集を含むので、ディスクの内容より優先する） */
export interface CurrentNotes {
  path: string;
  file: NotesFile;
}

/** ノートに記録してある位置情報から、資料上の位置の表示を作る */
export function whereOf(note: Note): string | null {
  const a = note.anchor;
  if (a.type === "place") {
    if (a.scope === "doc") return "全体";
    if (a.scope === "sheet") return a.sheet ?? null;
    if (a.scope === "slide") return a.slide !== undefined ? `S${a.slide}` : null;
    return a.heading ? `§ ${a.heading}` : null;
  }
  if (a.type === "cell") return `${a.sheet}!${a.ref}`;
  if (a.slide !== undefined) return `S${a.slide}`;
  const loc =
    a.lineStart !== undefined
      ? a.lineEnd && a.lineEnd !== a.lineStart
        ? `L${a.lineStart}-${a.lineEnd}`
        : `L${a.lineStart}`
      : a.paragraph !== undefined
        ? `¶${a.paragraph}`
        : null;
  return [a.heading && `§ ${a.heading}`, loc].filter(Boolean).join(" ") || null;
}

function openItems(path: string, docExists: boolean, notes: Note[]): BoardItem[] {
  return notes.flatMap((note): BoardItem[] => {
    const kind = note.kind;
    if ((kind !== "action" && kind !== "question") || !isOpen({ kind, done: note.done })) return [];
    return [{ docPath: path, docExists, note, kind, where: whereOf(note) }];
  });
}

/**
 * ノートファイルから未完了の宿題・未回答の質問を集める。
 * current（開いている資料）はディスクの内容ではなくメモリ上のノートを使う。
 */
export function collectBoard(entries: NotesFileEntry[], current: CurrentNotes | null): BoardData {
  const items: BoardItem[] = [];
  const unreadable: string[] = [];
  let currentSeen = false;
  for (const e of entries) {
    if (current && e.path === current.path) {
      currentSeen = true;
      items.push(...openItems(e.path, e.docExists, current.file.notes));
      continue;
    }
    if (e.json === null) {
      unreadable.push(e.path);
      continue;
    }
    try {
      items.push(...openItems(e.path, e.docExists, parseNotesFile(e.json, e.path).notes));
    } catch {
      unreadable.push(e.path);
    }
  }
  // まだ保存していない（ディスクにノートファイルが無い）開いている資料のノート
  if (current && !currentSeen) items.push(...openItems(current.path, true, current.file.notes));
  return { items, unreadable };
}

/** 今週の日曜（週の終わり）の YYYY-MM-DD */
export function endOfWeek(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return formatDate(d);
}

export function isThisWeek(item: BoardItem, today: Date): boolean {
  const due = item.note.due;
  return !!due && due >= formatDate(today) && due <= endOfWeek(today);
}

export const isUnassigned = (item: BoardItem) => item.kind === "action" && !item.note.assignee;

const overdue = (item: BoardItem, today: Date) => isOverdue({ kind: item.kind, done: item.note.done, due: item.note.due }, today);

export function summarizeBoard(items: BoardItem[], today: Date): BoardSummary {
  return {
    total: items.length,
    overdue: items.filter((i) => overdue(i, today)).length,
    thisWeek: items.filter((i) => isThisWeek(i, today)).length,
    unassigned: items.filter(isUnassigned).length,
  };
}

export function filterBoard(items: BoardItem[], filter: BoardFilter, today: Date): BoardItem[] {
  if (filter === "overdue") return items.filter((i) => overdue(i, today));
  if (filter === "thisWeek") return items.filter((i) => isThisWeek(i, today));
  if (filter === "unassigned") return items.filter(isUnassigned);
  return items;
}

/** 期限の近い順（期限切れが先頭、期限なしは末尾）。同じなら資料・作成順 */
export function sortByDue(items: BoardItem[]): BoardItem[] {
  return [...items].sort(
    (a, b) =>
      (a.note.due ?? "9999").localeCompare(b.note.due ?? "9999") ||
      a.docPath.localeCompare(b.docPath, "ja") ||
      a.note.createdAt.localeCompare(b.note.createdAt),
  );
}

const UNASSIGNED = "担当なし";

/**
 * グループに分ける。
 * - assignee: 担当者ごと。担当なしを先頭にして目立たせ、残りは名前順
 * - due: 期限切れ・今週・来週以降・期限なし
 * どのグループの中も期限の近い順
 */
export function groupBoard(items: BoardItem[], grouping: BoardGrouping, today: Date): BoardGroup[] {
  const sorted = sortByDue(items);
  if (grouping === "assignee") {
    const byName = new Map<string, BoardItem[]>();
    for (const i of sorted) {
      const name = i.note.assignee ?? "";
      byName.set(name, [...(byName.get(name) ?? []), i]);
    }
    const names = [...byName.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "ja")));
    return names.map((name) => ({
      key: `@${name}`,
      label: name ? `@${name}` : UNASSIGNED,
      warn: name === "" && byName.get(name)!.some(isUnassigned),
      items: byName.get(name)!,
    }));
  }
  const buckets: BoardGroup[] = [
    { key: "overdue", label: "期限切れ", warn: true, items: [] },
    { key: "thisWeek", label: `今週（〜${dueLabel(endOfWeek(today), today)}）`, warn: false, items: [] },
    { key: "later", label: "来週以降", warn: false, items: [] },
    { key: "none", label: "期限なし", warn: false, items: [] },
  ];
  for (const i of sorted) {
    const b = !i.note.due ? 3 : overdue(i, today) ? 0 : isThisWeek(i, today) ? 1 : 2;
    buckets[b].items.push(i);
  }
  return buckets.filter((b) => b.items.length > 0);
}

/** 宿題・質問の本文（コメントが空なら付けた文言） */
export function itemText(item: BoardItem): string {
  if (item.note.comment.trim()) return item.note.comment;
  const quote = item.note.anchor.quote;
  return quote ? `「${oneLine(quote)}」` : "（コメントなし）";
}

export function sourceLabel(item: BoardItem): string {
  return [item.docPath, item.where].filter(Boolean).join(" ");
}

/**
 * ボードを Markdown にする（会議冒頭の「先週の宿題」確認用。Slack・Confluence にそのまま貼れる）。
 * 行の形は議事録と同じ `- [ ] 内容 — @担当 〜期限（出典）`。質問には「質問:」を付ける
 */
export function boardMarkdown(groups: BoardGroup[], summary: BoardSummary, today: Date, title = "未完了の宿題・質問"): string {
  const out = [
    `# ${title}（${formatDate(today)}）`,
    "",
    `- 期限切れ ${summary.overdue}件 / 今週 ${summary.thisWeek}件 / 担当なし ${summary.unassigned}件（全 ${summary.total}件）`,
  ];
  if (groups.length === 0) out.push("", "（未完了の宿題・質問はありません）");
  for (const g of groups) {
    out.push("", `## ${g.label}`, "");
    for (const i of g.items) {
      const n = i.note;
      const meta = [n.assignee && `@${n.assignee}`, n.due && `〜${dueLabel(n.due, today)}`].filter(Boolean).join(" ");
      const text = indentRest(itemText(i), "  ");
      out.push(`- [ ] ${i.kind === "question" ? "質問: " : ""}${text}${meta ? ` — ${meta}` : ""}（${sourceLabel(i)}）`);
    }
  }
  return out.join("\n") + "\n";
}
