# CLAUDE.md — manual-builder (Tier 3)

Inherits Tier 1 (`GitHub/CLAUDE.md`) and Tier 2 (`GitHub/JavaScript/CLAUDE.md`).

## Purpose

Browser app (Chrome / Edge) that edits and assembles a **distributable single-file HTML manual** from
a project folder: `manual.json` + Markdown chapters + step-by-step JSON + a menu-catalog JSON + PNG/SVG
assets. The folder is read and written directly through the File System Access API; nothing is uploaded.
A three-pane editor (source / generated HTML / preview) keeps scroll positions in sync. A Node CLI
(`scripts/build-cli.ts`) builds the same HTML from the same folder. The reference output is the PDF
manual set in `input/reference/pdf/`. Decision records: `docs/adr/0001-…`, `0002-…`, `0003-…`.

## Stack

- Vite + TypeScript (strict), ES modules, no framework; CodeMirror 6 for the editors
- `marked` (Markdown → HTML), `dompurify` (sanitizing Markdown output, SVG and generated HTML)
- Vitest + jsdom for unit tests (`tests/`), covering `src/core/` and `src/scroll-sync.ts`
- `scripts/e2e-smoke.mjs`: headless Chrome via DevTools Protocol with an in-memory fake directory handle
- CLI bundle: `vite build --ssr scripts/build-cli.ts --outDir .cli` (jsdom supplies the DOM)
- Dependencies are pinned exactly; `package-lock.json` is committed

## Layout and Responsibilities

| Path | Role | Rule |
|---|---|---|
| `src/core/` | Assembly logic: project (manifest → Manual, group numbering), types, markdown, catalog (refs → chips), steps, catalog-page, cover (cover.json → cover page), manual (inlining, chips, line markers, heading ids), export | **Must not touch `document`, `window` globals or the UI.** `DOMParser` is allowed; DOMPurify is obtained via `purifier()`. File access only through the `ProjectFiles` interface. |
| `src/main.ts` | UI: project selection, chapter list (insert / reorder / groups), code pane (source / HTML tabs) + preview, asset list (drag to preview/source), format toolbar (wraps the CodeMirror selection; non-Markdown styling is inline HTML such as `<u>` / `<span style>`), figure and cover drag editing in the preview, import into the project folder, export, print. Rebuild and autosave are deferred while `view.composing` (IME); the preview iframe is updated in place (`updatePreview`), never reloaded after the first load | Only place that reads DOM elements by id. Exposes `window.manualBuilder` (tiny hook for the e2e test) |
| `src/project-store.ts` | File System Access API: root handle, project listing/creation, `ProjectDir` (cached `ProjectFiles` + writes) | Browser only |
| `src/editor-panes.ts` / `src/scroll-sync.ts` | CodeMirror wrapper; line-based scroll sync between panes | `interpolate()` is unit-tested |
| `src/storage.ts` | Settings (root handle) in IndexedDB | Browser only |
| `scripts/build-cli.ts` | CLI: `manual.json` → HTML, using `src/core/` | Node only; installs jsdom globals before rendering |
| `scripts/serve-local.ps1` + `start-local.cmd` | Zero-install local static server (PowerShell `TcpListener`) bundled with the deploy zips | Needed because Chrome refuses File System Access **writes** from `file://` pages ("Aborted due to security policy"); reads work. Always open the editor over `http://localhost` or HTTPS |
| `src/styles/manual.css` | Embedded in the exported manual (screen + print, A4) | Imported via `?raw`; self-contained (no `@import`, no URLs). Based on `input/styles/manual.css` |
| `projects/` | Save folder. `projects/sample/` is the committed generic sample; everything else is git-ignored (confidential) | Project layout: `manual.json`, `cover.json` (optional), `chapters/`, `images/`, `catalog/`, `output/` (`PROJECT_LAYOUT`) |
| `input/` | User-provided originals (not committed, read-only) | Never edit. Real materials are copied (not moved) into a git-ignored project under `projects/` |
| `output/` | Temporary generated files (not committed) | Distributed manuals go to `archive/dist/` per Tier 1 |

## Conventions

- `manual.json` is the CLI manifest (`Manifest` in `core/project.ts`); the browser treats it as the source of
  truth and re-assembles the `Manual` through `assembleManual()` after every change. Chapter indexes in
  `manifest.chapters` and the assembled chapters always line up (failed loads become placeholder chapters).
- Three chapter kinds (`Chapter.kind`): `markdown`, `steps` (JSON with `title` + `steps[]`), `catalog`
  (generated from `catalog/menus.json` + `menu-tree.txt`). Detect JSON kind with `isMenuCatalog()` / `isStepsData()`.
- Groups: `chapter.group` holds the bare name; `computeGroupLabels()` adds `第N章 ` when `autoNumberGroups`
  is on (existing `第N章` prefixes are stripped). Consecutive chapters with the same name form one group.
- Chip references: `m_<menu>:<KEY>` → menu item, `s:<画面名>:<KEY>` → screen key; `resolveRef()` in
  `catalog.ts` is the single resolution rule. `m_tabs` → `.chip.tab`, `m_zaiko_tabs` → `.chip.ztab`.
- Figures and images are referenced by **file name only** (`imageKey()`). Figure layout lives in the Markdown as
  `![alt](src){w=80 mt=6 ml=10 p=3 align=left}` (mm); `figure-layout.ts` moves it into the image URL hash before marked,
  `manual.ts` applies it as inline style on `figure.manual-figure` (plus `data-fig` / `data-fig-layout` in sourceMap mode),
  and the editor writes it back with `rewriteImageAttrs()`.
- Markdown: front matter `title`/`subtitle` → `<h1>` + `<p class="sub">`; `[[chips:...]]` on its own line
  → placeholder replaced after sanitizing; `normalizeStrong()` makes `**…」**に` bold; `breaks: true`.
- Source map for the editor: `renderChapter(…, { sourceMap: true })` emits `data-line` (Markdown blocks, source
  line numbers including front matter offset) and `data-step` (steps). Exports never include them.
- Cover: `cover.json` (`CoverDesign`, elements in **mm** on an A4 page) rendered by `renderCover()`; missing file → `defaultCoverDesign()`.
  Editable preview adds `data-el`; drag/resize handlers live in `main.ts` (`enableCoverEditing`) and write back through `commitCoverDesign()`. Exports never contain `data-el`.
- Heading ids are `c{chapter}-{n}`, chapter anchors `d{n}`.
- Everything that ends up in the exported HTML goes through DOMPurify first. Never concatenate raw user input.
- Errors: core functions log with `[functionName]` prefix and rethrow; `main.ts` turns them into message-list
  entries. No silent catches.
- Exported file: `output/<project folder name>_<YYYYMMDD>.html` inside the project; the document `<title>` is set to the folder name too (`ExportOptions.documentTitle`) so "Save as PDF" defaults to the same name.

## Commands

```
npm run dev        # dev server
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # dist/
npm run build:single  # dist/manual-builder.html (single-file edition, opens from file://)
npm run build:cli  # .cli/build-cli.js
node .cli/build-cli.js projects/<name>/manual.json [out.html]
npm run e2e        # headless Chrome smoke test (needs: npm run build && npx vite preview --port 4173)
```

Run `npm test` and `npm run typecheck` before committing; run `npm run e2e` after UI changes.
To compare against the reference PDFs, build with the CLI and print with headless Chrome
(`--headless=new --print-to-pdf=…`), then view the PDF pages.

## Documents

- `docs/requirements.md` — requirement list with status; update the 状態 column when a feature lands
- `docs/adr/` — one ADR per architectural decision (Tier 1 rules apply)
- Managed documents follow Tier 1 "Document Version Management" (archive before revising)
