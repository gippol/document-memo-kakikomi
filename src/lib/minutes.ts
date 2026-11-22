import type { NoteView } from "../components/NotesPanel";
import { dueLabel, formatDate, type NoteKind } from "./noteMeta";
import { kindOf, locationLabel, sortNoteViews } from "./noteViews";

export interface MinutesOptions {
  /** 資料のパス（フォルダからの相対パス） */
  docPath: string;
  /** 書き出した日 */
  today: Date;
  /** 引用（ノートを付けた資料の文言）を含める */
  includeQuotes: boolean;
}

const QUOTE_MAX = 120;
const NO_HEADING = "（見出しなし）";
const LOST = "（資料に見つからないノート）";

/** 引用を 1 行・最大 QUOTE_MAX 文字にする */
function oneLine(text: string, max = QUOTE_MAX): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 複数行のコメントを箇条書きの続きとして字下げする */
function indentRest(text: string, indent: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line, i) => (i === 0 ? line : line ? indent + line : ""))
    .join("\n");
}

/** コメントが空ならノートを付けた文言を本文にする */
function body(v: NoteView): string {
  return v.note.comment.trim() ? v.note.comment : `「${oneLine(v.note.anchor.quote)}」`;
}

/** 議題ごとにまとめるときの見出し（Excel はシート、PowerPoint はスライド） */
function groupOf(v: NoteView): string {
  if (v.status === "orphaned") return LOST;
  if (v.cell) return v.cell.slice(0, v.cell.lastIndexOf("!"));
  if (v.slide !== undefined) return `S${v.slide} ${v.heading ?? ""}`.trim();
  return v.heading || NO_HEADING;
}

/** 決定・宿題・質問の行末に付ける出典（見出しと位置） */
function sourceOf(v: NoteView): string {
  if (v.status === "orphaned") return "位置不明";
  const loc = locationLabel(v);
  // Excel の見出しは行・列の見出しなので、セル範囲と並べる
  const heading = v.slide !== undefined ? undefined : v.heading;
  return [heading && `§ ${heading}`, loc].filter(Boolean).join(" ");
}

function taskLine(v: NoteView, kind: NoteKind, today: Date): string {
  const n = v.note;
  const meta = [n.assignee && `@${n.assignee}`, n.due && `〜${dueLabel(n.due, today)}`].filter(Boolean).join(" ");
  const head = kind === "decision" ? "- " : `- [${n.done ? "x" : " "}] `;
  const text = indentRest(body(v), kind === "decision" ? "  " : "      ");
  return `${head}${text}${meta ? ` — ${meta}` : ""}（${sourceOf(v)}）`;
}

function quoteLine(v: NoteView, indent: string, opts: MinutesOptions): string[] {
  if (!opts.includeQuotes || !v.note.comment.trim()) return [];
  return [`${indent}> ${oneLine(v.note.anchor.quote)}`];
}

const SECTIONS: { kind: NoteKind; title: string }[] = [
  { kind: "decision", title: "決定事項" },
  { kind: "action", title: "宿題" },
  { kind: "question", title: "質問" },
];

/**
 * 資料に付けたノートから議事録の Markdown を作る。
 * 決定事項・宿題・質問を先頭に集め、残りのメモは資料の見出し（スライド・シート）ごとにまとめる。
 * どの節も資料上の位置順に並べる。
 */
export function buildMinutes(views: NoteView[], opts: MinutesOptions): string {
  const sorted = sortNoteViews(views, "position");
  const name = opts.docPath.split("/").pop() ?? opts.docPath;
  const out: string[] = [`# 議事録: ${name}`, "", `- 日付: ${formatDate(opts.today)}`, `- 資料: ${opts.docPath}`];

  if (sorted.length === 0) {
    out.push("", "（ノートなし）");
    return out.join("\n") + "\n";
  }

  for (const { kind, title } of SECTIONS) {
    const items = sorted.filter((v) => kindOf(v.note) === kind);
    if (items.length === 0) continue;
    out.push("", `## ${title}`, "");
    for (const v of items) {
      out.push(taskLine(v, kind, opts.today));
      out.push(...quoteLine(v, kind === "decision" ? "  " : "      ", opts));
    }
  }

  const memos = sorted.filter((v) => kindOf(v.note) === "memo");
  if (memos.length > 0) {
    out.push("", "## メモ");
    // 位置順のまま、見出しが同じものをまとめる（同じ見出しが離れて出てきたら、最初に出た所へ寄せる）
    const groups = new Map<string, NoteView[]>();
    for (const v of memos) {
      const g = groupOf(v);
      groups.set(g, [...(groups.get(g) ?? []), v]);
    }
    for (const [g, items] of groups) {
      out.push("", `### ${g}`, "");
      for (const v of items) {
        const loc = locationLabel(v);
        out.push(`- ${indentRest(body(v), "  ")}${loc ? `（${loc}）` : ""}`);
        out.push(...quoteLine(v, "  ", opts));
      }
    }
  }
  return out.join("\n") + "\n";
}

/** 書き出すファイル名の候補（例: 定例会議資料.docx → 定例会議資料_議事録_2026-11-23.md） */
export function minutesFileName(docPath: string, today: Date): string {
  const name = docPath.split("/").pop() ?? docPath;
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${stem}_議事録_${formatDate(today)}.md`;
}
