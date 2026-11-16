import { describe, expect, it } from "vitest";
import { createAnchor } from "./anchor";
import type { DocEntry } from "./api";
import { mergeNotesFiles, type Note, type NotesFile } from "./notesFile";
import { relinkCandidates } from "./relink";

const d = (path: string, hasNotes = false): DocEntry => ({ path, hasNotes });

describe("relinkCandidates", () => {
  const docs = [d("new/spec.md", true), d("docs/Spec.md"), d("docs/renamed.md"), d("docs/other.docx"), d("docs/has.md", true), d("x/y.md")];

  it("同じファイル名の資料を先に、同じフォルダの名前を変えた資料を次に出す", () => {
    expect(relinkCandidates("docs/old/spec.md", docs).map((c) => [c.doc.path, c.reason])).toEqual([
      ["new/spec.md", "moved"],
      ["docs/Spec.md", "moved"],
    ]);
    expect(relinkCandidates("docs/gone.md", docs).map((c) => [c.doc.path, c.reason])).toEqual([
      ["docs/Spec.md", "renamed"],
      ["docs/renamed.md", "renamed"],
    ]);
  });

  it("候補が無ければ空", () => {
    expect(relinkCandidates("zzz/none.pptx", docs)).toEqual([]);
  });
});

describe("mergeNotesFiles", () => {
  const anchor = createAnchor("本文です", 0, 2, "sha");
  const note = (id: string, comment = id): Note => ({ id, comment, createdAt: "2026-11-15T00:00:00.000Z", updatedAt: "t", anchor });
  const file = (notes: Note[], invalid: unknown[] = []): NotesFile => ({ version: 1, source: { file: "old.md" }, notes, invalid });

  it("付け替え先にノートが無ければそのまま移し、資料名を書き換える", () => {
    const merged = mergeNotesFiles(null, file([note("a")], ["壊れたノート"]), "docs/new.md");
    expect(merged.source.file).toBe("new.md");
    expect(merged.notes.map((n) => n.id)).toEqual(["a"]);
    expect(merged.invalid).toEqual(["壊れたノート"]);
  });

  it("既存のノートの後ろに追加し、重なる ID は振り直す", () => {
    const merged = mergeNotesFiles(file([note("a"), note("b")], [{ id: "c" }]), file([note("a", "移動元"), note("c"), note("d")]), "new.md");
    const ids = merged.notes.map((n) => n.id);
    expect(ids.slice(0, 2)).toEqual(["a", "b"]);
    expect(ids[2]).not.toBe("a");
    expect(ids[3]).not.toBe("c");
    expect(ids[4]).toBe("d");
    expect(merged.notes[2].comment).toBe("移動元");
    expect(new Set(ids).size).toBe(5);
  });
});
