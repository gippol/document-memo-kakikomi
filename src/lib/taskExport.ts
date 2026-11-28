/**
 * 宿題・質問ボードの書き出し（GitHub Issues などへ移すため）。
 * - CSV: Excel・スプレッドシート・Issue の一括登録ツールに取り込む用
 * - Issue 用 Markdown: `gh issue create --title "…" --body-file <ファイル>` の本文。表示中の宿題を 1 つの Issue のチェックリストにする
 * どちらもボードで表示している一覧（種類・絞り込み・並べ方）をそのまま書き出す。
 */
import { itemText, sourceLabel, type BoardGroup, type BoardItem } from "./board";
import { indentRest, oneLine } from "./minutes";
import { formatDate, KIND_LABEL, PRIORITY_LABEL } from "./noteMeta";

// ---------- CSV ----------

export const CSV_HEADER = ["種類", "内容", "担当", "期限", "優先度", "資料", "位置", "書いた人", "作成日", "ノートID"];

/**
 * CSV の 1 マス。区切り・引用符・改行を含めば引用符で囲む。
 * 表計算ソフトが数式として実行しないよう、= + - @ タブ CR で始まる値には ' を前に付ける
 */
export function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** ISO 8601 の日時を、この PC の日付 YYYY-MM-DD にする（読めなければそのまま） */
function localDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDate(d);
}

/** 内容は複数行のまま（引用符で囲む）。期限は YYYY-MM-DD のまま（表計算ソフトで並べ替えられる） */
function csvRow(i: BoardItem): string[] {
  const n = i.note;
  return [
    KIND_LABEL[i.kind],
    itemText(i).trim(),
    n.assignee ?? "",
    n.due ?? "",
    n.priority ? PRIORITY_LABEL[n.priority] : "",
    i.docPath,
    i.where ?? "",
    n.author ?? "",
    localDate(n.createdAt),
    n.id,
  ];
}

/**
 * 表示中の宿題・質問を CSV にする（並びは画面と同じ）。
 * Excel で開いても文字化けしないよう UTF-8 の BOM を付け、行の区切りは CRLF にする
 */
export function boardCsv(groups: BoardGroup[]): string {
  const rows = [CSV_HEADER, ...groups.flatMap((g) => g.items.map(csvRow))];
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------- Issue 用 Markdown ----------

/**
 * グループの見出し。担当者は @ を付けない
 * （GitHub では @名前 がその名前のアカウントへの通知になるので、担当者の名前が GitHub の ID と重なると無関係な人に届く）
 */
function issueHeading(g: BoardGroup): string {
  return g.key.startsWith("@") ? (g.key.slice(1) ? `担当: ${g.key.slice(1)}` : "担当なし") : g.label;
}

/** 期限は年付きのまま（Issue は後から読み返すので、年をまたいでも分かるように） */
function issueLine(i: BoardItem): string[] {
  const n = i.note;
  const meta = [
    n.assignee && `担当: ${n.assignee}`,
    n.due && `期限: ${n.due}`,
    n.priority && `優先度: ${PRIORITY_LABEL[n.priority]}`,
  ]
    .filter(Boolean)
    .join(" / ");
  const out = [
    `- [ ] ${i.kind === "question" ? "質問: " : ""}${indentRest(itemText(i), "  ")}`,
    ...(meta ? [`  - ${meta}`] : []),
    `  - 出典: ${sourceLabel(i)}${i.docExists ? "" : "（資料なし）"}`,
  ];
  // コメントがあるときは、ノートを付けた資料の文言も添える（全体メモの quote は見出しの名前で、出典と重なるので付けない）
  const quote = n.comment.trim() && n.anchor.type !== "place" ? oneLine(n.anchor.quote) : "";
  if (quote) out.push(`  > ${quote}`);
  return out;
}

/**
 * 表示中の宿題・質問を、1 つの Issue の本文（チェックリスト）にする。
 * 先頭の HTML コメントに `gh issue create` の使い方を書く（GitHub では表示されない）。
 * Issue のタイトルは本文に含めない（`--title` で渡す）
 */
export function issueMarkdown(groups: BoardGroup[], today: Date, title: string): string {
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const out = [
    `<!-- gh issue create --title "${issueTitle(title, today).replace(/"/g, "'")}" --body-file <このファイル> -->`,
    "",
    `資料メモ かきこみ のノートから書き出した${title}（${formatDate(today)} 時点・${total}件）。`,
  ];
  if (total === 0) out.push("", "（未完了の宿題・質問はありません）");
  for (const g of groups) {
    if (g.items.length === 0) continue;
    out.push("", `## ${issueHeading(g)}`, "");
    for (const i of g.items) out.push(...issueLine(i));
  }
  return out.join("\n") + "\n";
}

/** Issue のタイトル（例: 未完了の宿題（2026-11-28）） */
export function issueTitle(boardTitle: string, today: Date): string {
  return `${boardTitle}（${formatDate(today)}）`;
}

/** 保存するファイル名の候補（例: 未完了の宿題_2026-11-28.csv / 未完了の宿題_Issue_2026-11-28.md） */
export function exportFileName(boardTitle: string, format: "csv" | "issue", today: Date): string {
  const stem = boardTitle.replace(/[\\/:*?"<>|]/g, "_");
  return format === "csv" ? `${stem}_${formatDate(today)}.csv` : `${stem}_Issue_${formatDate(today)}.md`;
}
