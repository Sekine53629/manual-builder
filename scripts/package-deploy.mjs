// デプロイ用の成果物を output/deploy/ に作る
//   editor_<日付>.zip            … エディタ本体（dist/）だけ。任意の静的 Web サーバーに置く
//   editor-standalone_<日付>.zip  … 単一ファイル版（manual-builder.html）。ダブルクリックで開ける。Node・サーバー不要
//   editor-with-projects_<日付>.zip … エディタ本体 + projects/（手元の全プロジェクト）。PC 間の移行用
//
//   npm run build && node scripts/package-deploy.mjs
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PROJECTS = join(ROOT, "projects");
const OUT = join(ROOT, "output", "deploy");
// ローカル日付（UTC だと日本時間の夜に前日になってしまう）
const DATE = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");

const README = `# Manual Builder（デプロイ用）

## 開き方（単一ファイル版）: start-local.cmd をダブルクリック
Windows 標準の PowerShell で小さなローカルサーバー（http://localhost:8790/）を起動し、ブラウザで開きます。
インストール・Node・外部サーバーは不要です。黒いウィンドウは開いたままにしてください（閉じるとサーバーが止まります）。
初回に「保存フォルダを開く」で projects/ を選ぶと、次回からは「前回のフォルダに再接続」で続きができます。

注意: manual-builder.html を直接ダブルクリック（file://）で開くと、閲覧と読み込みはできますが
**ファイルの保存がブラウザのセキュリティポリシーで拒否されます**（「Aborted due to security policy」）。
編集・書き出しをするときは必ず start-local.cmd から開いてください。

## app/（公開サイト版）
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

  const single = join(DIST, "manual-builder.html");
  if (!existsSync(single)) {
    throw new Error("dist/manual-builder.html がありません。先に npm run build:single を実行してください");
  }
  const launcher = [join(ROOT, "scripts", "serve-local.ps1"), join(ROOT, "scripts", "start-local.cmd")];
  const stage0 = join(OUT, "_stage-standalone");
  rmSync(stage0, { recursive: true, force: true });
  mkdirSync(stage0, { recursive: true });
  cpSync(single, join(stage0, "manual-builder.html"));
  for (const f of launcher) {
    cpSync(f, join(stage0, basename(f)));
  }
  writeFileSync(join(stage0, "README.md"), README, "utf8");
  const zip0 = join(OUT, `editor-standalone_${DATE}.zip`);
  zip(stage0, zip0);
  rmSync(stage0, { recursive: true, force: true });

  const stage1 = join(OUT, "_stage-editor");
  rmSync(stage1, { recursive: true, force: true });
  mkdirSync(join(stage1, "app"), { recursive: true });
  cpSync(DIST, join(stage1, "app"), { recursive: true });
  for (const f of launcher) {
    cpSync(f, join(stage1, basename(f)));
  }
  writeFileSync(join(stage1, "README.md"), README, "utf8");
  const zip1 = join(OUT, `editor_${DATE}.zip`);
  zip(stage1, zip1);
  rmSync(stage1, { recursive: true, force: true });

  const stage2 = join(OUT, "_stage-with-projects");
  rmSync(stage2, { recursive: true, force: true });
  mkdirSync(join(stage2, "app"), { recursive: true });
  cpSync(DIST, join(stage2, "app"), { recursive: true });
  cpSync(single, join(stage2, "manual-builder.html"));
  for (const f of launcher) {
    cpSync(f, join(stage2, basename(f)));
  }
  cpSync(PROJECTS, join(stage2, "projects"), { recursive: true });
  writeFileSync(join(stage2, "README.md"), README, "utf8");
  const zip2 = join(OUT, `editor-with-projects_${DATE}.zip`);
  zip(stage2, zip2);
  rmSync(stage2, { recursive: true, force: true });

  for (const z of [zip0, zip1, zip2]) {
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
