// 図が中心の PowerPoint 資料 (samples/システム構成図.pptx) を生成する: node scripts/make-sample-diagram-pptx.mjs
// 図形・矢印・塗り・画像・グラフの見た目を確かめるためのサンプル（TASKS 45）
import zlib from "node:zlib";
import pptxgen from "pptxgenjs";

/** 横グラデーションの PNG（画像の表示の確認用。外部のファイルを使わずに作る） */
function gradientPng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = 40 + Math.round((200 * x) / w);
      raw[i + 1] = 90 + Math.round((100 * y) / h);
      raw[i + 2] = 200 - Math.round((150 * x) / w);
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `image/png;base64,${png.toString("base64")}`;
}

const pptx = new pptxgen();
pptx.layout = "LAYOUT_16x9";

pptx.defineSlideMaster({
  title: "DIAGRAM",
  background: { color: "FFFFFF" },
  objects: [
    // 上の帯（文字の無い飾り）
    { rect: { x: 0, y: 0, w: 10, h: 0.12, fill: { color: "335599" } } },
    { placeholder: { options: { name: "title", type: "title", x: 0.4, y: 0.2, w: 9.2, h: 0.7, fontSize: 26, bold: true, color: "223355" }, text: "" } },
  ],
  slideNumber: { x: 9.2, y: 5.2, fontSize: 10, color: "888888" },
});

// 1. システム構成図（箱と矢印）
{
  const s = pptx.addSlide({ masterName: "DIAGRAM" });
  s.addText("システム構成図", { placeholder: "title" });
  const box = (text, x, y, color, opts = {}) =>
    s.addText(text, {
      shape: opts.shape ?? pptx.ShapeType.roundRect,
      x,
      y,
      w: opts.w ?? 2,
      h: opts.h ?? 0.9,
      fill: { color },
      line: { color: "333333", width: 1 },
      color: opts.color ?? "FFFFFF",
      fontSize: opts.fontSize ?? 14,
      bold: true,
      align: "center",
      valign: "middle",
      rectRadius: 0.1,
    });
  box("利用者\n（ブラウザ）", 0.4, 2.2, "E8A33D", { shape: pptx.ShapeType.ellipse, color: "222222" });
  box("Web サーバー", 3.2, 1.2, "335599");
  box("認証サービス", 3.2, 3.3, "335599");
  box("会員 DB", 6.6, 1.2, "4A8F5C", { shape: pptx.ShapeType.can ?? pptx.ShapeType.rect });
  box("トークン\nストア", 6.6, 3.3, "4A8F5C");
  const arrow = (x, y, w, h, flipV = false) =>
    s.addShape(pptx.ShapeType.line, { x, y, w, h, flipV, line: { color: "333333", width: 2, endArrowType: "triangle" } });
  arrow(2.4, 1.65, 0.8, 0.95, true);
  arrow(2.4, 2.65, 0.8, 1.1);
  arrow(5.2, 1.65, 1.4, 0);
  arrow(5.2, 3.75, 1.4, 0);
  arrow(4.2, 2.1, 0, 1.2);
  s.addText("HTTPS", { x: 5.3, y: 1.25, w: 1.2, h: 0.35, fontSize: 11, color: "555555", align: "center" });
  s.addText("負荷試験は未実施", { x: 3.2, y: 4.4, w: 2.4, h: 0.4, fontSize: 12, color: "C0392B", italic: true });
  s.addNotes("認証サービスとトークンストアの間の負荷がまだ測れていない、と説明する。");
}

// 2. 画像とグラフ
{
  const s = pptx.addSlide({ masterName: "DIAGRAM" });
  s.addText("利用状況", { placeholder: "title" });
  s.addImage({ data: gradientPng(160, 90), x: 0.4, y: 1.2, w: 4.2, h: 2.4, altText: "利用者数のヒートマップ" });
  s.addText("平日の朝 9 時台に利用が集中している", { x: 0.4, y: 3.7, w: 4.2, h: 0.5, fontSize: 13, color: "333333" });
  s.addChart(
    pptx.ChartType.bar,
    [{ name: "ログイン数", labels: ["9月", "10月", "11月"], values: [1200, 1850, 2400] }],
    { x: 5.0, y: 1.2, w: 4.6, h: 3.2, showTitle: true, title: "月別ログイン数" },
  );
}

// 3. 文字だけのスライド（今のカード表示と同じように読めることの確認）
{
  const s = pptx.addSlide({ masterName: "DIAGRAM" });
  s.addText("まとめ", { placeholder: "title" });
  s.addText(
    [
      { text: "構成は 5 つのサービスに分ける", options: { bullet: true, breakLine: true } },
      { text: "認証まわりの負荷試験を 12 月中に行う", options: { bullet: true, breakLine: true } },
      { text: "詳細は別紙", options: { bullet: true, indentLevel: 1 } },
    ],
    { x: 0.6, y: 1.3, w: 8.8, h: 3, fontSize: 20, color: "222222" },
  );
}

await pptx.writeFile({ fileName: "samples/システム構成図.pptx" });
console.log("samples/システム構成図.pptx を作成しました");
