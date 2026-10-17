// デプロイ用の成果物を output/deploy/ に作る
//   editor_<日付>.zip            … エディタ本体（dist/）だけ。任意の静的 Web サーバーに置く
//   editor-with-projects_<日付>.zip … エディタ本体 + projects/（手元の全プロジェクト）。PC 間の移行用
//
//   npm run build && node scripts/package-deploy.mjs
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PROJECTS = join(ROOT, "projects");
const OUT = join(ROOT, "output", "deploy");
const DATE = new Date().toISOString().slice(0, 10).replace(/-/g, "");

const README = `# Manual Builder（デプロイ用）

## app/
エディタ本体（静的ファイル）。ES モジュールを使うため file:// では開けません。
任意の静的 Web サーバー（社内 Web サーバー、GitHub Pages、IIS、nginx など）の
フォルダに app/ の中身を置き、HTTPS または http://localhost で開いてください。
ローカルで試すだけなら、Node.js がある PC で次のコマンドでも開けます。

    npx --yes serve app

## projects/（同梱されている場合）
マニュアルの素材フォルダ。エディタを開いたら「保存フォルダを開く」でこの projects/ を選びます。
素材は PC 上のフォルダに置くもので、Web サーバーには置きません（店舗の内部資料を含みます）。
`;

function sizeOf(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    total += statSync(full).isDirectory() ? sizeOf(full) : statSync(full).size;
  }
  return total;
}

function zip(stageDir, zipPath) {
  rmSync(zipPath, { force: true });
  // Windows 標準の PowerShell で圧縮する（追加の依存を増やさない）
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
  ]);
}

function main() {
  if (!existsSync(DIST)) {
    throw new Error("dist/ がありません。先に npm run build を実行してください");
  }
  mkdirSync(OUT, { recursive: true });

  const stage1 = join(OUT, "_stage-editor");
  rmSync(stage1, { recursive: true, force: true });
  mkdirSync(join(stage1, "app"), { recursive: true });
  cpSync(DIST, join(stage1, "app"), { recursive: true });
  writeFileSync(join(stage1, "README.md"), README, "utf8");
  const zip1 = join(OUT, `editor_${DATE}.zip`);
  zip(stage1, zip1);
  rmSync(stage1, { recursive: true, force: true });

  const stage2 = join(OUT, "_stage-with-projects");
  rmSync(stage2, { recursive: true, force: true });
  mkdirSync(join(stage2, "app"), { recursive: true });
  cpSync(DIST, join(stage2, "app"), { recursive: true });
  cpSync(PROJECTS, join(stage2, "projects"), { recursive: true });
  writeFileSync(join(stage2, "README.md"), README, "utf8");
  const zip2 = join(OUT, `editor-with-projects_${DATE}.zip`);
  zip(stage2, zip2);
  rmSync(stage2, { recursive: true, force: true });

  for (const z of [zip1, zip2]) {
    console.log(`${z}  (${(statSync(z).size / 1024).toFixed(0)} KB)`);
  }
  console.log(`projects/ の合計: ${(sizeOf(PROJECTS) / 1024).toFixed(0)} KB`);
}

try {
  main();
} catch (error) {
  console.error("[package-deploy] 失敗:", error);
  process.exitCode = 1;
}
