import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * pdf.js が実行時に読む補助データを /pdfjs/ に置く（開発時はそのまま配り、ビルド時は dist/pdfjs/ にコピーする）。
 * - cmaps: 日本語など、フォントを埋め込んでいない PDF の文字の対応表
 * - wasm: JBIG2・JPEG 2000 の画像、ICC プロファイルの処理（PDF 内のスクリプト用の quickjs は使わないので除く）
 * - iccs: CMYK の既定の ICC プロファイル
 * 埋め込みの無い標準フォント（standard_fonts）は同梱せず OS のフォントで代用する。
 * 同梱するデータのライセンスは THIRD_PARTY_LICENSES.md（scripts/make-third-party-licenses.mjs で作る）に載せる。
 */
const PDFJS_DIR = path.resolve(import.meta.dirname, "node_modules/pdfjs-dist");
const PDFJS_ASSET_DIRS = ["cmaps", "wasm", "iccs"];
const isPdfjsAsset = (rel: string) => !/quickjs/i.test(rel);

function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs/", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const [dir] = rel.split("/");
        const file = path.resolve(PDFJS_DIR, rel);
        if (!PDFJS_ASSET_DIRS.includes(dir) || !isPdfjsAsset(rel) || !file.startsWith(PDFJS_DIR + path.sep) || !fs.existsSync(file)) {
          return next();
        }
        if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        else if (file.endsWith(".js")) res.setHeader("Content-Type", "text/javascript");
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const out = path.resolve(options.dir ?? "dist", "pdfjs");
      for (const dir of PDFJS_ASSET_DIRS) {
        fs.cpSync(path.join(PDFJS_DIR, dir), path.join(out, dir), {
          recursive: true,
          filter: (src) => isPdfjsAsset(path.relative(PDFJS_DIR, src).replaceAll("\\", "/")),
        });
      }
      // アプリに同梱するライブラリのライセンス表示
      fs.copyFileSync(path.resolve(import.meta.dirname, "THIRD_PARTY_LICENSES.md"), path.resolve(options.dir ?? "dist", "THIRD_PARTY_LICENSES.md"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
