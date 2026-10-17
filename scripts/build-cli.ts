// CLI: プロジェクトの manual.json（manifest）から、ブラウザ版と同じ core でマニュアル HTML を生成する
//
//   npm run build:cli                                  # scripts → .cli/build-cli.js にバンドル
//   node .cli/build-cli.js <manual.json> [出力.html]     # 出力省略時は <プロジェクト>/output/<title>_<YYYYMMDD>.html
//
// manifest の形式は src/core/project.ts と README.md「CLI で生成する」を参照。
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { buildManualHtml } from "../src/core/export";
import { assembleManual, imageMimeType, isManifest, PROJECT_LAYOUT, type ProjectFiles } from "../src/core/project";
import { stripBom } from "../src/core/markdown";
import manualCss from "../src/styles/manual.css?raw";

function installDomGlobals(): void {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  const w = dom.window as unknown as Record<string, unknown>;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: w.DOMParser,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
  });
}

/** fs ベースの ProjectFiles。パスは manifest のあるフォルダからの相対 */
function fsFiles(baseDir: string): ProjectFiles {
  const walk = (dir: string, out: string[]): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, out);
      } else {
        out.push(relative(baseDir, full).split("\\").join("/"));
      }
    }
  };
  return {
    async readText(path) {
      return stripBom(readFileSync(resolve(baseDir, path), "utf8"));
    },
    async readDataUri(path) {
      const mime = imageMimeType(path) ?? "application/octet-stream";
      return `data:${mime};base64,${readFileSync(resolve(baseDir, path)).toString("base64")}`;
    },
    async list(dir) {
      const out: string[] = [];
      walk(resolve(baseDir, dir), out);
      return out;
    },
  };
}

async function main(): Promise<void> {
  const [manifestPath, outArg] = process.argv.slice(2);
  if (!manifestPath) {
    console.error("使い方: node .cli/build-cli.js <manual.json> [出力.html]");
    process.exitCode = 2;
    return;
  }
  try {
    installDomGlobals();
    const baseDir = dirname(resolve(manifestPath));
    const manifest: unknown = JSON.parse(stripBom(readFileSync(resolve(manifestPath), "utf8")));
    if (!isManifest(manifest)) {
      throw new Error(`${manifestPath}: manifest（title + chapters）ではありません`);
    }
    const { manual, warnings: loadWarnings } = await assembleManual(manifest, fsFiles(baseDir));
    const { html, warnings } = buildManualHtml(manual, { css: manualCss });
    const outPath = outArg
      ? resolve(outArg)
      : join(baseDir, PROJECT_LAYOUT.output, `${manual.title}_${manual.revisedOn.replace(/-/g, "")}.html`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf8");
    [...loadWarnings, ...warnings].forEach((w) => console.warn(`[warn] ${w}`));
    console.log(`生成しました: ${outPath}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB、警告 ${loadWarnings.length + warnings.length} 件）`);
  } catch (error) {
    console.error("[build-cli] 生成に失敗しました:", error);
    process.exitCode = 1;
  }
}

void main();
