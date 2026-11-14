// サンプルの Word 資料 (samples/定例会議資料.docx) を生成する: node scripts/make-sample-docx.mjs
import { writeFileSync } from "node:fs";
import {
  Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const p = (text) => new Paragraph(text);
const h = (text, heading) => new Paragraph({ text, heading });
const bullet = (text) => new Paragraph({ text, numbering: { reference: "bullets", level: 0 } });
const num = (text) => new Paragraph({ text, numbering: { reference: "steps", level: 0 } });
const cell = (text, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

const doc = new Document({
  creator: "shiryo-memo sample",
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•" }] },
      { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1." }] },
    ],
  },
  sections: [
    {
      children: [
        h("第3回 定例会議資料", HeadingLevel.TITLE),
        p("日時: 2026年11月20日 10:00〜11:00 / 場所: 第2会議室"),
        h("1. 前回からの進捗", HeadingLevel.HEADING_1),
        new Paragraph({
          children: [
            new TextRun("認証モジュールの実装は"),
            new TextRun({ text: "予定通り完了", bold: true }),
            new TextRun("しました。ただし、トークン更新処理の負荷試験は未実施です。"),
          ],
        }),
        bullet("ログイン画面の多言語対応: 完了"),
        bullet("パスワード再設定メール: レビュー中"),
        bullet("監査ログ出力: 未着手"),
        h("2. 検討事項", HeadingLevel.HEADING_1),
        h("2.1 トークンの有効期限", HeadingLevel.HEADING_2),
        p("アクセストークンの有効期限を 1 時間から 30 分に短縮する案が出ています。セキュリティは向上しますが、リフレッシュ処理の呼び出し回数が倍になります。"),
        h("2.2 リリース日程", HeadingLevel.HEADING_2),
        p("リリース候補版は12月第1週に作成し、以下の手順で確認します。"),
        num("社内環境で受け入れ試験を行う"),
        num("性能試験の結果を確認する"),
        num("リリース判定会議で最終決定する"),
        h("3. スケジュール", HeadingLevel.HEADING_1),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [cell("項目", true), cell("担当", true), cell("期限", true)] }),
            new TableRow({ children: [cell("負荷試験"), cell("佐藤"), cell("11/27")] }),
            new TableRow({ children: [cell("監査ログ設計"), cell("田中"), cell("12/4")] }),
            new TableRow({ children: [cell("リリース判定"), cell("全員"), cell("12/11")] }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun("参考: "),
            new ExternalHyperlink({ link: "https://example.com/spec", children: [new TextRun({ text: "仕様書ポータル", style: "Hyperlink" })] }),
          ],
        }),
      ],
    },
  ],
});

writeFileSync("samples/定例会議資料.docx", await Packer.toBuffer(doc));
console.log("wrote samples/定例会議資料.docx");
