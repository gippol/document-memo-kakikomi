import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_VERSION } from "./appInfo";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
/** Cargo.toml の [package] の version（最初に出てくるもの） */
const cargoVersion = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];

describe("アプリの名前と版の表記", () => {
  it("版は package.json・Cargo.toml・tauri.conf.json でそろえる", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(cargoVersion).toBe(APP_VERSION);
    expect(tauriConf.version).toBe(APP_VERSION);
  });
  it("インストーラー・ウィンドウ・HTML の名前は「資料メモ かきこみ」", () => {
    expect(tauriConf.productName).toBe(APP_NAME);
    expect(tauriConf.app.windows.map((w: { title: string }) => w.title)).toEqual([APP_NAME]);
    expect(read("index.html")).toContain(`<title>${APP_NAME}</title>`);
  });
  it("実行ファイル名と識別子は英数字のまま（変えるとアプリのデータの置き場所やドライバが変わる）", () => {
    expect(tauriConf.mainBinaryName).toBe("document-memo-kakikomi");
    expect(tauriConf.identifier).toBe("com.shiryomemo.app");
  });
});
