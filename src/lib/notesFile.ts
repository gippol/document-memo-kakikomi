import type { TextAnchor } from "./anchor";
import { parseRef, type CellAnchor } from "./sheet";

/** Markdown・Word・PowerPoint はテキスト範囲、Excel はセル範囲にノートを付ける */
export type Anchor = TextAnchor | CellAnchor;

export const NOTES_FILE_VERSION = 1;
export const NOTES_SUFFIX = ".notes.json";

export interface Note {
  id: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  anchor: Anchor;
}

export interface NotesFile {
  version: number;
  source: { file: string };
  notes: Note[];
  /**
   * 形式が不正で読めなかったノート（手での編集・Git の merge 失敗など）。
   * 表示はしないが、データを失わないよう保存時はそのまま書き戻す
   */
  invalid: unknown[];
}

export function emptyNotesFile(docPath: string): NotesFile {
  return { version: NOTES_FILE_VERSION, source: { file: baseName(docPath) }, notes: [], invalid: [] };
}

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function parseNotesFile(json: string, docPath: string): NotesFile {
  const data = JSON.parse(json);
  if (typeof data !== "object" || data === null || !Array.isArray(data.notes)) {
    throw new Error("ノートファイルの形式が不正です");
  }
  if (typeof data.version === "number" && data.version > NOTES_FILE_VERSION) {
    throw new Error(`未対応のノートファイルのバージョンです (v${data.version})`);
  }
  const notes: Note[] = [];
  const invalid: unknown[] = [];
  for (const n of data.notes as unknown[]) {
    if (isNote(n)) notes.push(n);
    else invalid.push(n);
  }
  return {
    version: NOTES_FILE_VERSION,
    source: { file: typeof data.source?.file === "string" ? data.source.file : baseName(docPath) },
    notes: dedupeIds(notes, invalid),
    invalid,
  };
}

// ---------- 形式の検証 ----------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isOffset = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const optStr = (v: unknown) => v === undefined || isStr(v);
const optNum = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));

function isTextAnchor(a: Obj): boolean {
  return (
    isStr(a.quote) &&
    isStr(a.prefix) &&
    isStr(a.suffix) &&
    isOffset(a.start) &&
    isOffset(a.end) &&
    a.start <= a.end &&
    isStr(a.sourceSha256) &&
    optNum(a.lineStart) &&
    optNum(a.lineEnd) &&
    optNum(a.paragraph) &&
    optStr(a.heading) &&
    optNum(a.slide) &&
    optNum(a.slideId)
  );
}

function isCellAnchor(a: Obj): boolean {
  return (
    isStr(a.sheet) &&
    isStr(a.ref) &&
    parseRef(a.ref) !== null &&
    isStr(a.quote) &&
    Array.isArray(a.values) &&
    a.values.every((row) => Array.isArray(row) && row.every(isStr)) &&
    optStr(a.rowHeader) &&
    optStr(a.colHeader) &&
    isStr(a.sourceSha256)
  );
}

/** 表示・保存に必要な項目がそろったノートか */
export function isNote(v: unknown): v is Note {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || !v.id || !isStr(v.comment) || !isStr(v.createdAt) || !isStr(v.updatedAt)) return false;
  const a = v.anchor;
  if (!isObj(a)) return false;
  if (a.type === "text") return isTextAnchor(a);
  if (a.type === "cell") return isCellAnchor(a);
  return false;
}

/** Git で差分が読みやすいよう、キー順を固定し整形して出力する */
export function serializeNotesFile(file: NotesFile): string {
  const ordered = {
    version: file.version,
    source: { file: file.source.file },
    notes: [
      ...file.notes.map((n) => ({
        id: n.id,
        comment: n.comment,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        anchor: orderAnchor(n.anchor),
      })),
      // 読めなかったノートは消さずに末尾へそのまま残す
      ...file.invalid,
    ],
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

function orderAnchor(a: Anchor) {
  if (a.type === "cell") {
    return {
      type: a.type,
      sheet: a.sheet,
      ref: a.ref,
      quote: a.quote,
      values: a.values,
      rowHeader: a.rowHeader,
      colHeader: a.colHeader,
      sourceSha256: a.sourceSha256,
    };
  }
  return {
    type: a.type,
    quote: a.quote,
    prefix: a.prefix,
    suffix: a.suffix,
    start: a.start,
    end: a.end,
    lineStart: a.lineStart,
    lineEnd: a.lineEnd,
    paragraph: a.paragraph,
    heading: a.heading,
    slide: a.slide,
    slideId: a.slideId,
    sourceSha256: a.sourceSha256,
  };
}

// ---------- ノート ID ----------

/** Crockford Base32（ULID と同じ文字。I・L・O・U を含まない）を小文字で */
const B32 = "0123456789abcdefghjkmnpqrstvwxyz";
const TIME_LEN = 10;
const RANDOM_LEN = 8;

function randomBase32(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => B32[b & 31]).join("");
}

function timeBase32(ms: number): string {
  let t = Math.max(0, Math.floor(ms));
  let s = "";
  for (let i = 0; i < TIME_LEN; i++) {
    s = B32[t % 32] + s;
    t = Math.floor(t / 32);
  }
  return s;
}

/**
 * 新しいノート ID（ULID 風: `note-` + 作成時刻 10 文字 + ランダム 8 文字）。
 * 連番と違い、Git の別ブランチで同時にノートを追加しても衝突しない。文字列順で作成順に並ぶ。
 * 旧形式の `note-001` もそのまま有効。
 */
export function nextNoteId(
  notes: Note[],
  invalid: unknown[] = [],
  now: number = Date.now(),
  random: (len: number) => string = randomBase32,
): string {
  // 読めなかったノートの ID とも重ならないようにする
  const used = new Set([...notes.map((n) => n.id), ...invalid.map((n) => (isObj(n) && isStr(n.id) ? n.id : ""))]);
  for (;;) {
    const id = `note-${timeBase32(now)}${random(RANDOM_LEN)}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Git の merge などで同じ ID のノートが複数あると、表示・選択が混ざる。
 * 2 件目以降に新しい ID を振り直す（ファイルには次に保存したときに反映される）。
 */
function dedupeIds(notes: Note[], invalid: unknown[]): Note[] {
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const n of notes) {
    if (seen.has(n.id)) {
      const id = nextNoteId(out, invalid, Date.parse(n.createdAt) || Date.now());
      out.push({ ...n, id });
      seen.add(id);
    } else {
      out.push(n);
      seen.add(n.id);
    }
  }
  return out;
}
