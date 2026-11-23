import { describe, expect, it } from "vitest";
import { emptyNotesFile, type Note } from "./notesFile";
import { lastDeletedIndex, pushDeleted, removeNote, restoreNote, UNDO_LIMIT, type DeletedNote } from "./undo";

const note = (id: string): Note => ({
  id,
  comment: id,
  createdAt: "2026-11-23T00:00:00.000Z",
  updatedAt: "2026-11-23T00:00:00.000Z",
  anchor: { type: "place", scope: "doc", quote: "", sourceSha256: "x" },
});
const file = (...ids: string[]) => ({ ...emptyNotesFile("a.md"), notes: ids.map(note) });
const ids = (f: { notes: Note[] }) => f.notes.map((n) => n.id);

describe("removeNote / restoreNote", () => {
  it("削除したノートを元の位置に戻す", () => {
    const { file: after, deleted } = removeNote(file("a", "b", "c"), "b", "a.md");
    expect(ids(after)).toEqual(["a", "c"]);
    expect(deleted).toMatchObject({ path: "a.md", index: 1, note: { id: "b", comment: "b" } });
    expect(ids(restoreNote(after, deleted!))).toEqual(["a", "b", "c"]);
  });

  it("見つからないノートは削除しない", () => {
    const f = file("a");
    expect(removeNote(f, "x", "a.md")).toEqual({ file: f, deleted: null });
  });

  it("その後ノートが減っていたら末尾に戻す", () => {
    const { deleted } = removeNote(file("a", "b", "c"), "c", "a.md");
    expect(ids(restoreNote(file("a"), deleted!))).toEqual(["a", "c"]);
  });

  it("同じ ID のノートが既にあれば何もしない", () => {
    const { deleted } = removeNote(file("a", "b"), "b", "a.md");
    const f = file("a", "b");
    expect(restoreNote(f, deleted!)).toBe(f);
  });

  it("続けて削除したものを新しい順に戻せる", () => {
    let f = file("a", "b", "c");
    const stack: DeletedNote[] = [];
    for (const id of ["a", "c"]) {
      const r = removeNote(f, id, "a.md");
      f = r.file;
      stack.push(r.deleted!);
    }
    expect(ids(f)).toEqual(["b"]);
    f = restoreNote(f, stack.pop()!);
    f = restoreNote(f, stack.pop()!);
    expect(ids(f)).toEqual(["a", "b", "c"]);
  });
});

describe("履歴", () => {
  const d = (path: string, id: string): DeletedNote => ({ path, note: note(id), index: 0 });

  it("資料ごとに最後に削除したものを探す", () => {
    const list = [d("a.md", "1"), d("b.md", "2"), d("a.md", "3"), d("b.md", "4")];
    expect(lastDeletedIndex(list, "a.md")).toBe(2);
    expect(lastDeletedIndex(list, "c.md")).toBe(-1);
    expect(lastDeletedIndex(list, null)).toBe(-1);
  });

  it("上限を超えたら古いものを捨てる", () => {
    let list: DeletedNote[] = [];
    for (let i = 0; i < UNDO_LIMIT + 5; i++) list = pushDeleted(list, d("a.md", String(i)));
    expect(list).toHaveLength(UNDO_LIMIT);
    expect(list[0].note.id).toBe("5");
  });
});
