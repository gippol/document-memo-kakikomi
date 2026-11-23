# PDF の取り扱い（技術メモ）

PDF にノートを付ける仕組みのメモ。対応は TASKS 36 / PR #10。

## 方針

PDF を Markdown などに変換せず、**pdf.js で見た目のまま表示し、その上に重ねた透明な文字にアンカーを付ける**。

docling などで事前に .md に変換する案は採らなかった。

- メモが元の PDF ではなく変換後の .md に付き、PDF が差し替わると変換し直しになる
- 図・数式・表の配置などの見た目が失われる
- Python と AI モデル（数 GB）が必要で、Tauri アプリとして配布しにくい
- 対象は文字の入った PDF なので、docling の強み（OCR・レイアウト解析）を活かしにくい

## 全体の流れ

```
PDF のバイト列（Rust の read_document_bytes）
  └─ src/lib/document.ts  loadOnce: kind === "pdf"
       └─ src/lib/pdf.ts  pdfToHtml()  ← pdf.js は開くときだけ動的 import
            ├─ ページごとに canvas に描く → PNG の blob URL（見た目）
            ├─ ページごとに TextLayer → 透明な <span> の HTML（文字）
            └─ HTML・本文テキスト・警告・ページ数・blob URL を返す
  └─ src/components/Viewer.tsx  HTML を描画（PowerPoint と同じ dangerouslySetInnerHTML）
       ├─ TextIndex（src/lib/dom.ts）で表示テキストを作る → 既存のアンカーの仕組みへ
       ├─ pageSpans で各ページのテキスト上の範囲を求める
       └─ 左にページ一覧、ページ幅を表示欄に合わせる
```

ページ画像と文字の層が HTML の中にそろうので、そこから先（選択 → `createAnchor` → `.notes.json` → 再アンカー → CSS Custom Highlight API）は Word・PowerPoint と同じ。

## 出力する HTML

```html
<section class="pdf-page" data-page="2" style="--page-w:595;--page-h:842">
  <img class="pdf-img" src="blob:…" alt="" draggable="false">
  <div class="textLayer" style="--min-font-size: …; width: …; height: …">
    <span role="presentation" style="left: 77.59%; top: 45.73%; --font-height: 10.99px; --scale-x: 1.0025;">15</span>
    …
  </div>
</section>
```

- `--page-w` / `--page-h`: ページの大きさ（PDF の pt。回転しているページは幅と高さを入れ替える）
- `img` の `alt` は空にする。アンカーの基準テキストに混ざらないようにするため
- 文字の層は TextLayer の出力を `container.outerHTML` ごと使う。pdf.js は文字の大きさの補正値 `--min-font-size` を container の style に書くので、`innerHTML` だと失われる

## 画像と文字の位置が合う理由

1. **同じ座標から作る**: PDF の文字の断片には、置く位置と大きさ（変換行列）が書かれている。canvas の描画も TextLayer も、これを同じ viewport で変換している。TextLayer は位置をページに対する %（`left` / `top`）で、文字の高さを `--font-height` で書く
2. **幅は横に伸び縮みさせて合わせる**: 透明な文字は `sans-serif` などの代わりのフォントで表示されるので、そのままでは幅が違う。TextLayer は `measureText` で測った幅と PDF 上の幅の比を `--scale-x` にして、`scaleX()` で合わせる。高さ方向も、フォントの上端からベースラインまでの高さ（ascent）を測って補正する
3. **倍率は CSS 変数 1 つ**: `--total-scale-factor`（1 = 72dpi）だけで、次がすべて決まる。表示欄の幅に合わせて倍率を変えても、画像と文字が一緒に動く
   - ページの大きさ: `--total-scale-factor × --page-w`
   - 画像: ページの幅いっぱい（`width: 100%`）
   - 文字の位置: ページに対する %
   - 文字の大きさ: `--total-scale-factor × --font-height`

合わせているのは span 全体の幅だけで、1 文字ずつの幅は合わせていない。長い span の途中を選ぶと、選択の境目が見た目と少しずれることがある。

## ページ画像

- `RENDER_SCALE = 2`（144dpi 相当）で描く。表示の倍率は CSS で決まるので、拡大しすぎなければにじまない
- **透明ありの canvas context を渡す**（`getContext("2d", { alpha: true })`）。pdf.js 既定の不透明な context では、WebView2 が文字をサブピクセル（ClearType）で描いてしまい、縮小表示で数字が青っぽくにじんだ
- `page.render({ canvas: null, canvasContext, viewport })` の形にする。`canvas` を渡すと、pdf.js は `canvasContext` を無視して自分で不透明の context を作る
- PNG の blob URL は、資料を閉じたり読み直したりしたときに `URL.revokeObjectURL` で解放する（`src/hooks/useWorkspace.ts` の `shownPdfUrls`）
  - StrictMode で effect が 2 回走っても、表示中の URL は解放しないようにしてある
  - 外部で PDF が更新されたときは、blob URL を除いた HTML と sha256 を比べる。同じなら新しく読んだほうの URL を捨てて、再描画しない

## 文字の正規化

`normalizePdfText`（`src/lib/pdf.ts`）で、文字の層のテキストノードを直す。字形が同じなので、表示上の位置はずれない。

- pdf.js の `normalizeUnicode`: 合字（`ﬁ` → `fi`）など。pdf.js のビューアーが検索・コピーで行うのと同じもの
- 康熙部首・CJK 部首補助（U+2E80〜U+2FDF）の NFKC: フォントによって「月」「日」が `⽉`（U+2F49）`⽇`（U+2F47）として取り出される。`normalizeUnicode` はこの範囲を直さないので、自前で追加した。直さないと、議事録の引用や検索で別の文字になる

## 位置情報

- 文言に付けたノート: `anchor.page`（1 始まり）。`locateInHtml`（`src/lib/dom.ts`）が `section[data-page]` を見て決める。PDF には見出しや段落の構造がないので、ページ番号だけを記録する
- 全体メモ: `scope: "page"`（`src/lib/place.ts`）。`page` の番号で探す
- 表示はどこでも `p.N`（ノート一覧の `locationLabel`、ボードの `whereOf`、議事録の `groupOf` / `sourceOf`）。議事録のメモはページごとにまとめる
- 再アンカーで、探す範囲をページに絞らない。PowerPoint のスライド ID と違い、ページを入れ替えると番号が変わるため
- 版の判定（sha256）には、文字の層の文字をつなげたものを使う。PDF を書き出し直して日時などのメタ情報だけ変わっても、旧版扱いにしない

## 表示

- `.doc-pdf` のスタイルは `src/index.css`。pdf.js の `web/pdf_viewer.css` から `.textLayer` の必要な部分だけを移した
- ハイライトは半透明にし、文字色は透明のままにする（`.doc-pdf ::highlight(...)`）。ページ画像の文字が見えるようにするため
- ページの幅を表示欄に合わせる。`Viewer.tsx` の ResizeObserver が `--total-scale-factor` を書き換える（0.4〜2 倍の範囲）
- 左のページ一覧は PowerPoint のスライド一覧と同じ作りで、`unitAttr` で `data-page` / `data-slide` を切り替える

## pdf.js の補助データと CSP

`vite.config.ts` の `pdfjsAssets` プラグインで `/pdfjs/` に置く。開発時は `node_modules/pdfjs-dist` からそのまま配り、ビルド時は `dist/pdfjs/` にコピーする。

| データ | 用途 | ライセンス | 同梱 |
| --- | --- | --- | --- |
| `cmaps/` | フォントを埋め込んでいない日本語などの PDF の文字の対応表 | BSD-3-Clause（Adobe） | する |
| `wasm/jbig2*` | JBIG2 画像 | BSD-3-Clause（PDFium）、Apache-2.0 | する |
| `wasm/openjpeg*` | JPEG 2000 画像 | BSD-2-Clause | する |
| `wasm/qcms_bg.wasm` | ICC プロファイル（色） | MIT | する |
| `iccs/` | CMYK の既定の ICC プロファイル | CC0 | する |
| `standard_fonts/` | 埋め込みの無い標準 14 フォント | Foxit（BSD 系）、Liberation（GPLv2 ＋例外） | しない（`useSystemFonts: true` で OS のフォントで代用） |
| `wasm/quickjs*` | PDF 内の JavaScript | MIT | しない（使わない） |

- worker（`pdf.worker.min.mjs`）は Vite の `?url` import でバンドルする
- CSP（`src-tauri/tauri.conf.json`）に `script-src 'self' 'wasm-unsafe-eval'` を追加した（wasm 用）。画像の blob URL は、もともと `img-src blob:` で許可してある
- 同梱するライブラリ・データのライセンスは `THIRD_PARTY_LICENSES.md` に載せ、ビルドにも入れる。依存を変えたら `node scripts/make-third-party-licenses.mjs` で作り直す

## テスト・確認

- 単体テスト: `src/lib/pdf.test.ts`（HTML の組み立て・警告・正規化）、`dom.test.ts`（`pageSpans` / `locateInHtml`）、`place.test.ts`・`notesFile.test.ts`・`minutes.test.ts`・`board.test.ts`（ページの位置）
  - jsdom には canvas がないので、`pdfToHtml` 自体は単体テストせず、実画面で確かめる
- サンプル: `samples/週次報告.pdf`。`node scripts/make-sample-pdf.mjs` が、Microsoft Edge のヘッドレス印刷で HTML から作る
- 実画面: `run-document-memo-kakikomi` スキルのドライバで確認する
  - PDF の文字は 1 文字ずつの span に分かれていることが多く、ドライバの `select` で見つからないことがある。そのときは `eval` で span をまたぐ Range を作る（スキルの Gotchas を参照）

## 制限・未確認

- スキャン画像だけの PDF は表示できるが、文字を選べない（警告を出す。全体メモは使える）
- 段組みの PDF では、文字の層の順番が見た目の読み順とずれることがあり、選択や引用の文字の順番が不自然になる
- パスワード付きの PDF は開けない（`PasswordException` のときはメッセージを出す）。フォーム・注釈・リンクは表示しない
- 全ページを開くときに描く。ページ数の多い PDF は開くのが遅く、メモリも使う。必要になったら、見えているページだけを描く遅延描画にする
- JBIG2 や JPEG 2000 の画像を含む PDF は未確認（wasm が CSP の下で動くか）
