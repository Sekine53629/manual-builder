// ヘッドレス Chrome（DevTools Protocol）でアプリを実際に操作するスモークテスト。
// File System Access API はユーザー操作が必要なので、projects/sample の内容をメモリ上の偽フォルダに載せ替えて使う。
//
//   npm run build && npx vite preview --port 4173   （別ターミナル）
//   node scripts/e2e-smoke.mjs [http://localhost:4173/]
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const APP_URL = process.argv[2] ?? "http://localhost:4173/";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEBUG_PORT = 9333;
const PROJECT_DIR = resolve("projects/sample");

// ---- projects/sample をスナップショットにする --------------------------------------
function snapshot(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const rel = relative(dir, full).split("\\").join("/");
        const isText = /\.(md|json|txt|svg|html|gitkeep)$/i.test(name);
        files[rel] = isText ? { text: readFileSync(full, "utf8") } : { base64: readFileSync(full).toString("base64") };
      }
    }
  };
  walk(dir);
  return files;
}

// ---- CDP の最小クライアント -----------------------------------------------------------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
    }
    return result.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cdp, expression, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    const value = await cdp.eval(expression);
    if (value) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout: ${expression}`);
    }
    await sleep(150);
  }
}

// ---- ページに注入する偽の File System Access API ------------------------------------------
const FAKE_FS = String.raw`
(() => {
  class FakeWritable { constructor(file) { this.file = file; this.chunks = []; }
    async write(data) { this.chunks.push(data); } async close() {
      const parts = []; for (const c of this.chunks) parts.push(c instanceof Blob ? c : new Blob([c]));
      this.file.blob = new Blob(parts, { type: this.file.blob.type }); this.file.mtime = Date.now(); } }
  class FakeFile { constructor(name, blob) { this.kind = "file"; this.name = name; this.blob = blob; }
    async getFile() { return new File([this.blob], this.name, { type: this.blob.type }); }
    async createWritable() { return new FakeWritable(this); }
    async queryPermission() { return "granted"; } async requestPermission() { return "granted"; } }
  class FakeDir { constructor(name) { this.kind = "directory"; this.name = name; this.children = new Map(); }
    async getDirectoryHandle(name, opts) { let c = this.children.get(name);
      if (!c) { if (!opts || !opts.create) throw new DOMException("not found", "NotFoundError"); c = new FakeDir(name); this.children.set(name, c); }
      if (c.kind !== "directory") throw new DOMException("not a directory", "TypeMismatchError"); return c; }
    async getFileHandle(name, opts) { let c = this.children.get(name);
      if (!c) { if (!opts || !opts.create) throw new DOMException("not found", "NotFoundError"); c = new FakeFile(name, new Blob([])); this.children.set(name, c); }
      if (c.kind !== "file") throw new DOMException("not a file", "TypeMismatchError"); return c; }
    async *entries() { for (const [k, v] of this.children) yield [k, v]; }
    async queryPermission() { return "granted"; } async requestPermission() { return "granted"; } }
  function mime(name) { const ext = name.split(".").pop().toLowerCase();
    return ({ png: "image/png", svg: "image/svg+xml", json: "application/json", md: "text/markdown", txt: "text/plain", html: "text/html" })[ext] || ""; }
  const root = new FakeDir("projects");
  const sample = new FakeDir("sample"); root.children.set("sample", sample);
  for (const [path, content] of Object.entries(window.__SNAPSHOT__)) {
    const parts = path.split("/"); const file = parts.pop(); let dir = sample;
    for (const p of parts) { let d = dir.children.get(p); if (!d) { d = new FakeDir(p); dir.children.set(p, d); } dir = d; }
    const blob = content.text !== undefined ? new Blob([content.text], { type: mime(file) })
      : new Blob([Uint8Array.from(atob(content.base64), (ch) => ch.charCodeAt(0))], { type: mime(file) });
    dir.children.set(file, new FakeFile(file, blob));
  }
  window.__FAKE_ROOT__ = root;
  window.showDirectoryPicker = async () => root;
  return "ok";
})()`;

async function readFakeText(cdp, path) {
  return cdp.eval(`(async () => { const parts = ${JSON.stringify(path)}.split("/"); let d = window.__FAKE_ROOT__.children.get("sample");
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    const f = await d.getFileHandle(parts[parts.length - 1]); return await (await f.getFile()).text(); })()`);
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), "mb-e2e-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`, "--window-size=1500,900", APP_URL,
  ], { stdio: "ignore" });
  const results = [];
  const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK " : "NG "} ${name}${detail ? ` — ${detail}` : ""}`); };
  try {
    let targets = [];
    for (let i = 0; i < 40 && targets.length === 0; i++) {
      await sleep(250);
      try { targets = (await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json()).filter((t) => t.type === "page"); } catch { /* 起動待ち */ }
    }
    if (targets.length === 0) throw new Error("Chrome に接続できません");
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    const consoleErrors = [];
    ws.addEventListener("message", (event) => { const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description ?? ""));
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" ")); });

    // 静的 HTML は先に届くので、アプリのスクリプト（window.manualBuilder）が動き出すまで待つ
    await waitFor(cdp, `document.querySelector("#welcome") !== null && typeof window.manualBuilder === "object"`, 30000);
    check("ようこそ画面が表示される", await cdp.eval(`!document.querySelector("#welcome").hidden`));

    // 偽フォルダを注入して「保存フォルダを開く」
    await cdp.eval(`window.__SNAPSHOT__ = ${JSON.stringify(snapshot(PROJECT_DIR))}; "ok"`);
    await cdp.eval(FAKE_FS);
    await cdp.eval(`document.querySelector("#welcome-open-button").click(); "ok"`);
    await waitFor(cdp, `!document.querySelector("#editor").hidden && document.querySelectorAll("#chapter-list li:not(.cover-row)").length === 5`);
    check("sample プロジェクトが開き、章が 5 つ並ぶ（先頭に表紙行）", await cdp.eval(`document.querySelector("#chapter-list li.cover-row") !== null`));
    check("プロジェクト名が選択されている", (await cdp.eval(`document.querySelector("#project-select").value`)) === "sample");
    const labels = await cdp.eval(`Array.from(document.querySelectorAll("#chapter-list .group-label")).map((e) => e.textContent)`);
    check("グループに第N章が自動採番される", JSON.stringify(labels) === JSON.stringify(["第1章", "第1章", "第2章", "第2章", "第2章"]), JSON.stringify(labels));

    // 2 章目（Markdown）を選んで 3 ペインを確認
    await cdp.eval(`document.querySelectorAll("#chapter-list li:not(.cover-row) .title-button")[1].click(); "ok"`);
    await waitFor(cdp, `document.querySelector("#current-file").textContent.includes("01-introduction.md")`);
    const sourceText = await cdp.eval(`document.querySelector("#source-editor .cm-content").textContent`);
    check("ソースペインに Markdown が表示される", sourceText.includes("# はじめに"), sourceText.slice(0, 40));
    await cdp.eval(`document.querySelector("#view-html-button").click(); "ok"`);
    await sleep(200);
    const htmlText = await cdp.eval(`document.querySelector("#html-editor .cm-content").textContent`);
    check("HTML タブに切り替えると生成 HTML（data-line 付き）が表示される", htmlText.includes('data-line="') && htmlText.includes("<h2") && (await cdp.eval(`document.querySelector("#source-pane").hidden`)));
    await cdp.eval(`document.querySelector("#view-source-button").click(); "ok"`);
    await sleep(200);
    check("Markdown タブに戻せる", await cdp.eval(`!document.querySelector("#source-pane").hidden && document.querySelector("#html-pane").hidden`));
    await waitFor(cdp, `(() => { const d = document.querySelector("#preview").contentDocument; return d && d.querySelector("h2[data-line]") !== null; })()`);
    check("プレビューに章が描画され、章バッジが付く", await cdp.eval(`document.querySelector("#preview").contentDocument.querySelector(".badge")?.textContent === "第1章 基本"`));

    // 編集 → 自動保存 → プレビュー更新
    await cdp.eval(`window.manualBuilder.appendSource("\\n\\n## 追記した見出し\\n\\n追記本文\\n"); "ok"`);
    await waitFor(cdp, `document.querySelector("#preview").contentDocument.body.innerHTML.includes("追記した見出し")`, 5000);
    check("編集がプレビューに反映される（iframe を再読込せず差し替え）", await cdp.eval(`document.querySelector("#preview").contentDocument.body.hasAttribute("data-mb-preview")`));
    await waitFor(cdp, `document.querySelector("#save-status").textContent === "保存済み"`, 5000);
    const saved = await readFakeText(cdp, "chapters/01-introduction.md");
    check("編集がファイルに自動保存される", saved.includes("追記した見出し"));

    // スクロール同期（ソース → プレビュー）
    await cdp.eval(`window.manualBuilder.scrollSourceToEnd(); "ok"`);
    await sleep(300);
    const previewY = await cdp.eval(`document.querySelector("#preview").contentWindow.scrollY`);
    check("ソースのスクロールにプレビューが追従する", previewY > 0, `scrollY=${previewY}`);

    // 章の挿入（2 章目「はじめに」の直後。各行のボタンは ＋ ↑ ↓ × の 4 つ）→ 番号の振り直し
    await cdp.eval(`document.querySelectorAll("#chapter-list li:not(.cover-row) .row-main .icon-button")[4].click(); "ok"`);
    await waitFor(cdp, `document.querySelector("#insert-dialog").open`);
    await cdp.eval(`(() => { document.querySelector("#insert-file").value = "99-inserted.md"; document.querySelector("#insert-title").value = "挿入した章";
      document.querySelector("#insert-group").value = "新しいグループ"; document.querySelector("#insert-dialog form").requestSubmit(); return "ok"; })()`);
    await waitFor(cdp, `document.querySelectorAll("#chapter-list li:not(.cover-row)").length === 6`);
    const labels2 = await cdp.eval(`Array.from(document.querySelectorAll("#chapter-list .group-label")).map((e) => e.textContent)`);
    check("挿入した章が新しいグループになり、後続の章番号が振り直される", JSON.stringify(labels2) === JSON.stringify(["第1章", "第1章", "第2章", "第3章", "第3章", "第3章"]), JSON.stringify(labels2));
    const inserted = await readFakeText(cdp, "chapters/99-inserted.md");
    check("挿入した章のファイルがひな形付きで作られる", inserted.includes("title: 挿入した章"));
    await waitFor(cdp, `document.querySelector("#save-status").textContent === "保存済み"`, 5000);
    const manifest = JSON.parse(await readFakeText(cdp, "manual.json"));
    check("manual.json に章の並びが保存される", manifest.chapters[2]?.file === "chapters/99-inserted.md" && manifest.chapters[2]?.group === "新しいグループ");

    // 手順 JSON の章: data-step と同期用の対応
    const stepsIndex = manifest.chapters.findIndex((c) => c.file.endsWith("steps-register.json"));
    await cdp.eval(`document.querySelectorAll("#chapter-list li:not(.cover-row) .title-button")[${stepsIndex}].click(); "ok"`);
    await waitFor(cdp, `document.querySelector("#current-file").textContent.includes("steps-register.json")`);
    await cdp.eval(`document.querySelector("#view-html-button").click(); "ok"`);
    await waitFor(cdp, `document.querySelector("#html-editor .cm-content").textContent.includes('data-step="1"')`);
    check("手順 JSON の章は JSON がソースに出て、HTML に data-step が付く", await cdp.eval(`document.querySelector("#source-kind").textContent === "手順 JSON"`));
    await cdp.eval(`document.querySelector("#view-source-button").click(); "ok"`);

    // 書き出し
    await cdp.eval(`document.querySelector("#export-button").click(); "ok"`);
    await waitFor(cdp, `document.querySelector("#message-list").textContent.includes("書き出しました")`, 8000);
    const outName = await cdp.eval(`(async () => { const out = await window.__FAKE_ROOT__.children.get("sample").getDirectoryHandle("output"); const names = []; for await (const [n] of out.entries()) names.push(n); return names.join(","); })()`);
    check("output/ に HTML が書き出される", /\.html/.test(outName), outName);
    const exported = await readFakeText(cdp, `output/${outName.split(",").find((n) => n.endsWith(".html"))}`);
    check("書き出した HTML には data-line が含まれない", !exported.includes("data-line") && exported.includes("第3章"));

    // 図の配置: 02-operation.md の flow.svg をドラッグして Markdown に {mt=…} が書かれるか
    {
      const opIndex = manifest.chapters.findIndex((c) => c.file.endsWith("02-operation.md"));
      await cdp.eval(`document.querySelectorAll("#chapter-list li:not(.cover-row) .title-button")[${opIndex}].click(); "ok"`);
      await waitFor(cdp, `document.querySelector("#preview").contentDocument.querySelector('figure[data-fig="flow.svg"]') !== null`);
      check("素材一覧に images/ の素材が並ぶ", (await cdp.eval(`document.querySelectorAll("#asset-list li").length`)) >= 3);
      const fig = await cdp.eval(`(() => { const f = document.querySelector("#preview").getBoundingClientRect(); const el = document.querySelector("#preview").contentDocument.querySelector('figure[data-fig="flow.svg"]'); const r = el.getBoundingClientRect(); return { x: f.left + r.left + r.width / 2, y: f.top + r.top + 10 }; })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fig.x, y: fig.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: fig.x, y: fig.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 5; i++) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fig.x, y: fig.y + i * 10, button: "left" });
      }
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: fig.x, y: fig.y + 50, button: "left" });
      await waitFor(cdp, `window.manualBuilder.sourceText().includes("flow.svg){mt=")`, 5000);
      const src = await cdp.eval(`window.manualBuilder.sourceText()`);
      check("図を下へドラッグすると原稿の画像記法に上余白 {mt=…} が書かれる", /flow\.svg\)\{mt=\d+(\.5)?\}/.test(src), src.match(/flow\.svg\)\{[^}]*\}/)?.[0]);
      await waitFor(cdp, `document.querySelector("#preview").contentDocument.querySelector('figure[data-fig="flow.svg"].mb-selected .mb-fig-toolbar') !== null`, 5000);
      check("選択した図に配置ツールバーが出る", true);
      const shotFig = await cdp.send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync: wf2 } = await import("node:fs");
      wf2("output/e2e-figure.png", Buffer.from(shotFig.data, "base64"));
      // 素材のドロップ: プレビューの先頭付近に落とすと画像記法が挿入される
      const top = await cdp.eval(`(() => { const f = document.querySelector("#preview").getBoundingClientRect(); const h2 = document.querySelector("#preview").contentDocument.querySelector("h2[data-line]"); const r = h2.getBoundingClientRect(); return { x: r.left + 10, y: r.top + 2 }; })()`);
      await cdp.eval(`window.manualBuilder.dropAsset("m_sample_F1.png", ${top.x}, ${top.y}); "ok"`);
      await waitFor(cdp, `window.manualBuilder.sourceText().includes("![m_sample_F1](m_sample_F1.png)")`, 5000);
      await waitFor(cdp, `document.querySelector("#preview").contentDocument.querySelector('figure[data-fig="m_sample_f1.png"]') !== null`, 5000);
      check("素材をプレビューに落とすと、その位置の直前に画像記法が挿入され、プレビューに出る", true);
      // 書式ツールバー: 見出しの文字を選んで下線と文字色を付ける
      const srcNow = await cdp.eval(`window.manualBuilder.sourceText()`);
      const idx = srcNow.indexOf("全体の流れ");
      await cdp.eval(`window.manualBuilder.selectRange(${idx}, ${idx + 5}); window.manualBuilder.applyFormat("underline"); "ok"`);
      await cdp.eval(`document.querySelector("#fmt-color").value = "#2b6cb0"; window.manualBuilder.applyFormat("color"); "ok"`);
      await waitFor(cdp, `window.manualBuilder.sourceText().includes('<u><span style="color:#2b6cb0">全体の流れ</span></u>')`, 3000);
      await waitFor(cdp, `document.querySelector("#preview").contentDocument.body.innerHTML.includes('<u><span style="color:#2b6cb0">全体の流れ</span></u>')`, 5000);
      check("書式ツールバーの下線・文字色が原稿とプレビューに反映される", !(await cdp.eval(`document.querySelector("#format-toolbar").hidden`)));
    }

    // 表紙デザイン: 表紙行を選び、プレビューの要素をドラッグして cover.json に位置が保存されるか
    await cdp.eval(`window.manualBuilder.selectCover(); "ok"`);
    await waitFor(cdp, `document.querySelector("#source-kind").textContent === "表紙デザイン" && document.querySelector("#preview").contentDocument.querySelector('[data-el="title"]') !== null`);
    check("表紙行を選ぶと cover.json のひな形とドラッグ可能な表紙が出る", await cdp.eval(`window.manualBuilder.sourceText().includes('"elements"')`));
    const box = await cdp.eval(`(() => { const f = document.querySelector("#preview").getBoundingClientRect(); const el = document.querySelector("#preview").contentDocument.querySelector('[data-el="title"]'); const r = el.getBoundingClientRect(); return { x: f.left + r.left + 20, y: f.top + r.top + 10 }; })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 5; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + i * 12, y: box.y + i * 8, button: "left" });
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 60, y: box.y + 40, button: "left" });
    await waitFor(cdp, `document.querySelector("#save-status").textContent === "保存済み" && window.manualBuilder.sourceText().includes('"id": "title"')`, 5000);
    const coverJson = JSON.parse(await readFakeText(cdp, "cover.json"));
    const title = coverJson.elements.find((e) => e.id === "title");
    check("ドラッグした位置が cover.json に保存される", title && title.x > 25 && title.y > 58, `x=${title?.x} y=${title?.y}`);
    await cdp.eval(`document.querySelector("#export-button").click(); "ok"`);
    await sleep(800);
    const exported2 = await readFakeText(cdp, `output/${outName.split(",").find((n) => n.endsWith(".html"))}`);
    {
      const shotCover = await cdp.send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync: wf } = await import("node:fs");
      wf("output/e2e-cover.png", Buffer.from(shotCover.data, "base64"));
    }
    check("書き出した統合版にカスタム表紙が使われ、編集用属性は含まれない", exported2.includes('class="cover cover-page"') && exported2.includes(`left:${title.x}mm`) && !exported2.includes("data-el"));

    check("コンソールにエラーが無い", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    // 目視確認用に画面を保存する
    await cdp.eval(`document.querySelectorAll("#chapter-list li:not(.cover-row) .title-button")[1].click(); "ok"`);
    await sleep(600);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("output", { recursive: true });
    writeFileSync("output/e2e-editor.png", Buffer.from(shot.data, "base64"));
    console.log("screenshot: output/e2e-editor.png");
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* 片付け失敗は無視 */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("[e2e-smoke] 失敗:", error);
  process.exitCode = 1;
});
