import { describe, expect, it } from "vitest";
import { createAnchor, resolveAnchor, trimRange } from "./anchor";
import { nextNoteId, parseNotesFile, serializeNotesFile, type Note } from "./notesFile";

const doc =
  "システム全体の概要として、ここが重要な仕様です、実装時は注意してください。\n認証モジュールの設計\nJWTを用いたセキュアなトークン認証を採用する。";

function anchorFor(text: string, quote: string) {
  const start = text.indexOf(quote);
  return createAnchor(text, start, start + quote.length, "hash-v1");
}

describe("resolveAnchor", () => {
  it("変更がなければ ok", () => {
    const a = anchorFor(doc, "ここが重要な仕様です");
    expect(resolveAnchor(doc, a)).toEqual({ status: "ok", start: a.start, end: a.end });
  });

  it("前に文章が挿入されたら moved で追従する", () => {
    const a = anchorFor(doc, "ここが重要な仕様です");
    const edited = "# 追記された見出し\n前書きを追加しました。\n" + doc;
    const r = resolveAnchor(edited, a);
    expect(r.status).toBe("moved");
    expect(edited.slice(r.start, r.end)).toBe("ここが重要な仕様です");
  });

  it("同じ文言が複数あれば文脈が一致する方を選ぶ", () => {
    const text = "Aの説明: 注意事項あり。\nBの説明: 注意事項あり。";
    const start = text.lastIndexOf("注意事項あり");
    const a = createAnchor(text, start, start + 6, "h");
    const edited = "Bの説明: 注意事項あり。\nAの説明: 注意事項あり。";
    const r = resolveAnchor(edited, a);
    expect(r.status).toBe("moved");
    expect(edited.slice(r.start - 6, r.start)).toBe("Bの説明: ");
  });

  it("引用文が少し書き換わっても fuzzy で近い箇所を推定する", () => {
    const a = anchorFor(doc, "JWTを用いたセキュアなトークン認証を採用する");
    const edited = doc.replace("JWTを用いたセキュアなトークン認証を採用する", "JWTを用いた安全なトークン認証を採用する");
    const r = resolveAnchor(edited, a);
    expect(r.status).toBe("fuzzy");
    expect(edited.slice(r.start, r.end)).toContain("JWTを用いた");
  });

  it("該当箇所が消えたら orphaned", () => {
    const a = anchorFor(doc, "JWTを用いたセキュアなトークン認証を採用する");
    const edited = "まったく別の資料になりました。内容は全面的に差し替えです。";
    expect(resolveAnchor(edited, a).status).toBe("orphaned");
  });
});

describe("trimRange", () => {
  it("前後の空白を除く", () => {
    const t = "  abc \n";
    expect(trimRange(t, 0, t.length)).toEqual([2, 5]);
  });
});

describe("notesFile", () => {
  it("シリアライズして読み戻せる", () => {
    const note: Note = {
      id: "note-001",
      comment: "再確認",
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
      anchor: anchorFor(doc, "ここが重要な仕様です"),
    };
    const json = serializeNotesFile({ version: 1, source: { file: "spec.md" }, notes: [note], invalid: [] });
    expect(parseNotesFile(json, "docs/spec.md").notes[0]).toEqual(note);
  });

  it("連番IDを採番する", () => {
    expect(nextNoteId([])).toBe("note-001");
    expect(nextNoteId([{ id: "note-009" } as Note, { id: "note-002" } as Note])).toBe("note-010");
  });

  it("読めなかったノートの ID とも重ならないよう採番する", () => {
    expect(nextNoteId([{ id: "note-001" } as Note], [{ id: "note-005" }, null])).toBe("note-006");
  });

  it("形式が不正なノートは分けて保持し、保存時にそのまま書き戻す", () => {
    const good = {
      id: "note-001",
      comment: "ok",
      createdAt: "t",
      updatedAt: "t",
      anchor: anchorFor(doc, "ここが重要な仕様です"),
    };
    const cell = {
      id: "note-002",
      comment: "セル",
      createdAt: "t",
      updatedAt: "t",
      anchor: { type: "cell", sheet: "予算", ref: "C4:D4", quote: "1 | 2", values: [["1", "2"]], sourceSha256: "x" },
    };
    const broken = [
      { id: "note-003", comment: "anchor なし", createdAt: "t", updatedAt: "t" },
      { id: "note-004", comment: "start が文字列", createdAt: "t", updatedAt: "t", anchor: { ...good.anchor, start: "0" } },
      { ...cell, id: "note-005", anchor: { ...cell.anchor, ref: "不正" } },
      "文字列",
    ];
    const json = JSON.stringify({ version: 1, source: { file: "spec.md" }, notes: [good, cell, ...broken] });
    const parsed = parseNotesFile(json, "spec.md");
    expect(parsed.notes.map((n) => n.id)).toEqual(["note-001", "note-002"]);
    expect(parsed.invalid).toEqual(broken);
    // 書き戻しても失われない
    expect(JSON.parse(serializeNotesFile(parsed)).notes.slice(2)).toEqual(broken);
  });
});
