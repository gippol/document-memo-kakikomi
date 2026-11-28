#!/usr/bin/env node
// document-memo-kakikomi を外から操作するドライバ（Windows・依存なし。Node 22+ の組み込み WebSocket を使う）。
// アプリを WebView2 のリモートデバッグ（CDP）付きで起動し、1 コマンド = 1 回の接続で操作する。
// 使い方は同じフォルダの SKILL.md を参照。

import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK = join(tmpdir(), "document-memo-kakikomi-run");
const LOG = join(WORK, "tauri-dev.log");
const LS_BACKUP = join(WORK, "localStorage-backup.json");
const DEMO = join(WORK, "demo");
const PORT = 9222;
const LS_PREFIX = "document-memo-kakikomi:";

mkdirSync(WORK, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.find((t) => t.type === "page" && t.url.includes("localhost:1420")) ?? null;
  } catch {
    return null;
  }
}

/** CDP に接続して fn(send) を実行する */
async function withPage(fn) {
  const page = await target();
  if (!page) throw new Error(`アプリが見つかりません（${PORT} 番ポート）。先に launch してください`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    // 閉じ終わる前に終了すると libuv の Assertion failed で落ちるので待つ
    const closed = new Promise((r) => ws.addEventListener("close", r));
    ws.close();
    await closed;
  }
}

/** ページで式を評価して値を返す（例外はエラーにする） */
async function evaluate(expression) {
  return withPage(async (send) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  });
}

const js = (v) => JSON.stringify(v);

/** ノート一覧のパネル（PowerPoint の発表者ノートも aside なので、"NOTES" で始まるものを選ぶ） */
const NOTES_PANEL = `[...document.querySelectorAll("aside")].find(a => a.innerText.startsWith("NOTES"))`;

function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
}

/** document-memo-kakikomi の dev 起動で立ち上がったプロセス（アプリ本体・vite・tauri CLI） */
function devProcesses() {
  const out = powershell(
    // 検索している PowerShell 自身のコマンドラインも条件に当たるので除く
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } | Where-Object { $_.Name -eq 'document-memo-kakikomi.exe' -or ($_.CommandLine -like '*document-memo-kakikomi*' -and ($_.CommandLine -like '*vite*' -or $_.CommandLine -like '*tauri*')) } | ForEach-Object { "$($_.ProcessId)\`t$($_.Name)" }`,
  );
  return out ? out.split(/\r?\n/).map((l) => l.split("\t")) : [];
}

async function waitReady(timeoutSec) {
  const end = Date.now() + timeoutSec * 1000;
  while (Date.now() < end) {
    if (await target()) {
      // 画面（React）が描画されるまで待つ
      try {
        if (await evaluate("document.body.innerText.length > 0")) return true;
      } catch {
        /* 読み込み中 */
      }
    }
    if (existsSync(LOG) && /error\[|error: could not compile|panicked/.test(readFileSync(LOG, "utf8"))) {
      throw new Error(`起動に失敗しました。ログ: ${LOG}`);
    }
    await sleep(1000);
  }
  throw new Error(`${timeoutSec} 秒待ってもアプリが起動しません。ログ: ${LOG}`);
}

/**
 * アプリが開いてよいフォルダの一覧（利用者がフォルダ選択ダイアログで選んだもの）に folder を足す。
 * open_folder は一覧に無いフォルダを開かないので、デモフォルダはここで足しておく
 */
function allowFolder(folder) {
  const file = join(process.env.APPDATA, "com.document-memo-kakikomi.app", "allowed-folders.json");
  let list = [];
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* 無い・壊れているときは作り直す */
  }
  if (Array.isArray(list) && list.includes(folder)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([folder, ...(Array.isArray(list) ? list : [])], null, 2));
}

const commands = {
  /** npm run tauri dev を CDP 付きでバックグラウンド起動し、画面が出るまで待つ */
  async launch(timeoutSec = "600") {
    if (await target()) return "すでに起動しています";
    const fd = openSync(LOG, "w");
    const child = spawn("npm run tauri dev", {
      cwd: UNIT,
      shell: true,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    });
    child.unref();
    await waitReady(Number(timeoutSec));
    return `起動しました（ログ: ${LOG}）`;
  },

  async wait(timeoutSec = "120") {
    await waitReady(Number(timeoutSec));
    return "ready";
  },

  /** アプリ・vite・tauri CLI を止める */
  async stop() {
    const procs = devProcesses();
    if (procs.length === 0) return "動いていません";
    // 親を止めると子も終わるので、もう無いプロセスのエラーは無視する
    powershell(`foreach ($id in @(${procs.map((p) => p[0]).join(",")})) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} }`);
    await sleep(1000);
    return `停止しました: ${procs.map((p) => p.join(" ")).join(", ")}`;
  },

  /**
   * samples/ のコピー（一時フォルダ）を開く（利用者の samples/ や前回のフォルダを書き換えないため）。
   * コピーが既にあればそのまま使う（前に付けたノートを残す）。作り直すときは demo-reset。
   * 最初に localStorage を退避する。終わったら restore で戻す
   */
  async demo(doc = "定例会議資料.docx") {
    if (!existsSync(DEMO)) cpSync(join(UNIT, "samples"), DEMO, { recursive: true });
    allowFolder(DEMO);
    if (!existsSync(LS_BACKUP)) {
      const backup = await evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))`);
      writeFileSync(LS_BACKUP, backup);
    }
    await evaluate(`(() => {
      localStorage.setItem(${js(LS_PREFIX + "lastRoot")}, ${js(DEMO)});
      localStorage.setItem(${js(LS_PREFIX + "lastDoc:" + DEMO)}, ${js(doc)});
      localStorage.setItem(${js(LS_PREFIX + "layout")}, "side");
      location.reload();
    })()`);
    await sleep(1500);
    await waitReady(30);
    return `開きました: ${DEMO}\\${doc}`;
  },

  /** デモフォルダを samples/ からコピーし直す（付けたノート・書き出した議事録は消える） */
  async "demo-reset"() {
    rmSync(DEMO, { recursive: true, force: true });
    cpSync(join(UNIT, "samples"), DEMO, { recursive: true });
    return `作り直しました: ${DEMO}（開くには demo）`;
  },

  /** demo の前の localStorage に戻す */
  async restore() {
    if (!existsSync(LS_BACKUP)) return "退避した localStorage がありません";
    const backup = readFileSync(LS_BACKUP, "utf8");
    await evaluate(`(() => {
      const b = ${backup};
      for (const k of Object.keys(localStorage)) if (!(k in b)) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(b)) localStorage.setItem(k, v);
    })()`);
    rmSync(LS_BACKUP);
    return "localStorage を戻しました";
  },

  /** ファイル一覧の資料を開く */
  async open(name) {
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll("button, div, li, span")].find(e => e.children.length === 0 && e.textContent.trim() === ${js(name)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`ファイル一覧に見つかりません: ${name}`);
    await sleep(1200);
    return `opened ${name}`;
  },

  /** 資料（Markdown・Word・PowerPoint）の本文から文字列を探して選択する。Excel のセルは選べない */
  async select(text) {
    const r = await evaluate(`(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentElement?.closest("aside, nav, [role=dialog]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(${js(text)});
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + ${text.length});
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        n.parentElement.scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    })()`);
    if (!r) throw new Error(`本文に見つかりません（1 つのテキストノード内にある必要があります）: ${text}`);
    await sleep(300);
    return `selected ${text}`;
  },

  /** ボタンを表示文字列で押す（[ ] の飾りを除いた文字列が一致、なければ前方一致）。scope は CSS セレクタ */
  async click(label, scope = "body") {
    const r = await evaluate(`(() => {
      const bs = [...document.querySelectorAll(${js(scope)} + " button")].filter(b => !b.disabled);
      const b = bs.find(b => b.textContent.trim() === ${js(label)}) ?? bs.find(b => b.textContent.trim().startsWith(${js(label)}));
      if (!b) return null;
      b.click();
      return b.textContent.trim();
    })()`);
    if (r === null) throw new Error(`押せるボタンが見つかりません: ${label}（scope: ${scope}）`);
    await sleep(400);
    return `clicked ${r}`;
  },

  /** ノートカード（コメントに text を含むもの）のボタンを押す */
  async card(text, label) {
    const r = await evaluate(`(() => {
      const p = [...(${NOTES_PANEL})?.querySelectorAll("p") ?? []].find(p => p.textContent.includes(${js(text)}));
      if (!p) return "nocard";
      const b = [...p.parentElement.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(${js(label)}));
      if (!b) return "nobutton";
      b.click();
      return "ok";
    })()`);
    if (r !== "ok") throw new Error(r === "nocard" ? `ノートが見つかりません: ${text}` : `ボタンが見つかりません: ${label}`);
    await sleep(400);
    return `clicked ${label} on "${text}"`;
  },

  /** キーを押す。mods は ctrl,shift,alt をカンマ区切り（例: key m ctrl,shift / key Enter ctrl / key Escape） */
  async key(k, mods = "") {
    const m = mods.split(",");
    const modifiers = (m.includes("alt") ? 1 : 0) | (m.includes("ctrl") ? 2 : 0) | (m.includes("shift") ? 8 : 0);
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, Tab: 9 }[k];
    await withPage(async (send) => {
      for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, modifiers, windowsVirtualKeyCode: vk });
    });
    await sleep(400);
    return `key ${k} ${mods}`.trim();
  },

  /** フォーカス中の入力欄に文字を入れる（日本語可） */
  async type(text) {
    await withPage((send) => send("Input.insertText", { text }));
    await sleep(200);
    return "typed";
  },

  /** 画面の文字（innerText）。css を指定するとその要素だけ（入力欄・textarea は value） */
  async text(css = "body") {
    return evaluate(`(() => {
      const el = document.querySelector(${js(css)});
      if (!el) return "(なし)";
      return "value" in el && typeof el.value === "string" ? el.value : el.innerText;
    })()`);
  },

  /** ノート一覧のパネルの文字 */
  async notes() {
    return evaluate(`(${NOTES_PANEL})?.innerText ?? "(ノート一覧がありません)"`);
  },

  async eval(expression) {
    const v = await evaluate(expression);
    return typeof v === "string" ? v : JSON.stringify(v, null, 1);
  },

  /** WebView の中身のスクリーンショット（ウィンドウが隠れていても撮れる。ネイティブのダイアログは写らない） */
  async shot(out = join(WORK, "shot.png")) {
    const data = await withPage(async (send) => (await send("Page.captureScreenshot", { format: "png" })).result.data);
    writeFileSync(out, Buffer.from(data, "base64"));
    return `saved ${resolve(out)}`;
  },

  /** デスクトップ全体のスクリーンショット（保存ダイアログなどネイティブのウィンドウを確かめるとき） */
  async "desktop-shot"(out = join(WORK, "desktop.png")) {
    const p = resolve(out);
    // Windows PowerShell 5.1 は DPI 非対応で、拡大表示（125% など）だと左上の一部しか撮れないので先に宣言する
    powershell(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -Name Dpi -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][W.Dpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${p.replace(/'/g, "''")}')`);
    return `saved ${p}`;
  },

  /** タイトルでウィンドウを前面に出す（既定はアプリ本体） */
  async front(title = "document-memo-kakikomi") {
    const ok = powershell(`(New-Object -ComObject WScript.Shell).AppActivate('${title.replace(/'/g, "''")}')`);
    if (ok !== "True") throw new Error(`ウィンドウが見つかりません: ${title}`);
    await sleep(500);
    return `front ${title}`;
  },

  /** ネイティブのダイアログ（例: 議事録を保存）を前面に出してキーを送る。keys は SendKeys 形式（{ENTER} {ESC} など） */
  async dialog(title, keys = "{ENTER}") {
    const ok = powershell(`Add-Type -AssemblyName System.Windows.Forms
if ((New-Object -ComObject WScript.Shell).AppActivate('${title.replace(/'/g, "''")}')) { Start-Sleep -Milliseconds 400; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}'); 'True' } else { 'False' }`);
    if (ok !== "True") throw new Error(`ダイアログが見つかりません: ${title}`);
    await sleep(800);
    return `sent ${keys} to ${title}`;
  },

  where() {
    return `作業フォルダ: ${WORK}\nログ: ${LOG}\nデモ: ${DEMO}`;
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.error(`使い方: node driver.mjs <${Object.keys(commands).join("|")}> [引数...]`);
  process.exit(2);
}
try {
  console.log(await commands[cmd](...args));
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exitCode = 1;
}
