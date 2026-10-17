# Manual Builder

Markdown（原稿）・手順 JSON・メニュー定義 JSON・SVG/PNG（図・絵柄）から、
配布用の **単一 HTML マニュアル** を組み立てるブラウザアプリです。
素材は PC 上の「保存フォルダ」にプロジェクトごとのフォルダとして置き、ブラウザ（Chrome / Edge）から直接読み書きします。
サーバーは不要で、ファイルが外部に送られることはありません。

既存の PDF 版マニュアル（統合版）と同じ見た目・構成を、同じ素材から再現することを目標にしています。

## できること

- **プロジェクトフォルダ**: `manual.json`（マニュアル情報・章の並び）+ `chapters/` + `images/` + `catalog/` + `output/` という
  Web サイト風の構成。複数のマニュアルを切り替えられる。[projects/README.md](projects/README.md) 参照
- **エディタ**: コードペイン（Markdown / 手順 JSON のソースと、生成 HTML をタブで切り替え）とプレビューを横並びで表示し、
  スクロール位置を同期（Markdown はブロック単位、手順 JSON は手順単位で対応）。編集は自動でファイルに保存。
  IME 変換中はプレビューを更新せず、プレビューは再読込ではなく中身の差し替えで更新する
- **章の挿入と章番号の振り直し**: 章一覧の任意の位置に挿入・並べ替え。グループ（第N章）は並び順で自動採番
- **書式ツールバー**: Markdown のソースに、太字・斜体・下線・取り消し線・文字色（色見本と自由な色）・マーカー・フォント（ゴシック／明朝／等幅）・文字サイズ・見出し・箇条書き・引用・コード・チップ・表・出典行をボタンで入れられる。
  Markdown に無い装飾は `<u>` や `<span style="color:…">` のインライン HTML として原稿に書かれる
- **図の配置**: 本文中の図（SVG / PNG）をプレビュー上でつかんで、上からの位置（上余白）・左位置・幅を変更。選択時のツールバーで寄せ（左・中央・右）と内側の余白も変えられる。
  配置は原稿の画像記法の直後に `{w=80 mt=6 ml=10 p=3 align=left}`（mm）として書き戻されるので、原稿が正のまま
- **素材一覧からのドラッグ＆ドロップ**: 左ペインに `images/` の素材がサムネイルで並び、プレビューやソースへ落とすとその位置に図を差し込む（表紙なら画像要素を追加、手順 JSON ならその手順の画像に追加）
- **表紙デザイン**: 章一覧の先頭「表紙」で、A4 ページ上の要素（テキスト・画像・帯・収録内容）をプレビュー上でドラッグして配置。
  位置は mm で `cover.json` に保存され、印刷と一致する。`{title}` `{author}` `{date}` などのプレースホルダが使える。
  ページや帯の `background` には CSS の値がそのまま書けるので、`linear-gradient(180deg, #61BEBE 0%, #5AB279 100%)` のようなグラデーションも使える
- **原稿（.md）**: front matter の `title` / `subtitle` が章タイトルとサブタイトル行になる。
  `[[chips:m_tabs:F10, m_option1:F1]]` はボタンの並び（チップ）に、`![説明](図.svg)` / `![説明](画面.png)` は図・画像の埋め込みになる。
  クラス付き `div` の生 HTML（フロー図・出典行）も通る
- **手順（.json、`title` + `steps[]`）**: 「使う場面」「注意」「番号付き手順＋チップ＋画像」のページになる
- **メニュー定義（catalog/menus.json）**: チップの解決表。「メニュー構成とアイコン一覧」の章を自動生成する
- **単体出力**（章内目次付き）と **統合版出力**（表紙・全体目次・章バッジ・章ごとの改ページ）
- プレビュー、印刷（PDF 保存）、`output/<マニュアル名>_<YYYYMMDD>.html` への書き出し
- CLI（Node）で同じフォルダから同じ HTML を一括生成

## 配布形態（2 つの版）

| 版 | 入手方法 | 必要なもの |
|---|---|---|
| **単一ファイル版（オフライン）** | [Releases](https://github.com/Sekine53629/manual-builder/releases) の `editor-standalone_<日付>.zip` を展開し、`start-local.cmd` をダブルクリック（PowerShell のローカルサーバーが `http://localhost:8790/` で開く） | Chrome / Edge と Windows 標準の PowerShell。Node・外部サーバー・インストール不要 |
| **公開サイト版** | https://sekine53629.github.io/manual-builder/ を開く | Chrome / Edge とインターネット接続 |

どちらも中身は同じで、素材（`projects/`）は各自の PC のフォルダに置いたまま使います。社内で配るなら単一ファイル版の zip をファイルサーバーやメールで渡すだけで済みます。

**注意**: `manual-builder.html` を直接ダブルクリック（`file://`）で開くと、閲覧と読み込みはできますが、ブラウザのセキュリティポリシーで**ファイルの保存が拒否されます**（`Aborted due to security policy`）。編集・書き出しをするときは `start-local.cmd` から `http://localhost` で開いてください。

## セットアップ（開発する場合）

Node.js 18 以上が必要です。利用するだけなら不要です。

```powershell
cd JavaScript\manual-builder
npm install
```

## 使い方（ブラウザ）

```powershell
npm run dev        # 開発サーバを起動（表示された URL を Chrome / Edge で開く）
```

1. 「保存フォルダを開く」でこのリポジトリの `projects/` を選ぶ（初回だけ。次回からは「前回のフォルダに再接続」）
2. プロジェクトを選ぶ（`sample` が入っています）か、「新規プロジェクト」で作る
3. 左の章一覧から章をクリックすると、ソース・HTML・プレビューの 3 ペインに表示される。ソースを編集すると自動保存され、プレビューが更新される
4. 「＋」で章を挿入、↑↓ で並べ替え、グループ名を入れると「第N章」が並び順で振られる（マニュアル情報の「自動採番」）
   - 本文中の図はプレビューでドラッグ（上下＝上余白、左右＝左位置）、右下のつまみで幅、ツールバーで寄せと内側の余白。原稿には `![説明](図.svg){w=80 mt=6}` のように残る
   - 左ペインの素材一覧から図をプレビューへドラッグ＆ドロップすると、その位置に差し込まれる
   - 章一覧の先頭「表紙」をクリックすると表紙デザイン。要素をドラッグで移動、右下のつまみで幅変更、「＋」で画像・テキスト・帯を追加、要素を選んで Delete で削除。色や文字サイズはソース（cover.json）で編集
5. 素材（.md / .json / .png / .svg / .txt）はドロップゾーンに落とすとプロジェクトフォルダに保存される
6. 「HTML を書き出す」で `output/` に保存、「印刷 / PDF」でブラウザの印刷ダイアログ

手元のエディタで `chapters/*.md` を直接編集してもかまいません。アプリ側は「再読込」で読み直します。

## 使い方（CLI）

```powershell
npm run build:cli                                        # scripts/build-cli.ts → .cli/build-cli.js
node .cli/build-cli.js projects/sample/manual.json       # → projects/sample/output/<title>_<date>.html
node .cli/build-cli.js projects/sample/manual.json out.html
```

`manual.json` の主な項目:

| 項目 | 内容 |
|---|---|
| `title` / `subtitle` / `author` / `version` / `revisedOn` / `coverNotes[]` / `book` | マニュアル情報。`book: true` で統合版 |
| `autoNumberGroups` | グループ名に「第N章 」を並び順で自動付与 |
| `catalog` / `menuTree` | メニュー定義 JSON とツリー表示テキストのパス（manual.json からの相対） |
| `cover` | 表紙デザイン JSON のパス（既定 `cover.json`。無ければ従来の表紙） |
| `catalogMeta` | カタログ章の `title` / `sub` / `intro` / `pending[]` / `pendingNote` |
| `menus.<id>` | メニューごとの `heading` / `intro` の上書き |
| `images[]` | 画像（PNG・SVG）を再帰的に読むフォルダ（既定 `images`） |
| `chapters[]` | 章の並び。`file` は `chapters/xxx.md` / `chapters/xxx.json` / `"catalog"`。`group`、`title`（表示タイトル）、手順の `source` / `sub` を補える |

PDF にするには、生成した HTML を Chrome で開いて印刷（A4）するか、次のコマンドを使います。

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="C:\path\to\out.pdf" "file:///C:/path/to/out.html"
```

### 配布用ビルドとデプロイ

```powershell
npm run build          # dist/ に静的ファイルを出力（公開サイト版）
npm run build:single   # dist/manual-builder.html に 1 ファイルへまとめる（単一ファイル版）
npm run preview        # ビルド結果を確認
npm run package        # output/deploy/ に editor-standalone / editor / editor-with-projects の zip を作る
```

`dist/` の分割ビルドは ES モジュールを使うため `file://` では開けません。`dist/manual-builder.html`（単一ファイル版）は `file://` でも開けますが保存ができないため、
同梱の `start-local.cmd`（[scripts/serve-local.ps1](scripts/serve-local.ps1)）で `http://localhost` から開きます。公開サイト版は HTTPS で配信してください。

- **GitHub Pages**: `main` への push で [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) がテスト・ビルドを行い、エディタ本体を Pages に公開します。
  公開されるのはエディタだけで、マニュアルの素材（`projects/`）は各自の PC のフォルダに置いたまま使います
- **手元のサーバー**: `editor_<日付>.zip` の `app/` を静的サーバーのフォルダに置きます。`editor-with-projects_<日付>.zip` は PC 間の移行用で、素材フォルダも同梱します（公開しないでください）

## 開発

```powershell
npm test           # ユニットテスト（Vitest + jsdom）
npm run typecheck  # TypeScript 型チェック
npm run e2e        # ヘッドレス Chrome でアプリを操作するスモークテスト（npm run build && npx vite preview --port 4173 を起動しておく）
```

```
manual-builder/
├── index.html              ← アプリ画面
├── src/
│   ├── main.ts             ← UI（プロジェクト・章一覧・3 ペイン・書き出し）
│   ├── project-store.ts    ← 保存フォルダ（File System Access API）の読み書き
│   ├── editor-panes.ts     ← CodeMirror 6 のラッパー
│   ├── scroll-sync.ts      ← 3 ペインのスクロール同期
│   ├── storage.ts          ← 設定（フォルダのハンドル）の保存（IndexedDB）
│   ├── core/               ← 組み立てロジック（UI 非依存。CLI と共用）
│   │   ├── project.ts      ← manual.json（manifest）→ Manual、グループの採番、ひな形
│   │   ├── types.ts        ← Manual / Chapter（markdown・steps・catalog）/ Figure / ImageAsset
│   │   ├── markdown.ts     ← front matter、[[chips]] 前処理、強調の正規化、行番号マーカー、marked + DOMPurify
│   │   ├── catalog.ts      ← メニュー定義の型、参照名の解決、チップ HTML
│   │   ├── steps.ts        ← 手順 JSON → HTML
│   │   ├── catalog-page.ts ← メニュー定義 → 「メニュー構成とアイコン一覧」章
│   │   ├── manual.ts       ← 章の変換・図と画像の差し込み・チップ差し替え・見出し ID
│   │   ├── cover.ts        ← 表紙デザイン（cover.json）→ HTML
│   │   ├── figure-layout.ts← 図の配置属性 {w= mt= ml= p= align=} の解析・反映・書き戻し
│   │   ├── export.ts       ← 単体／統合版／章プレビュー／表紙プレビューの HTML 組み立て
│   │   ├── svg.ts          ← SVG のサニタイズ
│   │   └── html.ts         ← エスケープなどの共通処理
│   └── styles/
│       ├── app.css         ← アプリ画面
│       └── manual.css      ← 出力マニュアル（画面・印刷 A4）
├── scripts/
│   ├── build-cli.ts        ← CLI（manual.json → HTML）
│   └── e2e-smoke.mjs       ← ヘッドレス Chrome のスモークテスト
├── tests/                  ← core と同期ロジックのテスト
├── projects/               ← 保存フォルダ（sample のみ Git 管理）
├── docs/                   ← 要件定義書、ADR
├── input/                  ← 素材の原本置き場（Git 管理外・読み取り専用）
└── output/                 ← 生成物の一時置き場（Git 管理外）
```

## 関連文書

- [要件定義書](docs/requirements.md)
- [ADR 0001: ブラウザ単体アプリで組み立て、単一 HTML を出力する](docs/adr/0001-browser-app-single-html-output.md)
- [ADR 0002: 素材を 3 種類に分け、操作経路は参照名で解決する](docs/adr/0002-source-kinds-and-chip-references.md)
- [ADR 0003: 素材はプロジェクトフォルダに保存し、ブラウザから直接読み書きする](docs/adr/0003-project-folder-and-three-pane-editor.md)
- [ADR 0004: 表紙は mm 座標の要素リストで持ち、プレビュー上で直接動かす](docs/adr/0004-cover-design-elements.md)
