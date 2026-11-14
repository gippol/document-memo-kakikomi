# 資料メモ

会議資料（Markdown / Word）を **一切書き換えず**、資料ごとの別ファイル `<資料名>.notes.json` にメモを残すデスクトップアプリです。
（Tauri v2 + React + TypeScript + Tailwind CSS）

## 起動

```sh
npm install
npm run tauri dev     # 開発起動
npm run tauri build   # インストーラ作成
npm test              # ユニットテスト
```

`samples/` フォルダを開くと動作を試せます（`node scripts/make-sample-docx.mjs` でサンプル Word を再生成）。

## 使い方

1. `[ 資料フォルダを開く ]` でフォルダを選ぶ（前回のフォルダ・資料は自動で開き直します）
2. 資料のテキストを選択 → `[ + ノート ]` ボタン / Ctrl+M / 右下のボタンでノート追加（Ctrl+Enter で保存）
3. ハイライトをクリックすると対応ノートへ、ノートの `[ ジャンプ ]` で資料の該当箇所へ移動

## ノートファイル

`specification.md` → `specification.md.notes.json`（拡張子違いの同名資料と衝突しないよう、資料のファイル名をそのまま含めます）。
最初のノートを追加したときに作成され、変更は 0.5 秒後に自動保存されます（一時ファイル経由のアトミック書き込み）。

```json
{
  "version": 1,
  "source": { "file": "specification.md" },
  "notes": [
    {
      "id": "note-001",
      "comment": "来月のリリースまでに再確認",
      "createdAt": "...", "updatedAt": "...",
      "anchor": {
        "type": "text",
        "quote": "ここが重要な仕様です",
        "prefix": "…直前32文字", "suffix": "直後32文字…",
        "start": 25, "end": 35,
        "lineStart": 3, "lineEnd": 3,      // Markdown のとき
        "paragraph": 5, "heading": "2.1 …", // Word のとき
        "sourceSha256": "…ノート作成時の資料のハッシュ"
      }
    }
  ]
}
```

- `start`/`end` は **表示テキスト** 上の文字オフセット、`lineStart`/`lineEnd` は Markdown ソースの行番号（参考情報）
- キー順を固定・整形して出力するので Git の差分が読みやすい

## 対応形式

| 形式 | 表示 | 位置の表示 | 版の判定（sha256） |
| --- | --- | --- | --- |
| Markdown (.md) | react-markdown + GFM | ソースの行番号 `L12-14` | ファイルそのもの |
| Word (.docx) | mammoth.js で構造を HTML 化（見出し・段落・リスト・表・画像・リンク・脚注） | 段落番号 `¶12` ＋ 直前の見出し | 本文テキスト（再保存・書式・見出し設定の変更では変わらない） |

### Word の見出しスタイル

1. **自動判定**: 段落スタイルの「アウトラインレベル」（基準スタイルから引き継いだものを含む）を読み、見出しにします。
   Word のナビゲーションウィンドウに見出しとして出るスタイルなら自動で認識されます。
2. **設定ファイル**: アウトラインレベルを持たない独自スタイルは、資料フォルダ直下の `.shiryo-memo.json` で指定します。
   変更は保存すると即座に反映されます。

```json
{
  "docxHeadings": {
    "社内見出し大": 1,
    "社内見出し中": 2,
    "強調ボックス": 0
  }
}
```

値は見出しレベル 1〜6、`0` は「自動判定されても見出しにしない」。見出しとして扱ったスタイルは、資料上部の「Word 変換情報」で確認できます。
未対応のスタイル名も同じ欄に `Unrecognised paragraph style: 'xxx'` として表示されます。

Word の制限:
- フォント・色・ページ割りなどの見た目は再現しません（ページ番号も出せません）
- テキストボックスや図形内の文字は表示されないことがあります。変換できなかった要素は資料の上部に一覧表示します
- 古い `.doc` 形式は非対応。Word が開いている間のロックファイル `~$xxx.docx` は一覧・監視から除外します

## 資料が変更されたとき

フォルダを監視しており、外部で資料が編集されると自動で再読込して再アンカーします。

| 状態 | 意味 |
| --- | --- |
| （表示なし） | 記録位置にそのまま存在 |
| 位置を自動追従 | 引用文は同じで位置がずれていた（前後の文脈で特定） |
| 引用文が変更 | 引用文が書き換わっていた（あいまい検索で推定、波線ハイライト） |
| 該当箇所なし | 見つからない。テキストを選択して「📍 選択範囲に付け直す」で手動修正 |

ノートの `sourceSha256` が現在の資料と異なると警告バナーが出ます。「現在の版でアンカーを確定」で推定位置を保存します。
`.notes.json` が外部で変更された場合（git pull など）も自動で読み直します。壊れた JSON は上書きせず編集をロックします。

## 構成

- `src-tauri/src/lib.rs` — ファイル一覧・読込・SHA-256・ノート書き込み（`.notes.json` 専用）・フォルダ監視
- `src/lib/anchor.ts` — アンカー作成と再アンカー（完全一致 → 文脈スコア → diff-match-patch あいまい検索 → 前後文脈）
- `src/lib/dom.ts` — 表示 DOM ⇔ テキストオフセット変換
- `src/lib/document.ts` / `docx.ts` — 形式ごとの読み込み（Word は 見出しスタイル判定 → mammoth → DOMPurify → 段落番号付与）
- `src/lib/config.ts` — フォルダ設定 `.shiryo-memo.json` の読み込み
- `src/components/Viewer.tsx` — Markdown 表示、選択検知、CSS Custom Highlight API によるハイライト（資料 DOM を変更しない）
- `src/components/NotesPanel.tsx` / `FileTree.tsx` — ノート一覧・ファイルツリー

## 今後の拡張

`TextAnchor.type` を増やす形で Excel (`cell`) / PowerPoint (`slide`) に対応予定。
