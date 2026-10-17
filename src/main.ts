// アプリ本体：保存フォルダのプロジェクトを開き、3 ペイン（ソース・HTML・プレビュー）で編集・書き出す
import {
  PROJECT_LAYOUT,
  assembleManual,
  computeGroupLabels,
  markdownTemplate,
  stepsTemplate,
  type AssembleResult,
  type Manifest,
  type ManifestChapter,
} from "./core/project";
import { chapterTitle, isStepsData, type Chapter } from "./core/types";
import { isMenuCatalog } from "./core/catalog";
import { buildChapterHtml, buildCoverHtml, buildManualHtml } from "./core/export";
import { COVER_PAGE, coverTemplate, defaultCoverDesign, isCoverDesign, newCoverElement, type CoverDesign, type CoverElement, type CoverElementType } from "./core/cover";
import { stripBom } from "./core/markdown";
import { ASSET_DRAG_TYPE, PaneEditor, type EditorLanguage } from "./editor-panes";
import { parseFigureAttrs, rewriteImageAttrs, type FigureLayout } from "./core/figure-layout";
import { ScrollSync, type SyncAnchor } from "./scroll-sync";
import {
  ProjectDir,
  createProject,
  ensurePermission,
  listProjects,
  loadSavedRoot,
  pickRootDirectory,
  supportsFileSystemAccess,
} from "./project-store";
import manualCss from "./styles/manual.css?raw";

const MAX_MESSAGES = 40;
const SAVE_DELAY_MS = 600;
const RENDER_DELAY_MS = 250;
const LAST_PROJECT_KEY = "manual-builder.lastProject";
const MARKDOWN_EXTENSIONS = [".md", ".markdown"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
const TREE_MARKERS = ["├─", "└─"];
/** HTML 表示では data URI を省略して読みやすくする */
const DATA_URI_PATTERN = /(data:image\/[a-z+]+;base64,)[A-Za-z0-9+/=]{40,}/g;

// ---- 状態 -----------------------------------------------------------------

let root: FileSystemDirectoryHandle | undefined;
let project: ProjectDir | undefined;
let manifest: Manifest | undefined;
let assembled: AssembleResult | undefined;
let currentIndex = -1;
/** true: 章ではなく表紙デザインを編集中 */
let coverSelected = false;
/** 編集中で未保存のファイル */
const pendingWrites = new Map<string, string>();
let manifestDirty = false;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`要素が見つかりません: #${id}`);
  }
  return el as T;
}

const ui = {
  openRoot: byId<HTMLButtonElement>("open-root-button"),
  rootName: byId<HTMLElement>("root-name"),
  projectSelect: byId<HTMLSelectElement>("project-select"),
  newProject: byId<HTMLButtonElement>("new-project-button"),
  reload: byId<HTMLButtonElement>("reload-button"),
  saveStatus: byId<HTMLElement>("save-status"),
  printButton: byId<HTMLButtonElement>("print-button"),
  exportButton: byId<HTMLButtonElement>("export-button"),
  metaSection: byId<HTMLDetailsElement>("meta-section"),
  title: byId<HTMLInputElement>("manual-title"),
  subtitle: byId<HTMLInputElement>("manual-subtitle"),
  author: byId<HTMLInputElement>("manual-author"),
  version: byId<HTMLInputElement>("manual-version"),
  date: byId<HTMLInputElement>("manual-date"),
  notes: byId<HTMLTextAreaElement>("manual-notes"),
  book: byId<HTMLInputElement>("manual-book"),
  autoNumber: byId<HTMLInputElement>("manual-autonumber"),
  chapterList: byId<HTMLOListElement>("chapter-list"),
  chapterCount: byId<HTMLElement>("chapter-count"),
  groupOptions: byId<HTMLDataListElement>("group-options"),
  appendChapter: byId<HTMLButtonElement>("append-chapter-button"),
  unusedFiles: byId<HTMLElement>("unused-files"),
  dropZone: byId<HTMLDivElement>("drop-zone"),
  fileInput: byId<HTMLInputElement>("file-input"),
  assetCount: byId<HTMLElement>("asset-count"),
  assetList: byId<HTMLUListElement>("asset-list"),
  catalogStatus: byId<HTMLElement>("catalog-status"),
  messageList: byId<HTMLUListElement>("message-list"),
  welcome: byId<HTMLElement>("welcome"),
  welcomeUnsupported: byId<HTMLElement>("welcome-unsupported"),
  welcomeOpen: byId<HTMLButtonElement>("welcome-open-button"),
  welcomeReconnect: byId<HTMLButtonElement>("welcome-reconnect-button"),
  editor: byId<HTMLElement>("editor"),
  viewSourceButton: byId<HTMLButtonElement>("view-source-button"),
  viewHtmlButton: byId<HTMLButtonElement>("view-html-button"),
  togglePreview: byId<HTMLInputElement>("toggle-preview"),
  previewMode: byId<HTMLSelectElement>("preview-mode"),
  syncToggle: byId<HTMLInputElement>("sync-toggle"),
  currentFile: byId<HTMLElement>("current-file"),
  sourcePane: byId<HTMLElement>("source-pane"),
  htmlPane: byId<HTMLElement>("html-pane"),
  previewPane: byId<HTMLElement>("preview-pane"),
  sourceKind: byId<HTMLElement>("source-kind"),
  formatToolbar: byId<HTMLElement>("format-toolbar"),
  fmtColor: byId<HTMLInputElement>("fmt-color"),
  fmtBg: byId<HTMLInputElement>("fmt-bg"),
  fmtFont: byId<HTMLSelectElement>("fmt-font"),
  fmtSize: byId<HTMLSelectElement>("fmt-size"),
  sourceEditorHost: byId<HTMLElement>("source-editor"),
  htmlEditorHost: byId<HTMLElement>("html-editor"),
  preview: byId<HTMLIFrameElement>("preview"),
  printFrame: byId<HTMLIFrameElement>("print-frame"),
  insertDialog: byId<HTMLDialogElement>("insert-dialog"),
  insertKind: byId<HTMLSelectElement>("insert-kind"),
  insertFileField: byId<HTMLElement>("insert-file-field"),
  insertFile: byId<HTMLInputElement>("insert-file"),
  insertExistingField: byId<HTMLElement>("insert-existing-field"),
  insertExisting: byId<HTMLSelectElement>("insert-existing"),
  insertTitle: byId<HTMLInputElement>("insert-title"),
  insertGroup: byId<HTMLInputElement>("insert-group"),
  insertCancel: byId<HTMLButtonElement>("insert-cancel"),
  coverDialog: byId<HTMLDialogElement>("cover-dialog"),
  coverElType: byId<HTMLSelectElement>("cover-el-type"),
  coverElImageField: byId<HTMLElement>("cover-el-image-field"),
  coverElImage: byId<HTMLSelectElement>("cover-el-image"),
  coverElTextField: byId<HTMLElement>("cover-el-text-field"),
  coverElText: byId<HTMLInputElement>("cover-el-text"),
  coverCancel: byId<HTMLButtonElement>("cover-cancel"),
  projectDialog: byId<HTMLDialogElement>("project-dialog"),
  projectFolder: byId<HTMLInputElement>("project-folder"),
  projectTitle: byId<HTMLInputElement>("project-title"),
  projectCancel: byId<HTMLButtonElement>("project-cancel"),
};

// ---- メッセージ・状態表示 ---------------------------------------------------

function logMessage(text: string, kind: "info" | "warn" | "error" = "info"): void {
  const item = document.createElement("li");
  item.className = `message-${kind}`;
  item.textContent = `${new Date().toLocaleTimeString("ja-JP")} ${text}`;
  ui.messageList.prepend(item);
  while (ui.messageList.children.length > MAX_MESSAGES) {
    ui.messageList.lastElementChild?.remove();
  }
  if (kind === "error") {
    console.error(`[app] ${text}`);
  } else if (kind === "warn") {
    console.warn(`[app] ${text}`);
  }
}

function updateSaveStatus(): void {
  const dirty = pendingWrites.size > 0 || manifestDirty;
  ui.saveStatus.textContent = project ? (dirty ? "保存中…" : "保存済み") : "";
  ui.saveStatus.classList.toggle("dirty", dirty);
}

let lastWarnings = "";
function reportWarnings(warnings: string[]): void {
  const joined = warnings.join("\n");
  if (joined !== lastWarnings) {
    warnings.forEach((w) => logMessage(w, "warn"));
    lastWarnings = joined;
  }
}

// ---- エディタ（3 ペイン） -------------------------------------------------------

const sourceEditor = new PaneEditor(ui.sourceEditorHost, {
  language: "markdown",
  onChange: (text) => onSourceChanged(text),
  onScroll: () => sync.fromSource(),
  assetDropText: (name) => assetInsertText(name),
});

/** 素材をソースに差し込むときの文字列（Markdown は画像記法、JSON は文字列） */
function assetInsertText(name: string): string | undefined {
  const path = currentChapterPath();
  if (!path) {
    return undefined;
  }
  return languageFor(path) === "markdown" ? `![${name.replace(/\.[^.]+$/, "")}](${name})` : `"${name}"`;
}
const htmlEditor = new PaneEditor(ui.htmlEditorHost, {
  language: "html",
  readOnly: true,
  onScroll: () => sync.fromHtml(),
});
const sync = new ScrollSync(sourceEditor, htmlEditor, ui.preview);

function currentChapterPath(): string | undefined {
  if (!manifest) {
    return undefined;
  }
  if (coverSelected) {
    return assembled?.coverPath ?? manifest.cover ?? PROJECT_LAYOUT.cover;
  }
  if (currentIndex < 0) {
    return undefined;
  }
  const entry = manifest.chapters[currentIndex];
  if (!entry) {
    return undefined;
  }
  return entry.file === "catalog" ? manifest.catalog : entry.file;
}

function languageFor(path: string | undefined): EditorLanguage {
  if (!path) {
    return "text";
  }
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }
  return "text";
}

async function showChapterInEditor(): Promise<void> {
  const path = currentChapterPath();
  if (coverSelected && project && path && assembled) {
    ui.currentFile.textContent = `${project.name}/${path}`;
    sourceEditor.setReadOnly(false);
    sourceEditor.setLanguage("json");
    ui.sourceKind.textContent = "表紙デザイン";
    ui.formatToolbar.hidden = true;
    // cover.json がまだ無ければ既定デザインをひな形として出す（編集・ドラッグした時点で保存される）
    sourceEditor.setText(assembled.coverText ?? coverTemplate(assembled.manual));
    return;
  }
  const entry = manifest?.chapters[currentIndex];
  ui.currentFile.textContent = path ? `${project?.name ?? ""}/${path}` : "";
  if (!project || !path || !entry) {
    sourceEditor.setText("");
    sourceEditor.setReadOnly(true);
    ui.sourceKind.textContent = "";
    return;
  }
  sourceEditor.setReadOnly(false);
  sourceEditor.setLanguage(languageFor(path));
  ui.sourceKind.textContent = entry.file === "catalog" ? "メニュー定義" : languageFor(path) === "json" ? "手順 JSON" : "Markdown";
  ui.formatToolbar.hidden = languageFor(path) !== "markdown";
  try {
    sourceEditor.setText(await project.readText(path));
  } catch (error) {
    sourceEditor.setText("");
    logMessage(`${path} を読めません: ${(error as Error).message}`, "error");
  }
}

/** ソースの変更：キャッシュを更新し、保存と再描画を予約する */
function onSourceChanged(text: string): void {
  const path = currentChapterPath();
  if (!project || !path) {
    return;
  }
  project.setCachedText(path, text);
  pendingWrites.set(path, text);
  updateSaveStatus();
  scheduleWrite();
  scheduleRebuild();
}

let writeTimer: number | undefined;
function scheduleWrite(): void {
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    if (sourceEditor.view.composing) {
      scheduleWrite();
      return;
    }
    void flushWrites();
  }, SAVE_DELAY_MS);
}

async function flushWrites(): Promise<void> {
  if (!project) {
    return;
  }
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  for (const [path, text] of entries) {
    try {
      await project.writeText(path, text);
    } catch (error) {
      logMessage(`${path} の保存に失敗しました: ${(error as Error).message}`, "error");
      pendingWrites.set(path, text);
    }
  }
  if (manifestDirty && manifest) {
    try {
      await project.writeManifest(manifest);
      manifestDirty = false;
    } catch (error) {
      logMessage(`${PROJECT_LAYOUT.manifest} の保存に失敗しました: ${(error as Error).message}`, "error");
    }
  }
  updateSaveStatus();
}

function markManifestDirty(): void {
  manifestDirty = true;
  updateSaveStatus();
  scheduleWrite();
}

// ---- 組み立てと描画 ----------------------------------------------------------

let rebuildTimer: number | undefined;
function scheduleRebuild(): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    // IME で変換中はプレビューを差し替えない（変換が確定してから再描画する）
    if (sourceEditor.view.composing) {
      scheduleRebuild();
      return;
    }
    void rebuild();
  }, RENDER_DELAY_MS);
}

async function rebuild(): Promise<void> {
  if (!project || !manifest) {
    return;
  }
  try {
    assembled = await assembleManual(manifest, project);
    reportWarnings(assembled.warnings);
    if (currentIndex >= manifest.chapters.length) {
      currentIndex = manifest.chapters.length - 1;
    }
    renderChapterList();
    renderAssetStatus();
    await renderUnusedFiles();
    renderOutput();
  } catch (error) {
    logMessage(`組み立てに失敗しました: ${(error as Error).message}`, "error");
  }
}

function renderOutput(): void {
  if (!assembled) {
    return;
  }
  try {
    const manual = assembled.manual;
    if (coverSelected) {
      sync.beginContentUpdate();
      const { html, chapterHtml } = buildCoverHtml(manual, { css: manualCss });
      setHtmlViewText(chapterHtml ?? "");
      sync.setAnchors([]);
      updatePreview(html);
      return;
    }
    const chapter = manual.chapters[currentIndex];
    if (!chapter) {
      updatePreview("");
      setHtmlViewText("");
      sync.setAnchors([]);
      return;
    }
    // 差し替えで発生する HTML ペイン・プレビューのスクロールイベントがソースを動かさないようにする
    sync.beginContentUpdate();
    if (ui.previewMode.value === "full") {
      const { html, warnings } = buildManualHtml(manual, { css: manualCss });
      reportWarnings(warnings);
      setHtmlViewText(abbreviateDataUris(html));
      sync.setAnchors([]);
      updatePreview(html);
      return;
    }
    const { html, warnings, chapterHtml } = buildChapterHtml(manual, currentIndex, { css: manualCss });
    reportWarnings(warnings);
    setHtmlViewText(abbreviateDataUris(chapterHtml ?? ""));
    sync.setAnchors(buildAnchors(chapter, chapterHtml ?? "", sourceEditor.getText()));
    updatePreview(html);
  } catch (error) {
    logMessage(`プレビューの生成に失敗しました: ${(error as Error).message}`, "error");
  }
}

function abbreviateDataUris(html: string): string {
  return html.replace(DATA_URI_PATTERN, "$1…");
}

/** いま表示しているコードペイン（Markdown/JSON のソース、または生成 HTML） */
let codeView: "source" | "html" = "source";
/** HTML ペインが隠れている間に生成した最新の HTML（表示したときに流し込む） */
let pendingHtmlText: string | undefined;

function setHtmlViewText(text: string): void {
  if (codeView === "html") {
    htmlEditor.setText(text);
    sync.rebuildHtmlSegments();
    pendingHtmlText = undefined;
  } else {
    pendingHtmlText = text;
  }
}

function setCodeView(view: "source" | "html"): void {
  codeView = view;
  ui.sourcePane.hidden = view !== "source";
  ui.htmlPane.hidden = view !== "html";
  ui.viewSourceButton.classList.toggle("active", view === "source");
  ui.viewHtmlButton.classList.toggle("active", view === "html");
  ui.viewSourceButton.setAttribute("aria-selected", String(view === "source"));
  ui.viewHtmlButton.setAttribute("aria-selected", String(view === "html"));
  if (view === "html" && pendingHtmlText !== undefined) {
    htmlEditor.setText(pendingHtmlText);
    pendingHtmlText = undefined;
    sync.rebuildHtmlSegments();
  }
  // 表示したペインをソースの位置に合わせる
  sync.syncFromSourceNow();
}

/**
 * プレビューを更新する。初回は srcdoc で読み込み、2 回目以降は iframe を再読込せずに
 * body だけ差し替える（再読込によるフォーカス移動・スクロールのリセット・ちらつきを避ける）
 */
function updatePreview(html: string): void {
  const doc = ui.preview.contentDocument;
  if (doc && doc.body && doc.body.hasAttribute("data-mb-preview")) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    doc.body.className = parsed.body.className;
    doc.body.innerHTML = parsed.body.innerHTML;
    sync.syncFromSourceNow();
    enableCoverEditing();
    enableFigureEditing();
    enablePreviewDrop();
    return;
  }
  ui.preview.srcdoc = html;
}

// ---- 表紙のドラッグ編集 -------------------------------------------------------------

const COVER_EDIT_STYLE_ID = "mb-cover-edit-style";
const COVER_EDIT_CSS = `
body.book { padding: 0 !important; max-width: none !important; background: #e5e7eb; }
[data-mb-cover] { margin: 8px auto !important; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); }
[data-mb-cover] [data-el] { cursor: move; outline: 1px dashed rgba(217, 119, 6, 0.55); outline-offset: 1px; }
[data-mb-cover] [data-el]:hover { outline-color: #d97706; }
[data-mb-cover] [data-el].mb-selected { outline: 2px solid #d97706; }
[data-mb-cover] .mb-handle { position: absolute; right: -5px; bottom: -5px; width: 10px; height: 10px; background: #d97706; border: 1px solid #fff; border-radius: 2px; cursor: nwse-resize; z-index: 1000; }
[data-mb-cover] .mb-dragging { opacity: 0.85; }
`;
/** 位置・幅を丸める単位（mm） */
const COVER_SNAP_MM = 0.5;
let selectedCoverElementId: string | undefined;

/** いまのソース（cover.json）を表紙デザインとして読む。壊れていれば組み立て済みのもの、無ければ既定 */
function currentCoverDesign(): CoverDesign {
  if (!assembled) {
    return { elements: [] };
  }
  try {
    const value: unknown = JSON.parse(sourceEditor.getText());
    if (isCoverDesign(value)) {
      return value;
    }
  } catch {
    // ソースが編集途中で JSON として読めない
  }
  return assembled.manual.cover ?? defaultCoverDesign(assembled.manual);
}

/** 表紙デザインをソース（cover.json）に書き戻し、保存と再描画を予約する */
function commitCoverDesign(design: CoverDesign): void {
  const text = `${JSON.stringify(design, null, 2)}\n`;
  sourceEditor.setText(text);
  onSourceChanged(text);
}

function snap(value: number): number {
  return Math.round(value / COVER_SNAP_MM) * COVER_SNAP_MM;
}

/** プレビュー内の表紙要素にドラッグ（移動）とつまみ（幅の変更）を付ける */
function enableCoverEditing(): void {
  const doc = ui.preview.contentDocument;
  const page = doc?.querySelector<HTMLElement>("[data-mb-cover]");
  if (!doc || !page) {
    return;
  }
  if (!doc.getElementById(COVER_EDIT_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = COVER_EDIT_STYLE_ID;
    style.textContent = COVER_EDIT_CSS;
    doc.head.appendChild(style);
  }
  // ページ（210mm）がペインより広ければ縮小して全体を見せる。zoom はレイアウトに効くので座標変換はそのまま使える
  const available = doc.documentElement.clientWidth - 16;
  const natural = page.offsetWidth;
  if (natural > available && available > 100) {
    page.style.zoom = String(available / natural);
  }
  const pxPerMm = () => page.getBoundingClientRect().width / COVER_PAGE.width;

  page.querySelectorAll<HTMLElement>("[data-el]").forEach((el) => {
    const id = el.getAttribute("data-el") ?? "";
    if (id === selectedCoverElementId) {
      el.classList.add("mb-selected");
    }
    const handle = doc.createElement("div");
    handle.className = "mb-handle";
    el.appendChild(handle);

    const startInteraction = (event: MouseEvent, mode: "move" | "resize") => {
      event.preventDefault();
      event.stopPropagation();
      selectCoverElement(id);
      const design = currentCoverDesign();
      const target = design.elements.find((e) => e.id === id);
      if (!target) {
        return;
      }
      const scale = pxPerMm();
      const startX = event.clientX;
      const startY = event.clientY;
      const origin: CoverElement = { ...target };
      const rect = el.getBoundingClientRect();
      const originW = target.w ?? rect.width / scale;
      const originH = target.h;
      el.classList.add("mb-dragging");
      let moved = false;

      const onMove = (e: MouseEvent) => {
        const dx = (e.clientX - startX) / scale;
        const dy = (e.clientY - startY) / scale;
        moved = true;
        if (mode === "move") {
          const w = target.w ?? rect.width / scale;
          const x = Math.min(Math.max(0, origin.x + dx), COVER_PAGE.width - Math.min(w, COVER_PAGE.width));
          const y = Math.min(Math.max(0, origin.y + dy), COVER_PAGE.height - 2);
          el.style.left = `${x}mm`;
          el.style.top = `${y}mm`;
          target.x = snap(x);
          target.y = snap(y);
        } else {
          const w = Math.max(5, Math.min(originW + dx, COVER_PAGE.width - origin.x));
          el.style.width = `${w}mm`;
          target.w = snap(w);
          if (originH !== undefined) {
            const h = Math.max(2, originH + dy);
            el.style.height = `${h}mm`;
            target.h = snap(h);
          }
        }
      };
      const onUp = () => {
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
        el.classList.remove("mb-dragging");
        if (moved) {
          commitCoverDesign(design);
        }
      };
      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseup", onUp);
    };

    el.addEventListener("mousedown", (event) => startInteraction(event, "move"));
    handle.addEventListener("mousedown", (event) => startInteraction(event, "resize"));
  });

  doc.addEventListener("keydown", (event) => {
    if ((event.key === "Delete" || event.key === "Backspace") && selectedCoverElementId) {
      event.preventDefault();
      removeCoverElement(selectedCoverElementId);
    }
  });
  // 空白をクリックしたら選択解除
  page.addEventListener("mousedown", (event) => {
    if (event.target === page) {
      selectCoverElement(undefined);
    }
  });
}

function selectCoverElement(id: string | undefined): void {
  selectedCoverElementId = id;
  const doc = ui.preview.contentDocument;
  doc?.querySelectorAll<HTMLElement>("[data-el]").forEach((el) => {
    el.classList.toggle("mb-selected", el.getAttribute("data-el") === id);
  });
  if (id) {
    doc?.body.focus();
    ui.preview.focus();
  }
}

function addCoverElement(type: CoverElementType, text: string, src?: string, at?: { x: number; y: number }): void {
  const design = currentCoverDesign();
  const used = new Set(design.elements.map((e) => e.id));
  let n = design.elements.length + 1;
  while (used.has(`${type}${n}`)) {
    n += 1;
  }
  const element = newCoverElement(type, `${type}${n}`, src);
  if (type === "text" && text.trim()) {
    element.text = text;
  }
  if (at) {
    element.x = Math.min(at.x, COVER_PAGE.width - (element.w ?? 10));
    element.y = Math.min(at.y, COVER_PAGE.height - 10);
  }
  design.elements.push(element);
  selectedCoverElementId = element.id;
  commitCoverDesign(design);
  logMessage(`表紙に要素を追加しました: ${element.id}`);
}

function removeCoverElement(id: string): void {
  const design = currentCoverDesign();
  const index = design.elements.findIndex((e) => e.id === id);
  if (index < 0) {
    return;
  }
  design.elements.splice(index, 1);
  selectedCoverElementId = undefined;
  commitCoverDesign(design);
  logMessage(`表紙の要素を削除しました: ${id}`);
}

async function selectCover(): Promise<void> {
  if (!manifest) {
    return;
  }
  coverSelected = true;
  renderChapterList();
  await showChapterInEditor();
  renderOutput();
}

function openCoverDialog(): void {
  if (!assembled) {
    return;
  }
  ui.coverElType.value = "text";
  ui.coverElText.value = "テキスト";
  const names = [...assembled.manual.images.map((img) => img.name), ...assembled.manual.figures.map((f) => f.name)].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
  ui.coverElImage.replaceChildren(
    ...names.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    }),
  );
  updateCoverDialogFields();
  ui.coverDialog.showModal();
}

function updateCoverDialogFields(): void {
  const type = ui.coverElType.value;
  ui.coverElImageField.hidden = type !== "image";
  ui.coverElTextField.hidden = type !== "text";
}

function submitCoverElement(): void {
  const type = ui.coverElType.value as CoverElementType;
  if (type === "image" && !ui.coverElImage.value) {
    logMessage("追加できる画像がありません。先に images/ に PNG か SVG を入れてください", "warn");
    return;
  }
  addCoverElement(type, ui.coverElText.value, type === "image" ? ui.coverElImage.value : undefined);
}

/** 出力 HTML の data-line / data-step とソース行の対応表を作る */
function buildAnchors(chapter: Chapter, chapterHtml: string, sourceText: string): SyncAnchor[] {
  const anchors: SyncAnchor[] = [];
  if (chapter.kind === "markdown") {
    for (const m of chapterHtml.matchAll(/data-line="(\d+)"/g)) {
      anchors.push({ attr: "data-line", value: m[1], line: Number(m[1]) });
    }
  } else if (chapter.kind === "steps") {
    // 手順 n は、JSON ソースで n 番目に現れる "text" キーの行に対応させる
    const textLines: number[] = [];
    sourceText.split("\n").forEach((content, i) => {
      if (/"text"\s*:/.test(content)) {
        textLines.push(i + 1);
      }
    });
    for (const m of chapterHtml.matchAll(/data-step="(\d+)"/g)) {
      const line = textLines[Number(m[1]) - 1];
      if (line) {
        anchors.push({ attr: "data-step", value: m[1], line });
      }
    }
  }
  return anchors;
}

ui.preview.addEventListener("load", () => {
  const win = ui.preview.contentWindow;
  const doc = ui.preview.contentDocument;
  if (win && doc) {
    if (doc.body) {
      doc.body.setAttribute("data-mb-preview", "1");
    }
    win.addEventListener("scroll", () => sync.fromPreview(), { passive: true });
    sync.rebuildHtmlSegments();
    sync.syncFromSourceNow();
    enableCoverEditing();
    enableFigureEditing();
    enablePreviewDrop();
  }
});

// ---- 章一覧 -------------------------------------------------------------------

const KIND_LABELS: Record<Chapter["kind"], string> = { markdown: "MD", steps: "手順", catalog: "一覧" };

function createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function renderChapterList(): void {
  if (!manifest || !assembled) {
    ui.chapterList.replaceChildren();
    ui.chapterCount.textContent = "";
    return;
  }
  const entries = manifest.chapters;
  const labels = computeGroupLabels(
    entries.map((e) => e.group ?? ""),
    manifest.autoNumberGroups ?? false,
  );
  ui.chapterCount.textContent = entries.length ? `(${entries.length})` : "";
  const groups = Array.from(new Set(entries.map((e) => (e.group ?? "").trim()).filter(Boolean)));
  ui.groupOptions.replaceChildren(
    ...groups.map((g) => {
      const option = document.createElement("option");
      option.value = g;
      return option;
    }),
  );

  const coverRow: HTMLLIElement[] = [];
  if (manifest.book) {
    const item = document.createElement("li");
    item.className = `cover-row${coverSelected ? " selected" : ""}`;
    const main = document.createElement("div");
    main.className = "row-main";
    const tag = document.createElement("span");
    tag.className = "kind-tag kind-cover";
    tag.textContent = "表紙";
    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "title-button";
    titleButton.textContent = assembled?.coverText ? "表紙デザイン（cover.json）" : "表紙デザイン（既定）";
    titleButton.title = "クリックすると表紙をプレビュー上でドラッグ編集できます";
    titleButton.addEventListener("click", () => void selectCover());
    main.append(
      tag,
      titleButton,
      createButton("＋", "表紙に要素（画像・テキスト・帯）を追加", () => {
        void selectCover().then(openCoverDialog);
      }),
      createButton("×", "選択中の要素を削除（プレビューで要素をクリックして選択）", () => {
        if (selectedCoverElementId) {
          removeCoverElement(selectedCoverElementId);
        } else {
          logMessage("削除する要素をプレビューでクリックして選んでください", "warn");
        }
      }),
    );
    item.append(main);
    coverRow.push(item);
  } else if (coverSelected) {
    coverSelected = false;
  }

  ui.chapterList.replaceChildren(
    ...coverRow,
    ...entries.map((entry, index) => {
      const chapter = assembled?.chapters[index]?.chapter;
      const item = document.createElement("li");
      if (index === currentIndex && !coverSelected) {
        item.classList.add("selected");
      }
      if (index === 0 || labels[index] !== labels[index - 1]) {
        item.classList.add("group-start");
      }

      const main = document.createElement("div");
      main.className = "row-main";
      const tag = document.createElement("span");
      tag.className = `kind-tag kind-${chapter?.kind ?? "markdown"}`;
      tag.textContent = chapter ? KIND_LABELS[chapter.kind] : "?";
      const titleButton = document.createElement("button");
      titleButton.type = "button";
      titleButton.className = "title-button";
      titleButton.textContent = chapter ? chapterTitle(chapter) : entry.file;
      titleButton.title = entry.file;
      if (assembled?.chapters[index]?.error) {
        titleButton.style.color = "var(--color-error)";
      }
      titleButton.addEventListener("click", () => void selectChapter(index));
      main.append(
        tag,
        titleButton,
        createButton("＋", "この章の直後に挿入", () => openInsertDialog(index + 1)),
        createButton("↑", "上へ", () => moveChapter(index, -1)),
        createButton("↓", "下へ", () => moveChapter(index, 1)),
        createButton("×", "一覧から外す（ファイルは残ります）", () => removeChapter(index)),
      );

      const sub = document.createElement("div");
      sub.className = "row-sub";
      const groupLabel = document.createElement("span");
      groupLabel.textContent = "グループ";
      const groupInput = document.createElement("input");
      groupInput.type = "text";
      groupInput.className = "row-input";
      groupInput.placeholder = "例: エリシアS 基本";
      groupInput.setAttribute("list", "group-options");
      groupInput.value = entry.group ?? "";
      groupInput.addEventListener("change", () => {
        entry.group = groupInput.value.trim() || undefined;
        markManifestDirty();
        void rebuild();
      });
      const computed = document.createElement("span");
      computed.className = "group-label";
      computed.textContent = labels[index] && labels[index] !== (entry.group ?? "").trim() ? labels[index].split(" ")[0] : "";
      sub.append(groupLabel, groupInput, computed);

      const sub2 = document.createElement("div");
      sub2.className = "row-sub";
      const titleLabel = document.createElement("span");
      titleLabel.textContent = "表示名";
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "row-input";
      titleInput.placeholder = chapter?.title ?? "";
      titleInput.title = "出力時のタイトルを変えたいときだけ入力します（空なら原稿のタイトル）";
      titleInput.value = entry.title ?? "";
      titleInput.addEventListener("change", () => {
        entry.title = titleInput.value.trim() || undefined;
        markManifestDirty();
        void rebuild();
      });
      sub2.append(titleLabel, titleInput);

      item.append(main, sub, sub2);
      return item;
    }),
  );
}

async function selectChapter(index: number): Promise<void> {
  if (!manifest || index < 0 || index >= manifest.chapters.length) {
    return;
  }
  currentIndex = index;
  coverSelected = false;
  renderChapterList();
  await showChapterInEditor();
  renderOutput();
}

function moveChapter(index: number, delta: number): void {
  if (!manifest) {
    return;
  }
  const target = index + delta;
  if (target < 0 || target >= manifest.chapters.length) {
    return;
  }
  const [entry] = manifest.chapters.splice(index, 1);
  manifest.chapters.splice(target, 0, entry);
  if (currentIndex === index) {
    currentIndex = target;
  } else if (currentIndex === target) {
    currentIndex = index;
  }
  markManifestDirty();
  void rebuild();
}

function removeChapter(index: number): void {
  if (!manifest) {
    return;
  }
  const [removed] = manifest.chapters.splice(index, 1);
  if (currentIndex >= manifest.chapters.length) {
    currentIndex = manifest.chapters.length - 1;
  }
  logMessage(`章を一覧から外しました: ${removed.file}（ファイルは chapters/ に残っています）`);
  markManifestDirty();
  void rebuild().then(() => showChapterInEditor());
}

async function renderUnusedFiles(): Promise<void> {
  ui.unusedFiles.replaceChildren();
  if (!project || !manifest) {
    return;
  }
  const unused = await project.unusedChapterFiles(manifest);
  if (unused.length === 0) {
    return;
  }
  const title = document.createElement("div");
  title.className = "unused-title";
  title.textContent = `一覧に無いファイル（${unused.length}）`;
  const list = document.createElement("ul");
  for (const path of unused) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "item-label";
    label.textContent = path.replace(`${PROJECT_LAYOUT.chapters}/`, "");
    li.append(
      label,
      createButton("追加", "末尾に章として追加", () => {
        manifest?.chapters.push({ file: path });
        markManifestDirty();
        void rebuild();
      }),
    );
    list.append(li);
  }
  ui.unusedFiles.append(title, list);
}

// ---- 章の挿入 -----------------------------------------------------------------

let insertAt = 0;

async function openInsertDialog(at: number): Promise<void> {
  if (!project || !manifest) {
    return;
  }
  insertAt = at;
  ui.insertKind.value = "markdown";
  ui.insertFile.value = "";
  ui.insertTitle.value = "";
  const prev = manifest.chapters[Math.min(at, manifest.chapters.length) - 1];
  ui.insertGroup.value = prev?.group ?? "";
  const unused = await project.unusedChapterFiles(manifest);
  ui.insertExisting.replaceChildren(
    ...unused.map((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      return option;
    }),
  );
  updateInsertFields();
  ui.insertDialog.showModal();
}

function updateInsertFields(): void {
  const existing = ui.insertKind.value === "existing";
  ui.insertFileField.hidden = existing;
  ui.insertExistingField.hidden = !existing;
}

async function submitInsert(): Promise<void> {
  if (!project || !manifest) {
    return;
  }
  try {
    const kind = ui.insertKind.value;
    const title = ui.insertTitle.value.trim() || "新しい章";
    const group = ui.insertGroup.value.trim() || undefined;
    let file: string;
    if (kind === "existing") {
      file = ui.insertExisting.value;
      if (!file) {
        throw new Error("追加できるファイルがありません");
      }
    } else {
      const ext = kind === "steps" ? ".json" : ".md";
      let name = ui.insertFile.value.trim() || `${String(manifest.chapters.length + 1).padStart(2, "0")}-${kind === "steps" ? "steps" : "chapter"}`;
      if (!name.toLowerCase().endsWith(ext)) {
        name += ext;
      }
      file = `${PROJECT_LAYOUT.chapters}/${name}`;
      if (await project.exists(file)) {
        throw new Error(`${file} は既にあります`);
      }
      await project.writeText(file, kind === "steps" ? stepsTemplate(title) : markdownTemplate(title));
    }
    const entry: ManifestChapter = { file, group };
    manifest.chapters.splice(insertAt, 0, entry);
    currentIndex = insertAt;
    markManifestDirty();
    logMessage(`章を挿入しました: ${file}`);
    await rebuild();
    await showChapterInEditor();
    renderOutput();
    sourceEditor.focus();
  } catch (error) {
    logMessage(`章を挿入できませんでした: ${(error as Error).message}`, "error");
  }
}

// ---- マニュアル情報 ------------------------------------------------------------

function syncUiFromManifest(): void {
  if (!manifest) {
    return;
  }
  ui.title.value = manifest.title;
  ui.subtitle.value = manifest.subtitle ?? "";
  ui.author.value = manifest.author ?? "";
  ui.version.value = manifest.version ?? "";
  ui.date.value = manifest.revisedOn ?? "";
  ui.notes.value = (manifest.coverNotes ?? []).join("\n");
  ui.book.checked = manifest.book ?? false;
  ui.autoNumber.checked = manifest.autoNumberGroups ?? false;
}

function syncManifestFromUi(): void {
  if (!manifest) {
    return;
  }
  manifest.title = ui.title.value.trim() || "無題のマニュアル";
  manifest.subtitle = ui.subtitle.value.trim();
  manifest.author = ui.author.value.trim();
  manifest.version = ui.version.value.trim();
  manifest.revisedOn = ui.date.value || new Date().toISOString().slice(0, 10);
  manifest.coverNotes = ui.notes.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  manifest.book = ui.book.checked;
  manifest.autoNumberGroups = ui.autoNumber.checked;
  markManifestDirty();
  scheduleRebuild();
}

// ---- 素材の取り込み（プロジェクトフォルダへ保存） -----------------------------------------

function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

async function importFiles(files: File[]): Promise<void> {
  if (!project || !manifest) {
    logMessage("先にプロジェクトを開いてください", "warn");
    return;
  }
  let added = 0;
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name, "ja"))) {
    try {
      if (await importFile(file)) {
        added += 1;
      }
    } catch (error) {
      logMessage(`${file.name} の取り込みに失敗しました: ${(error as Error).message}`, "error");
    }
  }
  project.invalidate();
  if (added > 0) {
    markManifestDirty();
  }
  await flushWrites();
  await rebuild();
}

/** 1 ファイルをプロジェクトフォルダに保存する。章が増えたら true */
async function importFile(file: File): Promise<boolean> {
  if (!project || !manifest) {
    return false;
  }
  const name = file.name;
  if (hasExtension(name, MARKDOWN_EXTENSIONS)) {
    const path = `${PROJECT_LAYOUT.chapters}/${name}`;
    await project.writeText(path, stripBom(await file.text()));
    return addChapterEntry(path);
  }
  if (hasExtension(name, [".json"])) {
    const text = stripBom(await file.text());
    const value: unknown = JSON.parse(text);
    if (isMenuCatalog(value)) {
      const path = `${PROJECT_LAYOUT.catalog}/menus.json`;
      await project.writeText(path, text);
      manifest.catalog = path;
      if (!manifest.chapters.some((c) => c.file === "catalog")) {
        manifest.chapters.unshift({ file: "catalog" });
        logMessage("メニュー定義を保存し、カタログ章を先頭に追加しました");
        return true;
      }
      logMessage("メニュー定義を更新しました");
      return false;
    }
    if (isStepsData(value)) {
      const path = `${PROJECT_LAYOUT.chapters}/${name}`;
      await project.writeText(path, text);
      return addChapterEntry(path);
    }
    throw new Error("手順（title + steps）でもメニュー定義（menus + screens）でもありません");
  }
  if (hasExtension(name, [".txt"])) {
    const text = stripBom(await file.text());
    if (!TREE_MARKERS.some((m) => text.includes(m)) && !/tree/i.test(name)) {
      throw new Error("ツリー表示（├─ / └─）ではありません");
    }
    const path = `${PROJECT_LAYOUT.catalog}/menu-tree.txt`;
    await project.writeText(path, text);
    manifest.menuTree = path;
    logMessage("メニューのツリー表示を保存しました");
    return false;
  }
  if (hasExtension(name, IMAGE_EXTENSIONS)) {
    await project.writeBlob(`${PROJECT_LAYOUT.images}/${name}`, file);
    return false;
  }
  if (hasExtension(name, [".pdf", ".css", ".gitkeep"])) {
    return false;
  }
  logMessage(`対応していないファイルです: ${name}`, "warn");
  return false;
}

function addChapterEntry(path: string): boolean {
  if (!manifest) {
    return false;
  }
  if (manifest.chapters.some((c) => c.file === path)) {
    logMessage(`章を更新しました: ${path}`);
    return false;
  }
  manifest.chapters.push({ file: path });
  logMessage(`章を追加しました: ${path}`);
  return true;
}

/** ドロップされた項目（フォルダ含む）を再帰的に File の一覧にする */
async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }
  const files: File[] = [];
  for (const entry of entries) {
    await walkEntry(entry, files);
  }
  return files;
}

async function walkEntry(entry: FileSystemEntry, files: File[]): Promise<void> {
  if (entry.isFile) {
    files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) {
        break;
      }
      for (const child of batch) {
        await walkEntry(child, files);
      }
    }
  }
}

function renderAssetStatus(): void {
  if (!assembled) {
    ui.assetCount.textContent = "";
    ui.catalogStatus.textContent = "";
    ui.assetList.replaceChildren();
    return;
  }
  const manual = assembled.manual;
  renderAssetList();
  ui.assetCount.textContent = `(図 ${manual.figures.length} / 画像 ${manual.images.length})`;
  const catalogText = manual.catalog
    ? `メニュー定義: メニュー ${manual.catalog.menus.length}、画面 ${manual.catalog.screens.length}`
    : "メニュー定義（catalog/menus.json）は未取り込みです。チップは解決されません。";
  ui.catalogStatus.textContent = `${catalogText} ／ ツリー表示: ${manual.menuTree ? "あり" : "なし"}`;
}

/** images/ の素材をサムネイル付きで並べる。ドラッグしてプレビューやソースへ落とせる */
function renderAssetList(): void {
  if (!assembled) {
    return;
  }
  const items: { name: string; thumb: () => HTMLElement }[] = [
    ...assembled.manual.images.map((img) => ({
      name: img.name,
      thumb: () => {
        const el = document.createElement("img");
        el.src = img.dataUri;
        el.alt = "";
        return el;
      },
    })),
    ...assembled.manual.figures.map((fig) => ({
      name: fig.name,
      thumb: () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = fig.svg;
        return wrap;
      },
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  ui.assetList.replaceChildren(
    ...items.map(({ name, thumb }) => {
      const li = document.createElement("li");
      li.draggable = true;
      li.title = `${name}（ドラッグして配置、クリックでカーソル位置に挿入）`;
      const t = document.createElement("div");
      t.className = "thumb";
      t.appendChild(thumb());
      const label = document.createElement("span");
      label.className = "asset-name";
      label.textContent = name;
      li.append(t, label);
      li.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(ASSET_DRAG_TYPE, name);
        event.dataTransfer?.setData("text/plain", name);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
        }
      });
      li.addEventListener("click", () => {
        const text = assetInsertText(name);
        if (text) {
          sourceEditor.insertAtCursor(text);
        }
      });
      return li;
    }),
  );
}

// ---- 図（本文中の SVG / PNG）の配置編集 ----------------------------------------------------

const FIGURE_EDIT_STYLE_ID = "mb-figure-edit-style";
const FIGURE_EDIT_CSS = `
figure[data-fig] { cursor: move; outline: 1px dashed rgba(217, 119, 6, 0.55); outline-offset: 2px; position: relative; }
figure[data-fig]:hover { outline-color: #d97706; }
figure[data-fig].mb-selected { outline: 2px solid #d97706; }
figure[data-fig] .mb-handle { position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; background: #d97706; border: 1px solid #fff; border-radius: 2px; cursor: nwse-resize; z-index: 1000; }
.mb-fig-toolbar { position: absolute; top: -30px; left: 0; display: flex; gap: 3px; padding: 3px 5px; background: #fff7ed; border: 1px solid #f3c27a; border-radius: 4px; font: 11px/1.4 "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif; z-index: 1001; white-space: nowrap; cursor: default; }
.mb-fig-toolbar button { font: inherit; padding: 1px 6px; border: 1px solid #e9d5bd; border-radius: 3px; background: #fff; color: #7c2d12; cursor: pointer; }
.mb-fig-toolbar button:hover { background: #fde7c7; }
.mb-fig-toolbar .mb-sep { width: 1px; background: #e9d5bd; margin: 0 2px; }
.mb-fig-toolbar .mb-val { color: #8a7a68; align-self: center; }
.mb-drop-marker { position: absolute; left: 0; right: 0; height: 0; border-top: 2px dashed #d97706; pointer-events: none; z-index: 999; }
`;
let selectedFigureKey: string | undefined;

/** プレビュー文書での 1mm のピクセル数（CSS の mm を実測する） */
function previewPxPerMm(doc: Document): number {
  const probe = doc.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:100mm;height:0";
  doc.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return px || 3.78;
}

/** 図の配置を Markdown の該当行に書き戻す */
function commitFigureLayout(figure: HTMLElement, layout: FigureLayout): void {
  const key = figure.getAttribute("data-fig") ?? "";
  const lineAttr = figure.closest("[data-line]")?.getAttribute("data-line");
  const startLine = lineAttr ? Number(lineAttr) : 1;
  const lines = sourceEditor.getText().split("\n");
  for (let i = startLine - 1; i < Math.min(lines.length, startLine + 20); i++) {
    const rewritten = rewriteImageAttrs(lines[i], key, layout);
    if (rewritten !== lines[i]) {
      lines[i] = rewritten;
      const text = lines.join("\n");
      sourceEditor.setText(text);
      onSourceChanged(text);
      return;
    }
  }
  logMessage(`図 ${key} の記法が原稿の ${startLine} 行目付近に見つかりません`, "warn");
}

function enableFigureEditing(): void {
  const doc = ui.preview.contentDocument;
  if (!doc || coverSelected || manifest?.chapters[currentIndex] === undefined) {
    return;
  }
  const figures = doc.querySelectorAll<HTMLElement>("figure[data-fig]");
  if (figures.length === 0) {
    return;
  }
  if (!doc.getElementById(FIGURE_EDIT_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = FIGURE_EDIT_STYLE_ID;
    style.textContent = FIGURE_EDIT_CSS;
    doc.head.appendChild(style);
  }
  const pxPerMm = previewPxPerMm(doc);

  figures.forEach((figure) => {
    const key = figure.getAttribute("data-fig") ?? "";
    const layoutOf = () => parseFigureAttrs(figure.getAttribute("data-fig-layout") ?? "");
    if (key === selectedFigureKey) {
      figure.classList.add("mb-selected");
      figure.appendChild(buildFigureToolbar(doc, figure, layoutOf));
    }
    const handle = doc.createElement("div");
    handle.className = "mb-handle";
    figure.appendChild(handle);

    const start = (event: MouseEvent, mode: "move" | "resize") => {
      if ((event.target as HTMLElement).closest(".mb-fig-toolbar")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectFigure(key);
      const layout = layoutOf();
      const rect = figure.getBoundingClientRect();
      const parentRect = (figure.parentElement ?? doc.body).getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const mt0 = layout.mt ?? 0;
      const ml0 = layout.align === "left" ? (layout.ml ?? 0) : (rect.left - parentRect.left) / pxPerMm;
      const w0 = rect.width / pxPerMm;
      let moved = false;
      const onMove = (e: MouseEvent) => {
        const dx = (e.clientX - startX) / pxPerMm;
        const dy = (e.clientY - startY) / pxPerMm;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !moved) {
          return;
        }
        moved = true;
        if (mode === "move") {
          layout.mt = Math.max(0, Math.round((mt0 + dy) * 2) / 2);
          figure.style.marginTop = `${layout.mt}mm`;
          if (Math.abs(dx) >= 1) {
            layout.align = "left";
            layout.ml = Math.max(0, Math.round((ml0 + dx) * 2) / 2);
            figure.style.marginLeft = `${layout.ml}mm`;
            figure.style.marginRight = "auto";
          }
        } else {
          const w = Math.max(10, Math.round((w0 + dx) * 2) / 2);
          layout.w = `${w}mm`;
          figure.style.width = `${w}mm`;
        }
      };
      const onUp = () => {
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
        if (moved) {
          commitFigureLayout(figure, layout);
        }
      };
      doc.addEventListener("mousemove", onMove);
      doc.addEventListener("mouseup", onUp);
    };
    figure.addEventListener("mousedown", (event) => start(event, "move"));
    handle.addEventListener("mousedown", (event) => start(event, "resize"));
  });
}

function buildFigureToolbar(doc: Document, figure: HTMLElement, layoutOf: () => FigureLayout): HTMLElement {
  const bar = doc.createElement("div");
  bar.className = "mb-fig-toolbar";
  bar.addEventListener("mousedown", (e) => e.stopPropagation());
  const button = (label: string, title: string, change: (l: FigureLayout) => void) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const layout = layoutOf();
      change(layout);
      commitFigureLayout(figure, layout);
    });
    return b;
  };
  const sep = () => {
    const d = doc.createElement("span");
    d.className = "mb-sep";
    return d;
  };
  const val = (text: string) => {
    const v = doc.createElement("span");
    v.className = "mb-val";
    v.textContent = text;
    return v;
  };
  const l = layoutOf();
  bar.append(
    button("左", "左寄せ", (x) => {
      x.align = "left";
      x.ml = x.ml ?? 0;
    }),
    button("中", "中央", (x) => {
      x.align = "center";
      delete x.ml;
    }),
    button("右", "右寄せ", (x) => {
      x.align = "right";
      delete x.ml;
    }),
    sep(),
    val(`上 ${l.mt ?? 0}mm`),
    button("−", "上の余白を 1mm 減らす", (x) => {
      x.mt = Math.max(0, (x.mt ?? 0) - 1);
    }),
    button("＋", "上の余白を 1mm 増やす", (x) => {
      x.mt = (x.mt ?? 0) + 1;
    }),
    sep(),
    val(`内 ${l.p ?? 0}mm`),
    button("−", "内側の余白を 1mm 減らす", (x) => {
      x.p = Math.max(0, (x.p ?? 0) - 1);
    }),
    button("＋", "内側の余白を 1mm 増やす", (x) => {
      x.p = (x.p ?? 0) + 1;
    }),
    sep(),
    val(l.w ? `幅 ${l.w}` : "幅 自動"),
    button("リセット", "配置をすべて既定に戻す", (x) => {
      for (const k of Object.keys(x) as (keyof FigureLayout)[]) {
        delete x[k];
      }
    }),
  );
  return bar;
}

function selectFigure(key: string | undefined): void {
  selectedFigureKey = key;
  const doc = ui.preview.contentDocument;
  if (!doc) {
    return;
  }
  doc.querySelectorAll<HTMLElement>("figure[data-fig]").forEach((fig) => {
    const selected = fig.getAttribute("data-fig") === key;
    fig.classList.toggle("mb-selected", selected);
    fig.querySelector(".mb-fig-toolbar")?.remove();
    if (selected) {
      fig.appendChild(buildFigureToolbar(doc, fig, () => parseFigureAttrs(fig.getAttribute("data-fig-layout") ?? "")));
    }
  });
}

// ---- 素材のドロップ（プレビューへ） ------------------------------------------------------------

let previewDropBound: Document | undefined;

function enablePreviewDrop(): void {
  const doc = ui.preview.contentDocument;
  if (!doc || previewDropBound === doc) {
    return;
  }
  previewDropBound = doc;
  let marker: HTMLElement | undefined;
  const clearMarker = () => {
    marker?.remove();
    marker = undefined;
  };
  doc.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes(ASSET_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!coverSelected) {
      const target = findDropTarget(doc, event.clientY);
      clearMarker();
      if (target) {
        marker = doc.createElement("div");
        marker.className = "mb-drop-marker";
        const rect = target.getBoundingClientRect();
        marker.style.top = `${rect.top + doc.defaultView!.scrollY - 4}px`;
        doc.body.appendChild(marker);
      }
    }
  });
  doc.addEventListener("dragleave", clearMarker);
  doc.addEventListener("drop", (event) => {
    const name = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
    clearMarker();
    if (!name) {
      return;
    }
    event.preventDefault();
    dropAssetIntoPreview(doc, name, event.clientX, event.clientY);
  });
}

/** ドロップ位置の直後に来るブロック（data-line / data-step 付きの要素） */
function findDropTarget(doc: Document, clientY: number): HTMLElement | undefined {
  const blocks = Array.from(doc.querySelectorAll<HTMLElement>("[data-line], [data-step]"));
  return blocks.find((el) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 > clientY);
}

function dropAssetIntoPreview(doc: Document, name: string, clientX: number, clientY: number): void {
  if (!assembled) {
    return;
  }
  if (coverSelected) {
    const page = doc.querySelector<HTMLElement>("[data-mb-cover]");
    if (!page) {
      return;
    }
    const rect = page.getBoundingClientRect();
    const scale = rect.width / COVER_PAGE.width;
    addCoverElement("image", "", name, {
      x: Math.max(0, Math.round(((clientX - rect.left) / scale - 25) * 2) / 2),
      y: Math.max(0, Math.round(((clientY - rect.top) / scale) * 2) / 2),
    });
    return;
  }
  const chapter = assembled.manual.chapters[currentIndex];
  if (!chapter) {
    return;
  }
  const target = findDropTarget(doc, clientY);
  if (chapter.kind === "markdown") {
    const lines = sourceEditor.getText().split("\n");
    const snippet = `![${name.replace(/\.[^.]+$/, "")}](${name})`;
    let at = lines.length;
    const lineAttr = target?.getAttribute("data-line");
    if (lineAttr) {
      at = Math.max(0, Number(lineAttr) - 1);
    }
    const insert: string[] = [];
    if (at > 0 && lines[at - 1].trim() !== "") {
      insert.push("");
    }
    insert.push(snippet);
    if (at < lines.length && lines[at].trim() !== "") {
      insert.push("");
    }
    lines.splice(at, 0, ...insert);
    const text = lines.join("\n");
    sourceEditor.setText(text);
    onSourceChanged(text);
    logMessage(`図を差し込みました: ${name}（${at + 1} 行目）`);
    return;
  }
  if (chapter.kind === "steps") {
    try {
      const value: unknown = JSON.parse(sourceEditor.getText());
      if (!isStepsData(value)) {
        throw new Error("手順 JSON ではありません");
      }
      const stepAttr = target?.getAttribute("data-step") ?? target?.closest("[data-step]")?.getAttribute("data-step");
      const index = stepAttr ? Number(stepAttr) - 1 : value.steps.length - 1;
      const step = value.steps[Math.max(0, Math.min(index, value.steps.length - 1))];
      if (!step) {
        throw new Error("手順がありません");
      }
      step.images = [...(step.images ?? []), name];
      const text = `${JSON.stringify(value, null, 2)}\n`;
      sourceEditor.setText(text);
      onSourceChanged(text);
      logMessage(`手順 ${index + 1} に画像を追加しました: ${name}`);
    } catch (error) {
      logMessage(`画像を追加できませんでした: ${(error as Error).message}`, "error");
    }
    return;
  }
  logMessage("この章（メニュー一覧）には図を置けません", "warn");
}

// ---- 書式ツールバー（Markdown） -----------------------------------------------------------

const FONT_FAMILIES: Record<string, string> = {
  sans: "'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif",
  serif: "'Yu Mincho', 'Noto Serif JP', 'Hiragino Mincho ProN', serif",
  mono: "Consolas, 'BIZ UDGothic', 'MS Gothic', monospace",
};

function applyFormat(fmt: string): void {
  switch (fmt) {
    case "bold":
      return sourceEditor.wrapSelection("**", "**");
    case "italic":
      return sourceEditor.wrapSelection("*", "*");
    case "underline":
      return sourceEditor.wrapSelection("<u>", "</u>");
    case "strike":
      return sourceEditor.wrapSelection("~~", "~~");
    case "code":
      return sourceEditor.wrapSelection("`", "`");
    case "color":
      return sourceEditor.wrapSelection(`<span style="color:${ui.fmtColor.value}">`, "</span>");
    case "bg":
      return sourceEditor.wrapSelection(`<span style="background:${ui.fmtBg.value}">`, "</span>");
    case "h2":
      return sourceEditor.prefixLines("## ");
    case "h3":
      return sourceEditor.prefixLines("### ");
    case "ul":
      return sourceEditor.prefixLines("- ");
    case "ol":
      return sourceEditor.prefixLines((i) => `${i + 1}. `);
    case "quote":
      return sourceEditor.prefixLines("> ");
    case "chips":
      return sourceEditor.insertBlock("[[chips:m_tabs:F10, m_option1:F1]]");
    case "table":
      return sourceEditor.insertBlock("| 項目 | 内容 |\n|---|---|\n| | |");
    case "meta":
      return sourceEditor.insertBlock('<div class="meta">出典：</div>');
    default:
      return;
  }
}

function setupFormatToolbar(): void {
  ui.formatToolbar.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }
    const color = button.getAttribute("data-color");
    if (color) {
      ui.fmtColor.value = color;
      sourceEditor.wrapSelection(`<span style="color:${color}">`, "</span>");
      return;
    }
    const fmt = button.getAttribute("data-fmt");
    if (fmt) {
      applyFormat(fmt);
    }
  });
  ui.fmtFont.addEventListener("change", () => {
    const family = FONT_FAMILIES[ui.fmtFont.value];
    if (family) {
      sourceEditor.wrapSelection(`<span style="font-family:${family}">`, "</span>");
    }
    ui.fmtFont.value = "";
  });
  ui.fmtSize.addEventListener("change", () => {
    if (ui.fmtSize.value) {
      sourceEditor.wrapSelection(`<span style="font-size:${ui.fmtSize.value}">`, "</span>");
    }
    ui.fmtSize.value = "";
  });
}

// ---- 書き出し・印刷 -------------------------------------------------------------

async function exportHtml(): Promise<void> {
  if (!project || !assembled) {
    return;
  }
  try {
    await flushWrites();
    const { html, warnings } = buildManualHtml(assembled.manual, { css: manualCss });
    reportWarnings(warnings);
    const date = assembled.manual.revisedOn.replace(/-/g, "");
    const path = `${PROJECT_LAYOUT.output}/${assembled.manual.title}_${date}.html`;
    await project.writeText(path, html);
    logMessage(`書き出しました: ${project.name}/${path}`);
  } catch (error) {
    logMessage(`書き出しに失敗しました: ${(error as Error).message}`, "error");
  }
}

function printManual(): void {
  if (!assembled) {
    return;
  }
  try {
    const { html } = buildManualHtml(assembled.manual, { css: manualCss });
    const frame = ui.printFrame;
    frame.hidden = false;
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.width = "210mm";
    frame.style.height = "297mm";
    frame.onload = () => {
      const win = frame.contentWindow;
      if (win) {
        win.focus();
        win.print();
      }
    };
    frame.srcdoc = html;
  } catch (error) {
    logMessage(`印刷の準備に失敗しました: ${(error as Error).message}`, "error");
  }
}

// ---- 保存フォルダとプロジェクト ------------------------------------------------------

function setProjectControlsEnabled(enabled: boolean): void {
  for (const el of [ui.newProject, ui.reload, ui.printButton, ui.exportButton, ui.appendChapter, ui.fileInput]) {
    el.disabled = !enabled;
  }
}

async function openRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  root = handle;
  ui.rootName.textContent = handle.name;
  ui.newProject.disabled = false;
  ui.reload.disabled = false;
  await refreshProjectList();
  const last = localStorage.getItem(LAST_PROJECT_KEY);
  const names = Array.from(ui.projectSelect.options).map((o) => o.value);
  const target = last && names.includes(last) ? last : names[0];
  if (target) {
    await openProject(target);
  } else {
    logMessage(`「${handle.name}」にプロジェクトがありません。「新規プロジェクト」で作成してください`, "warn");
    ui.welcome.hidden = true;
    ui.editor.hidden = false;
  }
}

async function refreshProjectList(): Promise<void> {
  if (!root) {
    return;
  }
  const names = await listProjects(root);
  ui.projectSelect.replaceChildren(
    ...names.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    }),
  );
}

async function openProject(name: string): Promise<void> {
  if (!root) {
    return;
  }
  try {
    await flushWrites();
    const dir = await root.getDirectoryHandle(name);
    project = new ProjectDir(dir, name);
    manifest = await project.readManifest();
    currentIndex = manifest.chapters.length > 0 ? 0 : -1;
    lastWarnings = "";
    ui.projectSelect.value = name;
    localStorage.setItem(LAST_PROJECT_KEY, name);
    syncUiFromManifest();
    setProjectControlsEnabled(true);
    ui.welcome.hidden = true;
    ui.editor.hidden = false;
    await rebuild();
    await showChapterInEditor();
    renderOutput();
    logMessage(`プロジェクトを開きました: ${name}（章 ${manifest.chapters.length}）`);
  } catch (error) {
    logMessage(`プロジェクト「${name}」を開けませんでした: ${(error as Error).message}`, "error");
  }
}

async function reloadProject(): Promise<void> {
  if (!project) {
    return;
  }
  await flushWrites();
  project.invalidate();
  await refreshProjectList();
  await openProject(project.name);
}

async function pickRoot(): Promise<void> {
  try {
    const handle = await pickRootDirectory();
    await openRoot(handle);
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      logMessage(`保存フォルダを開けませんでした: ${(error as Error).message}`, "error");
    }
  }
}

async function reconnectSavedRoot(request: boolean): Promise<boolean> {
  try {
    const saved = await loadSavedRoot();
    if (!saved) {
      return false;
    }
    if (await ensurePermission(saved, request)) {
      await openRoot(saved);
      return true;
    }
    ui.welcomeReconnect.hidden = false;
    ui.rootName.textContent = `${saved.name}（再接続が必要）`;
    return false;
  } catch (error) {
    logMessage(`前回のフォルダに接続できませんでした: ${(error as Error).message}`, "warn");
    return false;
  }
}

async function submitNewProject(): Promise<void> {
  if (!root) {
    return;
  }
  const folder = ui.projectFolder.value.trim();
  const title = ui.projectTitle.value.trim();
  if (!folder || !title) {
    return;
  }
  try {
    await createProject(root, folder, title);
    await refreshProjectList();
    await openProject(folder);
    logMessage(`プロジェクトを作成しました: ${folder}`);
  } catch (error) {
    logMessage(`プロジェクトを作成できませんでした: ${(error as Error).message}`, "error");
  }
}

// ---- イベント登録 -----------------------------------------------------------------

function setupEvents(): void {
  setupFormatToolbar();
  ui.openRoot.addEventListener("click", () => void pickRoot());
  ui.welcomeOpen.addEventListener("click", () => void pickRoot());
  ui.welcomeReconnect.addEventListener("click", () => void reconnectSavedRoot(true));
  ui.projectSelect.addEventListener("change", () => void openProject(ui.projectSelect.value));
  ui.reload.addEventListener("click", () => void reloadProject());
  ui.newProject.addEventListener("click", () => {
    ui.projectFolder.value = "";
    ui.projectTitle.value = "";
    ui.projectDialog.showModal();
  });
  ui.projectCancel.addEventListener("click", () => ui.projectDialog.close());
  ui.projectDialog.querySelector("form")?.addEventListener("submit", () => void submitNewProject());

  ui.exportButton.addEventListener("click", () => void exportHtml());
  ui.printButton.addEventListener("click", printManual);

  for (const input of [ui.title, ui.subtitle, ui.author, ui.version, ui.date, ui.notes]) {
    input.addEventListener("input", syncManifestFromUi);
  }
  ui.book.addEventListener("change", syncManifestFromUi);
  ui.autoNumber.addEventListener("change", syncManifestFromUi);

  ui.appendChapter.addEventListener("click", () => void openInsertDialog(manifest?.chapters.length ?? 0));
  ui.insertKind.addEventListener("change", updateInsertFields);
  ui.insertCancel.addEventListener("click", () => ui.insertDialog.close());
  ui.insertDialog.querySelector("form")?.addEventListener("submit", () => void submitInsert());
  ui.coverElType.addEventListener("change", updateCoverDialogFields);
  ui.coverCancel.addEventListener("click", () => ui.coverDialog.close());
  ui.coverDialog.querySelector("form")?.addEventListener("submit", submitCoverElement);

  ui.fileInput.addEventListener("change", () => {
    if (ui.fileInput.files && ui.fileInput.files.length > 0) {
      void importFiles(Array.from(ui.fileInput.files)).finally(() => {
        ui.fileInput.value = "";
      });
    }
  });
  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("is-dragover");
  });
  ui.dropZone.addEventListener("dragleave", () => ui.dropZone.classList.remove("is-dragover"));
  ui.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("is-dragover");
    if (event.dataTransfer) {
      void collectDroppedFiles(event.dataTransfer)
        .then((files) => importFiles(files))
        .catch((error: Error) => logMessage(`ドロップの処理に失敗しました: ${error.message}`, "error"));
    }
  });

  ui.viewSourceButton.addEventListener("click", () => setCodeView("source"));
  ui.viewHtmlButton.addEventListener("click", () => setCodeView("html"));
  ui.togglePreview.addEventListener("change", () => {
    ui.previewPane.hidden = !ui.togglePreview.checked;
  });
  ui.previewMode.addEventListener("change", renderOutput);
  ui.syncToggle.addEventListener("change", () => {
    sync.enabled = ui.syncToggle.checked;
  });

  window.addEventListener("beforeunload", (event) => {
    if (pendingWrites.size > 0 || manifestDirty) {
      void flushWrites();
      event.preventDefault();
    }
  });
}

async function start(): Promise<void> {
  setupEvents();
  updateSaveStatus();
  if (!supportsFileSystemAccess()) {
    ui.welcomeUnsupported.hidden = false;
    ui.welcomeOpen.disabled = true;
    ui.openRoot.disabled = true;
    return;
  }
  await reconnectSavedRoot(false);
}

/** 自動テスト（scripts/e2e-smoke.mjs）から操作するための最小限のフック */
declare global {
  interface Window {
    manualBuilder: {
      appendSource(text: string): void;
      scrollSourceToEnd(): void;
      sourceText(): string;
      selectCover(): Promise<void>;
      dropAsset(name: string, clientX: number, clientY: number): void;
      applyFormat(fmt: string): void;
      selectRange(from: number, to: number): void;
    };
  }
}

window.manualBuilder = {
  appendSource(text) {
    const view = sourceEditor.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
  },
  scrollSourceToEnd() {
    const el = sourceEditor.view.scrollDOM;
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll"));
  },
  sourceText: () => sourceEditor.getText(),
  selectCover,
  applyFormat,
  selectRange(from, to) {
    sourceEditor.view.dispatch({ selection: { anchor: from, head: to } });
  },
  dropAsset(name, clientX, clientY) {
    const doc = ui.preview.contentDocument;
    if (doc) {
      dropAssetIntoPreview(doc, name, clientX, clientY);
    }
  },
};

start().catch((error: Error) => {
  console.error("[main] 初期化に失敗しました:", error);
  logMessage(`初期化に失敗しました: ${error.message}`, "error");
});
