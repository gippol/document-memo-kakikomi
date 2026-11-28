---
name: run-document-memo-kakikomi
description: Run, start, launch, drive, and screenshot the document-memo-kakikomi Tauri desktop app (資料メモ かきこみ) on Windows — add notes, export minutes (議事録), test the save dialog, or check a UI change in the real app instead of only unit tests. Also covers build and test commands.
---

Tauri v2 + React のデスクトップアプリ（Windows の WebView2 で描画）。
**`.claude/skills/run-document-memo-kakikomi/driver.mjs` で操作する**: WebView2 のリモートデバッグ（CDP, 9222 番）を有効にして `npm run tauri dev` を起動し、1 コマンド = 1 回の接続でクリック・入力・スクリーンショットを行う。依存パッケージなし（Node 22+ の組み込み WebSocket を使う）。

パスはすべてリポジトリのルートからの相対パス。

## Prerequisites

この Windows 11 で確認したもの: Node 24.18.1、Rust（MSVC。Visual Studio Community のリンカー）、WebView2 ランタイム。

```bash
npm install
```

## Run (agent path)

Git Bash から実行する。**最初に `MSYS_NO_PATHCONV=1` を設定する**（しないと `/宿 …` のような引数が `C:/Program Files/Git/宿 …` に書き換わる）。

```bash
export MSYS_NO_PATHCONV=1
D=.claude/skills/run-document-memo-kakikomi/driver.mjs
node $D launch        # バックグラウンドで起動し、画面が出るまで待つ（初回ビルドは数分、2 回目以降は約 10 秒）
node $D demo          # samples/ のコピー（一時フォルダ）を開く。前に付けたノートは残る（localStorage を退避してから切り替える）
```

ノートの追加 → 完了 → 議事録 → スクリーンショット（実際に通した流れ）:

```bash
node $D select "トークン更新処理の負荷試験は未実施です"
node $D key m ctrl
node $D type "/宿 @田中 !12/1 負荷試験の計画を出す"
node $D key Enter ctrl
node $D card "負荷試験の計画" "完了にする"
node $D shot "$TEMP/shot.png"            # → 画像を Read して必ず目で見る
node $D click "議事録" aside
node $D text "[role=dialog] textarea"    # 議事録の Markdown
node $D click "クリップボード" "[role=dialog]"
```

保存ダイアログ（ネイティブのウィンドウなので CDP では触れない。PowerShell で操作する）:

```bash
node $D click ".md" "[role=dialog]"
node $D front                             # アプリを前面に（ダイアログはアプリの子として前に出る）
node $D desktop-shot "$TEMP/desktop.png"  # ダイアログが写るのはデスクトップ全体のスクリーンショットだけ
node $D dialog "議事録を保存" "{ENTER}"
node $D dialog "Confirm Save As" "%y"     # 同じ日の議事録が既にあるときだけ出る上書き確認（既定は No。%y = Alt+Y）
node $D text "[role=dialog]"              # 「保存しました: …」を確認
node $D click ".md" "[role=dialog]"       # 保存せずに閉じるときは ESC
node $D dialog "議事録を保存" "{ESC}"
```

PowerPoint・全体メモ:

```bash
node $D key Escape
node $D open "プロジェクト報告.pptx"
node $D click "3課題とリスク" "nav"       # 左のスライド一覧
node $D key m ctrl,shift                  # 全体メモ（いま見ているスライドに付く）
node $D type "/決 この体制で進める"
node $D key Enter ctrl
node $D notes                             # ノート一覧の文字（[決定] … S3 …）
```

後片付け（必ず両方）:

```bash
node $D restore   # demo 前の localStorage（前回開いたフォルダなど）に戻す
node $D stop      # アプリ・vite・tauri CLI を止める
```

| command | what it does |
|---|---|
| `launch [秒]` | CDP 付きで `npm run tauri dev` を起動し、描画まで待つ。ログは `node $D where` の場所 |
| `wait [秒]` | 描画まで待つ（Rust を変更して `tauri dev` が再起動したときなど） |
| `stop` | アプリ本体・vite・tauri CLI のプロセスを止める |
| `demo [資料名]` | `%TEMP%\document-memo-kakikomi-run\demo`（`samples/` のコピー。無ければ作る）を開く。既定は 定例会議資料.docx |
| `demo-reset` | デモフォルダを `samples/` からコピーし直す（付けたノート・議事録は消える） |
| `restore` | `demo` が退避した localStorage に戻す |
| `open <資料名>` | ファイル一覧の資料を開く |
| `select <文字列>` | 本文の文字列を選択する（1 つのテキストノード内に限る。Excel のセルは不可） |
| `click <ラベル> [CSS]` | ボタンを押す。表示文字列の完全一致 → 前方一致。CSS で範囲を絞る（`aside`, `nav`, `[role=dialog]`） |
| `card <コメントの一部> <ボタン>` | そのノートカードのボタン（`完了にする`・`編集`・`ジャンプ` など）を押す |
| `key <キー> [ctrl,shift,alt]` | キーを押す（`m`, `Enter`, `Escape`, `Tab`） |
| `type <文字列>` | フォーカス中の欄に入力（日本語可） |
| `notes` | ノート一覧のパネルの文字 |
| `text [CSS]` / `eval <式>` | 画面の文字（入力欄は value）/ 任意の JS |
| `shot [png]` | WebView の中身を撮る（ウィンドウが隠れていても撮れる） |
| `desktop-shot [png]` / `front [タイトル]` / `dialog <タイトル> [SendKeys]` | ネイティブのダイアログ用 |
| `click "BOARD" header` → `click "[宿題]<コメントの先頭>" "[role=dialog]"` | 宿題・質問ボードを開き、項目から該当箇所へ移動（行のボタンの文字は `[宿題]内容@担当〜期限資料 位置` とつながっている） |
| `card <決定のコメント> "置き換え元…"` → `click "[決定]<前の決定の先頭>" "[role=dialog]"` | 決定の置き換え元を選ぶ（選べない行は disabled。外すのは `card <コメント> "解除"`） |
| `click "質問 1" "[role=dialog]"` → `click "回答済み" "[role=dialog]"` → `click "元に戻す" "[role=dialog]"` | ボードの種類を質問だけにし、行の右のボタンで回答済みにする（宿題は `完了`）。ほかの資料のノートファイルにも書き込む。種類の「すべて」とタブの「宿題・質問」は別のボタン |
| `click "決定事項" "[role=dialog]"` → `type <語>` → `click "[決定]<内容の先頭>" "[role=dialog]"` | 決定事項の台帳に切り替え、検索して移動（検索欄は開くとフォーカスされる。最後に開いたタブを覚えている） |
| `card <コメント> "削除"` → `card <コメント> "y"` | ノートを削除（確認の y/n がある）。戻すのは `key z ctrl` か `click "元に戻す" aside` |
| `click "2. 検討事項" nav` / `click "«" nav` / `click "目次 »"` | Word・Markdown の左の見出しの目次で移動 / 目次を閉じる / 開く |
| `click "図" nav` / `click "文字" nav` | PowerPoint の表示を切り替える（図: スライドの見た目どおり / 文字: 文字のカード）。デモフォルダに `システム構成図.pptx` が無ければ `samples/` からコピーする |
| `where` | 作業フォルダ・ログ・デモフォルダの場所 |

## Run (human path)

```bash
npm run tauri dev   # → ウィンドウが開く。前回開いたフォルダ・資料を自動で開き直す。Ctrl+C で終了
```

## Test

```bash
npm test                       # vitest（181 件）
npx tsc --noEmit -p .
npm run build
(cd src-tauri && cargo test)   # 15 件
```

## Gotchas

- **起動すると前回のフォルダ（利用者の `samples/` など）を自動で開く。** そのまま操作すると利用者のノートファイルを書き換える → 必ず `demo` で一時フォルダに切り替え、最後に `restore`。
- **ノート一覧を `aside` で指定しない。** PowerPoint の発表者ノートも `aside` で、ファイル一覧も `aside`。ノート一覧は `notes`（"NOTES" で始まる aside を選ぶ）、カードのボタンは `card` を使う。`click <ラベル> aside` はボタンを持つ aside がファイル一覧とノート一覧だけなので使える。
- **`click` の前方一致に注意。** 絞り込みボタンは件数 0 だと消えるので、`click "未完了" aside` がカードの「未完了に戻す」を押してしまったことがある。絞り込みボタンの文字は `未完了 2` のように件数付き。
- **保存ダイアログは `shot` に写らない**（WebView の外）。`front` → `desktop-shot`。キーを送る前に `dialog` がダイアログを前面に出すので、Enter がアプリの textarea に入ることはない。
- **ネイティブのダイアログを開いたままにしない。** `save_minutes` はダイアログを待ち続ける。`dialog "議事録を保存" "{ESC}"` で閉じる。
- **PDF の文字は細かい span に分かれる**（フォントの切り替わりで 1 文字ずつのこともある）ので、`select` で見つからないことが多い。`node $D eval "[...document.querySelectorAll('section[data-page=\"2\"] .textLayer span')].map(s=>s.textContent).join(' | ')"` で区切りを見て、1 つの span 内の文字を選ぶか、`eval` で 2 つの span にまたがる Range を作って `getSelection().addRange(r)` する。デモフォルダに PDF が無ければ `samples/週次報告.pdf` をコピーする（`demo-reset` はノートが消える）
- **PDF は 2 回目からキャッシュ（`%LOCALAPPDATA%\com.document-memo-kakikomi.app\pdf-cache\`）を使う。** 初めて開くときの速さや描画を確かめるときは、その PDF のキャッシュ（中身の同じ PDF なら同じフォルダ）を消してから開く。ページ画像は表示欄の近くのページにしか入らない（`img.pdf-img[src]` で確かめる）
- **開けるのは「資料フォルダを開く」で選んだことのあるフォルダだけ。** 一覧は `%APPDATA%\com.document-memo-kakikomi.app\allowed-folders.json`（`open_folder` はここに無いフォルダを断る）。`demo` はデモフォルダをこの一覧に足してから開く。`restore` で戻した前回のフォルダが一覧に無いと「もう一度選んでください」と出る。
- **フォルダ選択ダイアログ（資料フォルダを開く）には `dialog` の SendKeys が効かない**（`{ESC}` は効く）。UI Automation で ID 1152 の欄のハンドルを取り、WM_SETTEXT でパスを入れ、ID 1（Select Folder）に BM_CLICK を送る。
- **`click` で開いたクリップボードのコピーは本物の Windows のクリップボードを上書きする。**
- **Rust を変更すると `tauri dev` がアプリを自動で再起動する**（CDP の接続先も変わる）。`node $D wait` で待ってから続ける。
- **デモフォルダのノートは残しておく**（利用者の希望）。`demo` は既存のコピーをそのまま開く。まっさらにしたいときだけ `demo-reset`。

## Troubleshooting

- **`ERROR: アプリが見つかりません（9222 番ポート）`**: 未起動か、`npm run tauri dev` を CDP なしで起動している。`node $D stop` → `node $D launch`。
- **保存の `{ENTER}` の後も「保存しました」が出ない**: 同じ名前のファイルがあり、`Confirm Save As`（既定は No）が出ている。`node $D dialog "Confirm Save As" "%y"`。英語以外の Windows ではタイトルが違う → `desktop-shot` で確かめる。
- **`LINK : fatal error LNK1104: cannot open file ...\target\debug\deps\....exe`**（`cargo test`）: アプリを止めた直後で実行ファイルがロックされている。数秒待ってやり直す。
- **`desktop-shot` が左上の一部（1536×960 など）しか写らない**: 拡大表示（125%）で PowerShell が DPI 非対応のとき。ドライバは `SetProcessDPIAware` を呼んで対処済み。
- **`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`**: WebSocket を閉じ終わる前に `process.exit` したとき。ドライバは閉じるのを待ち、`process.exitCode` で終わるようにしてある。
