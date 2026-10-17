// CodeMirror 6 のラッパー：ソース（Markdown / JSON）と HTML 表示の 2 つのエディタに共通の操作を提供する
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";

export type EditorLanguage = "markdown" | "json" | "html" | "text";

export interface PaneEditorOptions {
  language: EditorLanguage;
  readOnly?: boolean;
  onChange?: (text: string) => void;
  onScroll?: () => void;
  /** 素材（ASSET_DRAG_TYPE）がドロップされたときに挿入する文字列を返す。undefined なら既定のドロップ処理 */
  assetDropText?: (name: string) => string | undefined;
}

/** 素材一覧からのドラッグで使う dataTransfer の種類 */
export const ASSET_DRAG_TYPE = "application/x-mb-asset";

/** スクロール位置を「先頭に見えている行 + 行内の割合」で表す */
export interface LinePosition {
  line: number;
  fraction: number;
}

function languageExtension(language: EditorLanguage) {
  switch (language) {
    case "markdown":
      return markdown();
    case "json":
      return json();
    case "html":
      return html();
    default:
      return [];
  }
}

export class PaneEditor {
  readonly view: EditorView;
  private readonly languageCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private suppressChange = false;

  constructor(parent: HTMLElement, options: PaneEditorOptions) {
    const readOnly = options.readOnly === true;
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "",
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          this.languageCompartment.of(languageExtension(options.language)),
          this.readOnlyCompartment.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.suppressChange && options.onChange) {
              options.onChange(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            dragover: (event) => {
              if (event.dataTransfer?.types.includes(ASSET_DRAG_TYPE)) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            drop: (event, view) => {
              const name = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
              if (!name || !options.assetDropText) {
                return false;
              }
              const text = options.assetDropText(name);
              if (text === undefined) {
                return false;
              }
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length;
              view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
              view.focus();
              return true;
            },
          }),
        ],
      }),
    });
    if (options.onScroll) {
      this.view.scrollDOM.addEventListener("scroll", options.onScroll, { passive: true });
    }
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  /** 内容を丸ごと差し替える（onChange は呼ばない） */
  setText(text: string): void {
    if (text === this.getText()) {
      return;
    }
    this.suppressChange = true;
    try {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    } finally {
      this.suppressChange = false;
    }
  }

  setLanguage(language: EditorLanguage): void {
    this.view.dispatch({ effects: this.languageCompartment.reconfigure(languageExtension(language)) });
  }

  setReadOnly(readOnly: boolean): void {
    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }

  get lineCount(): number {
    return this.view.state.doc.lines;
  }

  /** いま先頭に見えている行（1 始まり）と、その行内でのスクロール割合 */
  topPosition(): LinePosition {
    const top = this.view.scrollDOM.scrollTop - this.view.documentPadding.top;
    if (top <= 0) {
      return { line: 1, fraction: 0 };
    }
    const block = this.view.lineBlockAtHeight(top);
    const line = this.view.state.doc.lineAt(block.from).number;
    const fraction = block.height > 0 ? Math.min(1, Math.max(0, (top - block.top) / block.height)) : 0;
    return { line, fraction };
  }

  /** 指定の行が先頭に来るようにスクロールする */
  scrollToPosition(position: LinePosition): void {
    const lineNo = Math.min(Math.max(1, Math.round(position.line)), this.lineCount);
    const line = this.view.state.doc.line(lineNo);
    const block = this.view.lineBlockAt(line.from);
    this.view.scrollDOM.scrollTop = block.top + position.fraction * block.height + this.view.documentPadding.top;
  }

  /** 全体に対するスクロール割合（0〜1）。行の対応が取れない章の同期に使う */
  scrollRatio(): number {
    const el = this.view.scrollDOM;
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  }

  setScrollRatio(ratio: number): void {
    const el = this.view.scrollDOM;
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  }

  focus(): void {
    this.view.focus();
  }

  /** カーソル位置（選択範囲）に文字列を挿入する */
  insertAtCursor(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    this.view.focus();
  }

  /** 選択範囲を before / after で囲む。選択が無ければ placeholder を囲んで選択状態にする */
  wrapSelection(before: string, after: string, placeholder = "テキスト"): void {
    const { from, to } = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(from, to);
    const inner = selected || placeholder;
    this.view.dispatch({
      changes: { from, to, insert: `${before}${inner}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + inner.length },
    });
    this.view.focus();
  }

  /** 選択範囲にかかる各行の先頭に prefix を付ける（番号付きは n. を振る） */
  prefixLines(prefix: string | ((index: number) => string)): void {
    const { from, to } = this.view.state.selection.main;
    const doc = this.view.state.doc;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    const changes = [];
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      const p = typeof prefix === "function" ? prefix(n - first) : prefix;
      changes.push({ from: line.from, insert: p });
    }
    this.view.dispatch({ changes });
    this.view.focus();
  }

  /** カーソル行の直後に段落（前後に空行）を挿入する */
  insertBlock(text: string): void {
    const { to } = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(to);
    const insert = `\n\n${text}\n`;
    this.view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 2 + text.length } });
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
