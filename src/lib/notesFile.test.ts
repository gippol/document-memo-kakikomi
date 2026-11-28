import { describe, expect, it } from "vitest";
import { parseNotesFile, serializeNotesFile, withFields, type Note } from "./notesFile";

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
    const note = { ...base, kind: "action", assignee: "田中", due: "2026-12-01", priority: "high", done: true };
    const out = serializeNotesFile(parseNotesFile(json([note]), "a.md"));
    expect(parseNotesFile(out, "a.md").notes[0]).toMatchObject({ kind: "action", assignee: "田中", due: "2026-12-01", priority: "high", done: true });
    expect(Object.keys(JSON.parse(out).notes[0])).toEqual([
      "id",
      "kind",
      "comment",
      "assignee",
      "due",
      "priority",
      "done",
      "createdAt",
      "updatedAt",
      "anchor",
    ]);
  });

  it("メモ・空の項目はファイルに書かない（旧形式と同じ出力）", () => {
    const out = serializeNotesFile(parseNotesFile(json([base]), "a.md"));
    expect(Object.keys(JSON.parse(out).notes[0])).toEqual(["id", "comment", "createdAt", "updatedAt", "anchor"]);
  });

  it("不正な値のノートは読めないノートとして残す", () => {
    const f = parseNotesFile(json([{ ...base, kind: "unknown" }, { ...base, id: "n2", due: "12/1" }, { ...base, id: "n3", done: "yes" }, { ...base, id: "n4", priority: "urgent" }]), "a.md");
    expect(f.notes).toHaveLength(0);
    expect(f.invalid).toHaveLength(4);
  });
});

describe("完了の記録（doneAt）", () => {
  const AT = "2026-12-03T03:00:00.000Z";

  it("読み書きで保たれ、done の後ろに書く。完了でなければ書かない", () => {
    const out = serializeNotesFile(parseNotesFile(json([{ ...base, kind: "action", done: true, doneAt: AT }, { ...base, id: "n2", kind: "action", doneAt: AT }]), "a.md"));
    const notes = JSON.parse(out).notes;
    expect(notes[0]).toMatchObject({ done: true, doneAt: AT });
    expect(Object.keys(notes[0])).toEqual(["id", "kind", "comment", "done", "doneAt", "createdAt", "updatedAt", "anchor"]);
    expect(notes[1].doneAt).toBeUndefined();
  });

  it("文字列でなければ読めないノートとして残す", () => {
    expect(parseNotesFile(json([{ ...base, kind: "action", done: true, doneAt: 1 }]), "a.md").invalid).toHaveLength(1);
  });

  it("withFields: 完了にすると日時を記録し、編集しても保ち、未完了・メモにすると消す", () => {
    const n = parseNotesFile(json([{ ...base, kind: "action" }]), "a.md").notes[0];
    const done = withFields(n, { kind: "action", comment: "c", done: true }, AT);
    expect(done).toMatchObject({ done: true, doneAt: AT, updatedAt: AT });
    const edited = withFields(done, { kind: "action", comment: "直した", done: true }, "2026-12-05T00:00:00.000Z");
    expect(edited.doneAt).toBe(AT);
    expect(withFields(done, { kind: "action", comment: "c" }, AT).doneAt).toBeUndefined();
    expect(withFields(done, { kind: "memo", comment: "c", done: true }, AT)).toMatchObject({ done: undefined, doneAt: undefined });
  });

  it("withFields: 置き換えのリンクは決定のときだけ残す", () => {
    const d: Note = { ...parseNotesFile(json([{ ...base, kind: "decision" }]), "a.md").notes[0], supersedes: { id: "x", doc: "a.md", text: "前" } };
    expect(withFields(d, { kind: "decision", comment: "c2" }, AT).supersedes).toEqual({ id: "x", doc: "a.md", text: "前" });
    expect(withFields(d, { kind: "memo", comment: "c2" }, AT).supersedes).toBeUndefined();
  });
});

describe("全体メモ", () => {
  const place = (anchor: object) => ({ ...base, anchor: { quote: "", sourceSha256: "x", ...anchor } });

  it("読み書きで保たれ、キー順は固定", () => {
    const note = place({ type: "place", scope: "slide", slide: 2, slideId: 300, heading: "体制", quote: "体制" });
    const out = serializeNotesFile(parseNotesFile(json([note]), "a.pptx"));
    expect(parseNotesFile(out, "a.pptx").notes[0].anchor).toEqual(note.anchor);
    expect(Object.keys(JSON.parse(out).notes[0].anchor)).toEqual(["type", "scope", "slide", "slideId", "heading", "quote", "sourceSha256"]);
  });

  it("PDF のページの全体メモと、ページ番号の付いた文言のノートも保たれる", () => {
    const pageNote = place({ type: "place", scope: "page", page: 3, quote: "p.3" });
    const textNote = { ...base, anchor: { type: "text", quote: "あ", prefix: "", suffix: "", start: 0, end: 1, page: 2, sourceSha256: "x" } };
    const out = serializeNotesFile(parseNotesFile(json([pageNote, textNote]), "a.pdf"));
    const f = parseNotesFile(out, "a.pdf");
    expect(f.notes.map((n) => n.anchor)).toEqual([pageNote.anchor, textNote.anchor]);
    expect(Object.keys(JSON.parse(out).notes[0].anchor)).toEqual(["type", "scope", "page", "quote", "sourceSha256"]);
  });

  it("付け先に必要な項目が無ければ読めないノートとして残す", () => {
    const f = parseNotesFile(
      json([
        place({ type: "place", scope: "doc" }),
        place({ type: "place", scope: "slide" }),
        place({ type: "place", scope: "sheet" }),
        place({ type: "place", scope: "heading", heading: 1 }),
        place({ type: "place", scope: "page" }),
      ]),
      "a.md",
    );
    expect(f.notes).toHaveLength(1);
    expect(f.invalid).toHaveLength(4);
  });
});
