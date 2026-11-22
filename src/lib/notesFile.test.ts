import { describe, expect, it } from "vitest";
import { parseNotesFile, serializeNotesFile } from "./notesFile";

const anchor = {
  type: "text",
  quote: "重要",
  prefix: "",
  suffix: "",
  start: 0,
  end: 2,
  sourceSha256: "x",
};
const base = { id: "note-1", comment: "c", createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z", anchor };
const json = (notes: unknown[]) => JSON.stringify({ version: 1, source: { file: "a.md" }, notes });

describe("ノートの種類・担当者・期限", () => {
  it("種類が無い旧形式のノートも読める", () => {
    const f = parseNotesFile(json([base]), "a.md");
    expect(f.notes).toHaveLength(1);
    expect(f.notes[0].kind).toBeUndefined();
  });

  it("読み書きで保たれ、キー順は固定", () => {
    const note = { ...base, kind: "action", assignee: "田中", due: "2026-12-01", done: true };
    const out = serializeNotesFile(parseNotesFile(json([note]), "a.md"));
    expect(parseNotesFile(out, "a.md").notes[0]).toMatchObject({ kind: "action", assignee: "田中", due: "2026-12-01", done: true });
    expect(Object.keys(JSON.parse(out).notes[0])).toEqual(["id", "kind", "comment", "assignee", "due", "done", "createdAt", "updatedAt", "anchor"]);
  });

  it("メモ・空の項目はファイルに書かない（旧形式と同じ出力）", () => {
    const out = serializeNotesFile(parseNotesFile(json([base]), "a.md"));
    expect(Object.keys(JSON.parse(out).notes[0])).toEqual(["id", "comment", "createdAt", "updatedAt", "anchor"]);
  });

  it("不正な値のノートは読めないノートとして残す", () => {
    const f = parseNotesFile(json([{ ...base, kind: "unknown" }, { ...base, id: "n2", due: "12/1" }, { ...base, id: "n3", done: "yes" }]), "a.md");
    expect(f.notes).toHaveLength(0);
    expect(f.invalid).toHaveLength(3);
  });
});
