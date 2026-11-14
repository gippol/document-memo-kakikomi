// @vitest-environment jsdom
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { createAnchor, resolveAnchor } from "./anchor";
import { containerText, locateInHtml, rangeFromOffsets } from "./dom";
import { docxToHtml, sha256Hex } from "./docx";

async function buildDocx(opts: { preface?: string; created?: Date } = {}): Promise<ArrayBuffer> {
  const children = [
    new Paragraph({ text: "システム仕様概要", heading: HeadingLevel.HEADING_1 }),
    ...(opts.preface ? [new Paragraph(opts.preface)] : []),
    new Paragraph({
      children: [new TextRun("システム全体の概要として、"), new TextRun({ text: "ここが重要な仕様です", bold: true }), new TextRun("、実装時は注意してください。")],
    }),
    new Paragraph({ text: "認証モジュールの設計", heading: HeadingLevel.HEADING_2 }),
    new Paragraph("JWTを用いたセキュアなトークン認証を採用する。"),
    new Table({
      rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph("項目")] }), new TableCell({ children: [new Paragraph("内容")] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph("有効期限")] }), new TableCell({ children: [new Paragraph("1 時間")] })] }),
      ],
    }),
  ];
  const doc = new Document({
    creator: "test",
    ...(opts.created ? { lastModifiedBy: opts.created.toISOString() } : {}),
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function render(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe("docxToHtml", () => {
  it("見出し・段落・太字・表を HTML にし、段落番号を振る", async () => {
    const { html } = await docxToHtml(await buildDocx());
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>ここが重要な仕様です</strong>");
    expect(html).toContain("<table>");
    expect(html).toMatch(/data-para="1"/);
  });

  it("内容が同じなら、保存し直してファイルのバイト列が変わってもハッシュは同じ", async () => {
    const a = await buildDocx({ created: new Date("2026-01-01") });
    const b = await buildDocx({ created: new Date("2026-06-01") });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const ha = await sha256Hex((await docxToHtml(a)).text);
    const hb = await sha256Hex((await docxToHtml(b)).text);
    expect(ha).toBe(hb);
  });

  it("前に段落を挿入しても、ノートが位置を追従する", async () => {
    const v1 = render((await docxToHtml(await buildDocx())).html);
    const t1 = containerText(v1);
    const quote = "ここが重要な仕様です";
    const s = t1.indexOf(quote);
    const anchor = createAnchor(t1, s, s + quote.length, "v1");

    const v2 = render((await docxToHtml(await buildDocx({ preface: "前書きを追加しました。会議の前に一読してください。" }))).html);
    const t2 = containerText(v2);
    const r = resolveAnchor(t2, anchor);
    expect(r.status).toBe("moved");
    expect(t2.slice(r.start, r.end)).toBe(quote);
  });

  it("位置を段落番号と直前の見出しで返す", async () => {
    const root = render((await docxToHtml(await buildDocx())).html);
    const text = containerText(root);
    const s = text.indexOf("JWT");
    const loc = locateInHtml(root, rangeFromOffsets(root, s, s + 3)!);
    expect(loc.heading).toBe("認証モジュールの設計");
    expect(loc.paragraph).toBe(4);
  });
});

/** 社内テンプレート風の独自スタイルを持つ資料 */
async function buildCustomStyled(): Promise<ArrayBuffer> {
  const doc = new Document({
    styles: {
      paragraphStyles: [
        // アウトラインレベル 0（= 見出し1相当）を自分で持つ
        { id: "CorpH1", name: "社内見出し大", run: { bold: true, size: 36 }, paragraph: { outlineLevel: 0 } },
        // アウトラインレベルを基準スタイルから引き継ぐ
        { id: "CorpH1Red", name: "社内見出し大（赤）", basedOn: "CorpH1", run: { color: "C00000" } },
        { id: "CorpH2", name: "社内見出し中", run: { bold: true, size: 28 }, paragraph: { outlineLevel: 1 } },
        // 見た目だけの太字スタイル（アウトラインレベルなし）
        { id: "BigBold", name: "大きい太字", run: { bold: true, size: 32 } },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: "概要", style: "CorpH1" }),
          new Paragraph("本文その1"),
          new Paragraph({ text: "注意事項", style: "CorpH1Red" }),
          new Paragraph({ text: "詳細", style: "CorpH2" }),
          new Paragraph({ text: "補足", style: "BigBold" }),
          new Paragraph("本文その2"),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** html 内でテキストが指定タグとして出力されているか（例: tagOf(html, "概要") === "h1"） */
function tagOf(html: string, text: string): string | undefined {
  const root = document.createElement("div");
  root.innerHTML = html;
  return Array.from(root.querySelectorAll("*")).find((el) => el.textContent === text && el.children.length === 0)?.localName;
}

describe("独自の見出しスタイル", () => {
  it("アウトラインレベルから自動で見出しにする（基準スタイルからの引き継ぎも含む）", async () => {
    const r = await docxToHtml(await buildCustomStyled());
    expect(tagOf(r.html, "概要")).toBe("h1");
    expect(tagOf(r.html, "注意事項")).toBe("h1");
    expect(tagOf(r.html, "詳細")).toBe("h2");
    expect(tagOf(r.html, "補足")).toBe("p");
    expect(r.headingStyles).toEqual({ 社内見出し大: 1, "社内見出し大（赤）": 1, 社内見出し中: 2 });
  });

  it("設定で見出しを指定・解除できる（0 は見出しにしない）", async () => {
    const r = await docxToHtml(await buildCustomStyled(), { 大きい太字: 3, 社内見出し中: 0 });
    expect(tagOf(r.html, "補足")).toBe("h3");
    expect(tagOf(r.html, "詳細")).toBe("p");
    expect(r.headingStyles).toEqual({ 社内見出し大: 1, "社内見出し大（赤）": 1, 大きい太字: 3 });
  });

  it("見出し設定を変えても本文のハッシュは変わらない（ノートが旧版扱いにならない）", async () => {
    const data = await buildCustomStyled();
    const a = await docxToHtml(data);
    const b = await docxToHtml(data, { 大きい太字: 3 });
    expect(a.html).not.toBe(b.html);
    expect(await sha256Hex(a.text)).toBe(await sha256Hex(b.text));
  });
});
