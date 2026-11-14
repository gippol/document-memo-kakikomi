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
    const ha = await sha256Hex((await docxToHtml(a)).html);
    const hb = await sha256Hex((await docxToHtml(b)).html);
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
