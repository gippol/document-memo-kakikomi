// サンプルの PowerPoint 資料 (samples/プロジェクト報告.pptx) を生成する: node scripts/make-sample-pptx.mjs
import pptxgen from "pptxgenjs";

// 1×1 の灰色の PNG
const GRAY_PNG = "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4BwAA5wDmWQ1dkQAAAABJRU5ErkJggg==";

const pptx = new pptxgen();
pptx.layout = "LAYOUT_16x9";

// タイトルと本文をプレースホルダーにしたレイアウト（アプリは placeholder の種類でタイトルを判定する）
pptx.defineSlideMaster({
  title: "CONTENT",
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9, h: 0.8 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.5, y: 1.3, w: 9, h: 3.8 }, text: "" } },
  ],
  slideNumber: { x: 9.2, y: 5.2 },
});

const bullets = (items) =>
  items.map(([text, indent = 0]) => ({ text, options: { bullet: true, indentLevel: indent, breakLine: true } }));

// 1. 表紙
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.addText("新会員システム プロジェクト報告", { placeholder: "title" });
  s.addText("2026年11月 定例会議 / 開発チーム", { placeholder: "body" });
  s.addNotes("冒頭で、今日は進捗と予算の2点を話すと伝える。");
}

// 2. 進捗
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.addText("進捗状況", { placeholder: "title" });
  s.addText(
    bullets([
      ["認証モジュール: 完了"],
      ["トークン更新処理の負荷試験は未実施", 1],
      ["会員情報の移行: 80%"],
      ["旧システムの住所データに表記ゆれが多い", 1],
      ["管理画面: 着手前"],
    ]),
    { placeholder: "body" },
  );
  s.addNotes("負荷試験の日程は佐藤さんに確認してから答える。");
}

// 3. 課題（左右2段組み＋画像の目印）
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.addText("課題とリスク", { placeholder: "title" });
  s.addText(bullets([["外注先の稼働が12月に減る"], ["テスト環境が1台しかない"]]), { x: 0.5, y: 1.3, w: 4.3, h: 2 });
  s.addText(bullets([["移行リハーサルの日程が未定"], ["問い合わせ窓口の体制が未定"]]), { x: 5.2, y: 1.3, w: 4.3, h: 2 });
  // 画像はアプリでは [画像: 説明] の目印になる
  s.addImage({ data: GRAY_PNG, x: 0.5, y: 3.6, w: 4, h: 1.4, altText: "開発体制図" });
}

// 4. 予算（表）
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.addText("予算の見通し", { placeholder: "title" });
  s.addTable(
    [
      ["項目", "当初予算", "見込み", "差額"],
      ["人件費", "1,200万円", "1,350万円", "+150万円"],
      ["外注費", "800万円", "800万円", "0"],
      ["合計", "2,000万円", "2,150万円", "+150万円"],
    ],
    { x: 0.5, y: 1.4, w: 9, fontSize: 14, border: { type: "solid", pt: 1, color: "999999" } },
  );
  s.addText("人件費の増加は、5月からの増員によるもの。", { x: 0.5, y: 3.8, w: 9, h: 0.5, fontSize: 14 });
  s.addNotes("差額 150 万円は予備費から出せるかを、会議で確認したい。");
}

// 5. 今後の予定（番号付き）
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.addText("今後の予定", { placeholder: "title" });
  s.addText(
    [
      { text: "12月: 移行リハーサル", options: { bullet: { type: "number" }, breakLine: true } },
      { text: "1月: 受け入れテスト", options: { bullet: { type: "number" }, breakLine: true } },
      { text: "2月: 本番切り替え", options: { bullet: { type: "number" } } },
    ],
    { placeholder: "body" },
  );
}

// 6. 予備（非表示）
{
  const s = pptx.addSlide({ masterName: "CONTENT" });
  s.hidden = true;
  s.addText("予備: 旧システムの構成", { placeholder: "title" });
  s.addText(bullets([["質問が出たときだけ見せる"]]), { placeholder: "body" });
}

await pptx.writeFile({ fileName: "samples/プロジェクト報告.pptx" });
console.log("samples/プロジェクト報告.pptx を作成しました");
