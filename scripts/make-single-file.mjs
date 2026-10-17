// dist/ のビルド結果（index.html + assets/*.js + assets/*.css）を 1 つの HTML にまとめる。
// 出来上がった dist/manual-builder.html はダブルクリック（file://）で開ける。Node や Web サーバーは不要。
//
//   npm run build && node scripts/make-single-file.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const OUT = join(DIST, "manual-builder.html");

function main() {
  const indexPath = join(DIST, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("dist/index.html がありません。先に npm run build を実行してください");
  }
  let html = readFileSync(indexPath, "utf8");

  // <link rel="stylesheet" href="./assets/xxx.css"> → <style>…</style>
  html = html.replace(/<link\s+rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
    const css = readFileSync(join(DIST, file), "utf8");
    return `<style>\n${css}\n</style>`;
  });

  // <script type="module" crossorigin src="./assets/xxx.js"></script> → インラインの module script
  html = html.replace(/<script\s+type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, file) => {
    let js = readFileSync(join(DIST, file), "utf8");
    // インライン化すると "</script" が出現した時点でスクリプトが閉じてしまうため、JS 文字列・正規表現として同値な形に逃がす
    js = js.replace(/<\/script/gi, "<\\/script");
    return `<script type="module">\n${js}\n</script>`;
  });

  if (/src="\.?\/?assets\//.test(html) || /href="\.?\/?assets\//.test(html)) {
    throw new Error("assets/ への参照が残っています。インライン化のパターンを見直してください");
  }
  writeFileSync(OUT, html, "utf8");
  console.log(`生成しました: ${OUT}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);
}

try {
  main();
} catch (error) {
  console.error("[make-single-file] 失敗:", error);
  process.exitCode = 1;
}
