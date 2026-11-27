/**
 * ノートの種類（決定事項・宿題・質問・メモ）と、宿題・質問の担当者・期限・優先度・完了状態。
 * ノートファイルでは任意のフィールドで、無いノートは「メモ」として扱う（古い版のアプリでも読める）。
 */

export type NoteKind = "memo" | "decision" | "action" | "question";

export const NOTE_KINDS: NoteKind[] = ["memo", "decision", "action", "question"];

export const KIND_LABEL: Record<NoteKind, string> = {
  memo: "メモ",
  decision: "決定",
  action: "宿題",
  question: "質問",
};

/** 完了状態の表示（宿題は「完了」、質問は「回答済み」） */
export const DONE_LABEL: Partial<Record<NoteKind, string>> = {
  action: "完了",
  question: "回答済み",
};

/** 宿題・質問の優先度。無いときは「なし」（並べ替えでは中と同じ扱い） */
export type Priority = "high" | "medium" | "low";

export const PRIORITIES: Priority[] = ["high", "medium", "low"];

export const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

/** 並べ替えの順位（小さいほど先）。高 → 中・なし → 低 */
export function priorityRank(p: Priority | undefined): number {
  return p === "high" ? 0 : p === "low" ? 2 : 1;
}

export interface NoteMeta {
  kind: NoteKind;
  /** 担当者（宿題）・回答する人（質問） */
  assignee?: string;
  /** 期限 YYYY-MM-DD */
  due?: string;
  /** 優先度（宿題・質問のみ） */
  priority?: Priority;
  /** 宿題は完了、質問は回答済み */
  done?: boolean;
}

export interface NoteFields extends NoteMeta {
  comment: string;
}

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && (NOTE_KINDS as string[]).includes(v);
}

/** 担当者・期限・完了状態を持てる種類か */
export function hasTask(kind: NoteKind): boolean {
  return kind === "action" || kind === "question";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDueDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 種類に合わない項目・空の項目を落とす（メモ・決定には担当者・期限・優先度・完了状態を持たせない） */
export function normalizeFields(f: NoteFields): NoteFields {
  const out: NoteFields = { kind: f.kind, comment: f.comment };
  if (!hasTask(f.kind)) return out;
  const assignee = f.assignee?.trim();
  if (assignee) out.assignee = assignee;
  if (f.due && isDueDate(f.due)) out.due = f.due;
  if (isPriority(f.priority)) out.priority = f.priority;
  if (f.done) out.done = true;
  return out;
}

// ---------- 会議中に素早く入力するための記法 ----------

const KIND_WORDS: Record<string, NoteKind> = {
  メ: "memo",
  メモ: "memo",
  memo: "memo",
  決: "decision",
  決定: "decision",
  決定事項: "decision",
  d: "decision",
  宿: "action",
  宿題: "action",
  todo: "action",
  a: "action",
  質: "question",
  質問: "question",
  q: "question",
};

const PRIORITY_WORDS: Record<string, Priority> = {
  高: "high",
  中: "medium",
  低: "low",
};

/** 全角の記号・数字を半角にそろえる */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 期限の書き方を YYYY-MM-DD にする。
 * `12/1`・`12-1`（年なし。半年以上前になるなら来年）、`2026/12/1`・`2026-12-01`、
 * `今日`・`明日`・`明後日`、`+3`（3 日後）
 */
export function parseDue(text: string, today: Date): string | null {
  const s = toHalfWidth(text).trim();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const after = (days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return formatDate(d);
  };
  if (s === "今日") return after(0);
  if (s === "明日") return after(1);
  if (s === "明後日") return after(2);
  const rel = /^\+(\d{1,3})$/.exec(s);
  if (rel) return after(Number(rel[1]));

  const full = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (full) {
    const v = `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`;
    return isDueDate(v) ? v : null;
  }
  const md = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    let y = base.getFullYear();
    const sixMonthsAgo = new Date(base);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (new Date(y, m - 1, d) < sixMonthsAgo) y += 1;
    const v = `${y}-${pad(m)}-${pad(d)}`;
    return isDueDate(v) ? v : null;
  }
  return null;
}

/**
 * コメント先頭の記法を読み取り、種類・担当者・期限にする（読み取った部分はコメントから取り除く）。
 * - `/決` `/宿` `/質` `/メ`（`/決定` `/宿題` `/todo` `/質問` `/q` なども可）: 種類
 * - `@田中`: 担当者
 * - `!12/1`: 期限
 * - `/高` `/中` `/低`: 優先度
 * 記号は全角でもよい。先頭から空白区切りで続く間だけ読み、記法でない語が出たらそこから後はコメント。
 * 書かれていない項目は元の値（fields）のまま。
 */
export function applyShorthand(fields: NoteFields, today: Date): NoteFields {
  const out: NoteFields = { ...fields };
  let rest = fields.comment;
  let found = false;
  for (;;) {
    const m = /^[ \t　]*(\S+)(?:[ \t　]+|\r?\n|$)/.exec(rest);
    if (!m) break;
    const token = toHalfWidth(m[1]);
    const head = token[0];
    const body = token.slice(1);
    if (head === "/" && KIND_WORDS[body.toLowerCase()]) {
      out.kind = KIND_WORDS[body.toLowerCase()];
    } else if (head === "/" && PRIORITY_WORDS[body]) {
      out.priority = PRIORITY_WORDS[body];
    } else if (head === "@" && body) {
      out.assignee = m[1].slice(1);
    } else if (head === "!" && parseDue(body, today)) {
      out.due = parseDue(body, today)!;
    } else {
      break;
    }
    found = true;
    rest = rest.slice(m[0].length);
  }
  if (!found) return fields;
  // 担当者・期限・優先度だけ書いたときは宿題とみなす
  const taskSet = out.assignee !== fields.assignee || out.due !== fields.due || out.priority !== fields.priority;
  if (out.kind === "memo" && taskSet) out.kind = "action";
  out.comment = rest;
  return out;
}

/** 期限の表示（今年なら年を省く。例: 12/1、2027/1/15） */
export function dueLabel(due: string, today: Date): string {
  const [y, m, d] = due.split("-").map(Number);
  return y === today.getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
}

// ---------- 状態 ----------

/**
 * 完了にした日時（ISO 8601）の次の値。完了にしたときは now、完了のままなら前の値（記録の無い古いノートは無いまま）、
 * 未完了・完了を持たない種類なら undefined
 */
export function nextDoneAt(prev: { done?: boolean; doneAt?: string }, done: boolean | undefined, now: string): string | undefined {
  if (!done) return undefined;
  return prev.done ? prev.doneAt : now;
}

/** 完了にした日の表示（例: 11/28。記録が無ければ null） */
export function doneAtLabel(doneAt: string | undefined, today: Date): string | null {
  const d = doneAt ? new Date(doneAt) : null;
  return d && !Number.isNaN(d.getTime()) ? dueLabel(formatDate(d), today) : null;
}

/** 期限を過ぎてから完了にした日数（この PC での日付で数える。期限内・記録が無ければ 0） */
export function daysLate(due: string | undefined, doneAt: string | undefined): number {
  if (!due || !doneAt || !isDueDate(due)) return 0;
  const d = new Date(doneAt);
  if (Number.isNaN(d.getTime())) return 0;
  const [y, m, dd] = due.split("-").map(Number);
  const done = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((done.getTime() - new Date(y, m - 1, dd).getTime()) / 86400000));
}

/** 未完了の宿題・未回答の質問 */
export function isOpen(m: NoteMeta): boolean {
  return hasTask(m.kind) && !m.done;
}

/** 期限を過ぎた未完了の宿題・質問 */
export function isOverdue(m: NoteMeta, today: Date): boolean {
  return isOpen(m) && !!m.due && m.due < formatDate(today);
}

/** ノートの種類・コメント・担当者・期限・優先度・完了状態を NoteFields として取り出す */
export function fieldsOf(n: { comment: string } & Partial<NoteMeta>): NoteFields {
  return { kind: n.kind ?? "memo", comment: n.comment, assignee: n.assignee, due: n.due, priority: n.priority, done: n.done };
}

/** ノートに上書きする値（メモ・空の項目は undefined にしてファイルに書かない） */
export function fieldsPatch(f: NoteFields) {
  const n = normalizeFields(f);
  return {
    kind: n.kind === "memo" ? undefined : n.kind,
    comment: n.comment,
    assignee: n.assignee,
    due: n.due,
    priority: n.priority,
    done: n.done,
  };
}

export function sameFields(a: NoteFields, b: NoteFields): boolean {
  const x = normalizeFields(a);
  const y = normalizeFields(b);
  return x.kind === y.kind && x.comment === y.comment && x.assignee === y.assignee && x.due === y.due && x.priority === y.priority && !!x.done === !!y.done;
}
