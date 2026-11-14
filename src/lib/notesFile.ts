import type { TextAnchor } from "./anchor";
import type { CellAnchor } from "./sheet";

/** Markdown・Word はテキスト範囲、Excel はセル範囲にノートを付ける */
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
}

export function emptyNotesFile(docPath: string): NotesFile {
  return { version: NOTES_FILE_VERSION, source: { file: baseName(docPath) }, notes: [] };
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
  return {
    version: NOTES_FILE_VERSION,
    source: { file: data.source?.file ?? baseName(docPath) },
    notes: data.notes as Note[],
  };
}

/** Git で差分が読みやすいよう、キー順を固定し整形して出力する */
export function serializeNotesFile(file: NotesFile): string {
  const ordered = {
    version: file.version,
    source: { file: file.source.file },
    notes: file.notes.map((n) => ({
      id: n.id,
      comment: n.comment,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      anchor: orderAnchor(n.anchor),
    })),
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
    sourceSha256: a.sourceSha256,
  };
}

export function nextNoteId(notes: Note[]): string {
  let max = 0;
  for (const n of notes) {
    const m = /^note-(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `note-${String(max + 1).padStart(3, "0")}`;
}
