# PowerPoint の取り扱い（技術メモ）

PowerPoint にノートを付ける仕組みのメモ。スライドの見た目の再現は TASKS 45。

## 方針

.pptx の XML を読んで HTML にする（`src/lib/pptx.ts`）。PDF のように画像にはせず、文字は DOM の文字のまま選べるようにする。

同じ HTML を、CSS で 2 通りに表示する（`src/index.css`）。スライド一覧の上の「表示: 図 / 文字」で切り替え、選んだほうを覚える。

| 表示 | クラス | 見え方 |
| --- | --- | --- |
| 図（既定） | `.pptx-layout` | 図形・画像・線を、スライド上の位置・大きさ・塗り・枠線・文字の書式どおりに並べる |
| 文字 | `.pptx-cards` | 「スライドごとの文字のカード」。文字・表・目印（`[画像: 説明]`）を上から並べる |

## 文字は変えない（アンカー・版の判定のため）

ノートのアンカーと版の判定（sha256）は、DOM の文字（`textContent`）で行う。見た目を再現するために文字の並びを変えると、既存のノートが「旧版」になってしまう。そこで:

- DOM の順は、どちらの表示でも読む順（タイトル → 上から・左から。グループの中も同じ）。見た目の重なり順は `--z`（z-index）で表す
- 位置・大きさ・書式は CSS 変数と data 属性だけで持つ。文字を足さない
- 画像の `alt` は空。目印の文字（`data-label`）とマスター・レイアウトの飾りの文字（`data-deco`）は CSS の `content: attr(...)` で表示する
- 段落の要素（p・li・h2）の並びと `data-para` の番号も変えない

TASKS 45 の前後で、`samples/プロジェクト報告.pptx` の本文テキスト・段落・スライドの情報が同じであることを確かめた。

## 出力する HTML

```html
<section class="slide" data-slide="1" data-slide-id="256" data-title="システム構成図">
  <div class="slide-canvas" style="--sw:720;--shh:405;--bg:#fff">     ← スライドの大きさ（pt）と背景
    <div class="sh sh-deco" style="--x:0;--y:0;--w:100;--h:2.4;--z:1;--fill:#335599" data-geo="rect"></div>
    <div class="sh" style="--x:32;--y:27;--w:20;--h:20;--z:5;--fill:#335599;--ln:#333333;--lw:1;--rad:7.2;--il:7.2;…" data-geo="roundRect">
      <div class="sh-tx" style="--il:7.2;--it:3.6;--ir:7.2;--ib:3.6;" data-va="ctr">
        <p style="--fs:14;--c:#fff" data-al="ctr"><span style="--fw:700;">Web サーバー</span></p>
      </div>
    </div>
    <div class="sh-line" style="--z:9;--lw:2;--c:#333333">
      <div class="sh-seg" style="--x1:172.8;--y1:118.8;--len:57.6;--ang:0deg" data-tail="tri"></div>
    </div>
    <div class="sh sh-pic" style="…"><div class="slide-img" data-label="画像: 説明"></div><img class="pic" src="blob:…" alt=""></div>
    <div class="sh sh-mark" style="…"><div class="slide-img" data-label="グラフ"></div></div>
  </div>
  <aside class="slide-notes">…発表者ノート…</aside>
</section>
```

- 位置・大きさ（`--x` `--y` `--w` `--h`）はスライドに対する %
- 長さ（余白 `--il` など、枠線 `--lw`、角丸 `--rad`、線の座標）と文字の大きさ（`--fs`）は pt。表示側で `--pt` を掛ける
- `--pt` は `.slide-canvas` の `calc(100cqw / var(--sw))`。`.slide-canvas` を container にしているので、表示欄の幅に合わせてスライド全体が伸び縮みする（PDF の `--total-scale-factor` と同じ考え方）
- 書式の CSS 変数（`--fs` `--c` `--fw` `--fst`）は継承される。図形の既定 → 段落 → 文字の範囲（span）の順に上書きする
- 「文字」の表示では、`.slide-canvas` `.sh` `.sh-tx` を `display: contents` にして、今までのカードと同じ流れにする。線・図形の形・画像・飾りは出さない

## 何をどこから読むか

| 見た目 | 読むところ | 関数 |
| --- | --- | --- |
| 位置・大きさ・回転 | `spPr/xfrm`。プレースホルダーで無ければレイアウト → マスターの同じプレースホルダー。グループの中は `grpSpPr/xfrm` の off・ext・chOff・chExt で変換。回転したグループは中身をまとめて `.sh-grp` でグループの中心で回す | `boxOf`、`grpSp` |
| 塗り | `spPr` の solidFill・gradFill・pattFill・blipFill・noFill。無ければ `p:style/fillRef` | `fillOf`、`styleRefColor` |
| 枠線 | `spPr/ln`。無ければ `p:style/lnRef`（太さはテーマの `lnStyleLst`） | `lineOf` |
| 色 | srgbClr・schemeClr（スライド・レイアウトの `clrMapOvr`、無ければマスターの `clrMap` と、テーマの `clrScheme`）・sysClr・prstClr。lumMod・lumOff・tint・shade・satMod・alpha | `colorOf` |
| 形 | `prstGeom`（四角・角丸・楕円は CSS、ほかのよく使う形は SVG）、`custGeom`（SVG のパス） | `presetGeom`、`customGeom` |
| 線・コネクタ | `cxnSp` と、線の形の `sp`。直線とカギ線（bentConnector2・3）。矢印は headEnd・tailEnd | `connectorPoints`、`lineHtml` |
| 文字の書式 | 文字の範囲の `rPr` → 図形の `lstStyle` →（プレースホルダー）レイアウト・マスターの同じプレースホルダーの `lstStyle` → マスターの `txStyles`（title・body・other）→ `presentation.xml` の `defaultTextStyle`。プレースホルダーでない図形は `p:style/fontRef` の色をはさむ | `levelStyle`、`textSources` |
| 文字の枠 | `bodyPr` の余白・anchor（縦位置）・wrap・vert・normAutofit の fontScale。プレースホルダーはレイアウト・マスターから受け継ぐ | `bodyAttrs` |
| 画像 | `blipFill/blip` の r:embed → zip の中の画像を blob URL に（同じ画像は 1 つの URL を使い回す。マスターのロゴが全スライドに出ても HTML は大きくならない）。`srcRect` の切り抜き | `Package.image` |
| 背景 | スライド → レイアウト → マスターの `cSld/bg`（bgPr または bgRef） | `background` |
| 飾り | マスター・レイアウトのプレースホルダー以外の図形。`showMasterSp="0"` なら出さない | `decoHtml` |

## 画像の blob URL

- DOMPurify は `blob:` の src を消すので、画像は `data-src` に入れて無害化し、その後でこちらが作った URL だけを `src` に戻す
- blob URL は資料を表示しなくなったら解放する（`disposeDoc`。PDF のページ画像と同じ）
- 外部での変更を検知して読み込み直すとき、blob URL は毎回変わる。表示内容が同じかどうかは、URL を zip の中の画像の名前に置き換えた `viewKey` で比べる（同じなら作り直さない）

## 再現しないもの

- グラフ・SmartArt の図・動画・埋め込みオブジェクト（場所に目印を出す。SmartArt の文字は箇条書きで出す）
- EMF・WMF・TIFF の画像（目印だけ。警告を出す）
- 影・3D・ぼかしなどの効果、グラデーションの種類（線形として近似）、模様の塗り（前景の色で塗る）
- 曲線のコネクタ（直線で近似）、テーマのフォント、行間・段落の前後の間隔、箇条書きの記号の種類・字下げの幅
- 表のスタイル（罫線と、セルに直接指定した塗りだけ）
- 箇条書きかどうかは、今までどおり段落とプレースホルダーの種類だけで決める（マスターの設定は見ない。段落の構造を変えないため）

## テスト・確認

- 単体テスト: `src/lib/pptxDraw.test.ts`（色・塗り・線・形・コネクタ・書式の優先順）、`src/lib/pptxLayout.test.ts`（テーマ・マスター・レイアウト・グループ・画像・コネクタを含む .pptx を組み立てて、出力の CSS 変数を確かめる）、`src/lib/pptx.test.ts`（読む順・アンカー）
- サンプル: `samples/システム構成図.pptx`（`node scripts/make-sample-diagram-pptx.mjs`。図形・矢印・画像・グラフ）
- 実画面: `run-document-memo-kakikomi` スキルのドライバ。`click "図" nav` / `click "文字" nav` で表示を切り替える
