import { describe, expect, it } from "vitest";
import type { FolderNote } from "./board";
import { emptyNotesFile, isNote, parseNotesFile, serializeNotesFile, type Note, type Supersedes } from "./notesFile";
import { linkDecisions, noteKey, relativeDoc, resolveDoc, supersedesOf, unpickable } from "./supersede";

function decision(docPath: string, id: string, comment: string, supersedes?: Supersedes): FolderNote {
  const note: Note = {
    id,
    kind: "decision",
    comment,
    supersedes,
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    anchor: { type: "place", scope: "doc", quote: "", sourceSha256: "x" },
  };
  return { docPath, docExists: true, note, where: null };
}

describe("relativeDoc / resolveDoc", () => {
  const cases: [string, string, string][] = [
    ["a.md", "b.md", "b.md"],
    ["a.md", "a.md", "a.md"],
    ["会議/第4回.docx", "会議/第3回.docx", "第3回.docx"],
    ["会議/2026/第4回.docx", "会議/2025/第3回.docx", "../2025/第3回.docx"],
    ["会議/第4回.docx", "spec.md", "../spec.md"],
    ["spec.md", "会議/第3回.docx", "会議/第3回.docx"],
  ];
  it.each(cases)("%s から %s は %s", (from, to, rel) => {
    expect(relativeDoc(from, to)).toBe(rel);
    expect(resolveDoc(from, rel)).toBe(to);
  });

  it("フォルダの外を指していれば null", () => {
    expect(resolveDoc("a.md", "../x.md")).toBeNull();
  });
});

describe("linkDecisions", () => {
  it("ID と資料で前の決定を探す（別の資料でもよい）", () => {
    const old = decision("会議/第3回.docx", "note-a", "予算は案A");
    const next = decision("会議/第4回.docx", "note-b", "予算は案B", { id: "note-a", doc: "第3回.docx", text: "予算は案A" });
    const links = linkDecisions([old, next]);
    expect(links.replaces.get(noteKey(next))).toBe(old);
    expect(links.replacedBy.get(noteKey(old))).toEqual([next]);
  });

  it("同じ ID が複数あれば記録した資料のものを選び、資料が変わっていても ID が一つなら見つける", () => {
    const a1 = decision("a.md", "note-001", "a の決定");
    const b1 = decision("b.md", "note-001", "b の決定");
    const n = decision("c.md", "note-x", "新", { id: "note-001", doc: "b.md", text: "" });
    expect(linkDecisions([a1, b1, n]).replaces.get(noteKey(n))).toBe(b1);

    const moved = decision("新/a.md", "note-y", "移動した決定");
    const m = decision("c.md", "note-z", "新", { id: "note-y", doc: "a.md", text: "" });
    expect(linkDecisions([moved, m]).replaces.get(noteKey(m))).toBe(moved);
  });

  it("見つからなければ null", () => {
    const n = decision("c.md", "note-x", "新", { id: "note-gone", doc: "a.md", text: "消えた決定" });
    expect(linkDecisions([n]).replaces.get(noteKey(n))).toBeNull();
  });
});

describe("supersedesOf / unpickable", () => {
  it("前の決定へのリンクを作る", () => {
    const old = decision("会議/第3回.docx", "note-a", "予算は案A\n詳細");
    expect(supersedesOf(old, "会議/第4回.docx")).toEqual({ id: "note-a", doc: "第3回.docx", text: "予算は案A 詳細" });
  });

  it("自分と、自分を置き換えている決定は選べない（循環を防ぐ）", () => {
    const a = decision("x.md", "a", "A");
    const b = decision("x.md", "b", "B", { id: "a", doc: "x.md", text: "A" });
    const c = decision("x.md", "c", "C", { id: "b", doc: "x.md", text: "B" });
    const d = decision("x.md", "d", "D");
    const links = linkDecisions([a, b, c, d]);
    expect([...unpickable(a, links)].sort()).toEqual(["x.md#a", "x.md#b", "x.md#c"]);
    expect([...unpickable(c, links)]).toEqual(["x.md#c"]);
  });
});

describe("ノートファイル", () => {
  it("supersedes を読み書きでき、形式が不正なら読めないノートにする", () => {
    const n = decision("a.md", "note-b", "B", { id: "note-a", doc: "a.md", text: "A" }).note;
    const file = parseNotesFile(serializeNotesFile({ ...emptyNotesFile("a.md"), notes: [n] }), "a.md");
    expect(file.notes[0].supersedes).toEqual({ id: "note-a", doc: "a.md", text: "A" });
    expect(isNote({ ...n, supersedes: { id: "", doc: "a.md", text: "" } })).toBe(false);
    expect(isNote({ ...n, supersedes: "note-a" })).toBe(false);
  });
});
