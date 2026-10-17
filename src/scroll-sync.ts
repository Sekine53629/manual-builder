// ソース・HTML・プレビューの 3 ペインのスクロール位置を同期する。
// 位置は「ソースの行番号（小数）」を共通の座標にして変換する。
// 対応点（アンカー）が無い章では全体の割合で同期する
import type { PaneEditor } from "./editor-panes";

/** 出力 HTML 上の要素とソース行の対応点 */
export interface SyncAnchor {
  /** 出力要素の属性名（data-line / data-step） */
  attr: string;
  /** 属性の値 */
  value: string;
  /** 対応するソースの行（1 始まり） */
  line: number;
}

type Origin = "source" | "html" | "preview";

export interface Segment {
  /** ソース行 */
  line: number;
  /** 対象ペイン側の位置（HTML: 行番号、プレビュー: px） */
  pos: number;
}

const RELEASE_MS = 150;
/** 内容差し替え中にソース主導を固定しておく最長時間（iframe の読み込みが来なかった場合の保険） */
const CONTENT_UPDATE_LOCK_MS = 3000;

/** 単調増加の対応表で、from 側の値を他方へ線形補間する（範囲外は端の勾配で外挿） */
export function interpolate(segments: Segment[], line: number, from: "line" | "pos"): number {
  if (segments.length === 0) {
    return 0;
  }
  const key = from;
  const other = from === "line" ? "pos" : "line";
  if (segments.length === 1 || line <= segments[0][key]) {
    return segments[0][other] + (line - segments[0][key]) * (segments.length > 1 ? slope(segments[0], segments[1], key, other) : 0);
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    if (line >= a[key] && line <= b[key]) {
      const span = b[key] - a[key];
      const t = span > 0 ? (line - a[key]) / span : 0;
      return a[other] + t * (b[other] - a[other]);
    }
  }
  const a = segments[segments.length - 2];
  const b = segments[segments.length - 1];
  return b[other] + (line - b[key]) * slope(a, b, key, other);
}

function slope(a: Segment, b: Segment, key: "line" | "pos", other: "line" | "pos"): number {
  const span = b[key] - a[key];
  return span > 0 ? (b[other] - a[other]) / span : 0;
}

export class ScrollSync {
  enabled = true;
  private anchors: SyncAnchor[] = [];
  private htmlSegments: Segment[] = [];
  private active: Origin | undefined;
  private releaseTimer: number | undefined;

  constructor(
    private readonly source: PaneEditor,
    private readonly htmlView: PaneEditor,
    private readonly preview: HTMLIFrameElement,
  ) {}

  /** 対応点を更新する（ソース行の昇順に並べ替える） */
  setAnchors(anchors: SyncAnchor[]): void {
    this.anchors = [...anchors].sort((a, b) => a.line - b.line);
    this.rebuildHtmlSegments();
  }

  /** HTML 表示の内容が変わったら対応表を作り直す */
  rebuildHtmlSegments(): void {
    const segments: Segment[] = [];
    const text = this.htmlView.getText();
    const lines = text.split("\n");
    const byKey = new Map(this.anchors.map((a) => [`${a.attr}="${a.value}"`, a.line]));
    lines.forEach((content, i) => {
      for (const [key, line] of byKey) {
        if (content.includes(key)) {
          segments.push({ line, pos: i + 1 });
          byKey.delete(key);
          break;
        }
      }
    });
    this.htmlSegments = segments.sort((a, b) => a.line - b.line);
  }

  private previewSegments(): Segment[] {
    const doc = this.preview.contentDocument;
    const win = this.preview.contentWindow;
    if (!doc || !win) {
      return [];
    }
    const segments: Segment[] = [];
    for (const anchor of this.anchors) {
      const el = doc.querySelector<HTMLElement>(`[${anchor.attr}="${anchor.value}"]`);
      if (el) {
        segments.push({ line: anchor.line, pos: el.getBoundingClientRect().top + win.scrollY });
      }
    }
    return segments.sort((a, b) => a.line - b.line);
  }

  private claim(origin: Origin): boolean {
    if (!this.enabled) {
      return false;
    }
    if (this.active && this.active !== origin) {
      return false;
    }
    this.active = origin;
    window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      this.active = undefined;
    }, RELEASE_MS);
    return true;
  }

  private get hasAnchors(): boolean {
    return this.anchors.length > 0;
  }

  /** ソースがスクロールされた */
  fromSource(): void {
    if (!this.claim("source")) {
      return;
    }
    if (this.hasAnchors) {
      const p = this.source.topPosition();
      this.applyLine(p.line + p.fraction, "source");
    } else {
      this.applyRatio(this.source.scrollRatio(), "source");
    }
  }

  /** HTML 表示がスクロールされた */
  fromHtml(): void {
    if (!this.claim("html")) {
      return;
    }
    if (this.hasAnchors && this.htmlSegments.length > 0) {
      const p = this.htmlView.topPosition();
      const line = interpolate(this.htmlSegments, p.line + p.fraction, "pos");
      this.applyLine(line, "html");
    } else {
      this.applyRatio(this.htmlView.scrollRatio(), "html");
    }
  }

  /** プレビューがスクロールされた */
  fromPreview(): void {
    if (!this.claim("preview")) {
      return;
    }
    const win = this.preview.contentWindow;
    if (!win) {
      return;
    }
    const segments = this.previewSegments();
    if (this.hasAnchors && segments.length > 0) {
      const line = interpolate(segments, win.scrollY, "pos");
      this.applyLine(line, "preview");
    } else {
      const doc = win.document.documentElement;
      const max = doc.scrollHeight - win.innerHeight;
      this.applyRatio(max > 0 ? win.scrollY / max : 0, "preview");
    }
  }

  /**
   * HTML 表示やプレビューの内容を差し替える前に呼ぶ。
   * 差し替えに伴って発生するスクロールイベントがソースを動かさないよう、ソース主導に固定する。
   * 固定は syncFromSourceNow() か一定時間後に解除される
   */
  beginContentUpdate(): void {
    this.active = "source";
    window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      this.active = undefined;
    }, CONTENT_UPDATE_LOCK_MS);
  }

  /** ソースの位置に他のペインを合わせる（プレビュー再描画後などに呼ぶ） */
  syncFromSourceNow(): void {
    this.active = undefined;
    this.fromSource();
  }

  private applyLine(line: number, origin: Origin): void {
    if (origin !== "source") {
      const whole = Math.floor(line);
      this.source.scrollToPosition({ line: whole, fraction: line - whole });
    }
    if (origin !== "html" && this.htmlSegments.length > 0) {
      const pos = interpolate(this.htmlSegments, line, "line");
      const whole = Math.floor(pos);
      this.htmlView.scrollToPosition({ line: Math.max(1, whole), fraction: Math.max(0, pos - whole) });
    }
    if (origin !== "preview") {
      const win = this.preview.contentWindow;
      const segments = this.previewSegments();
      if (win && segments.length > 0) {
        win.scrollTo({ top: Math.max(0, interpolate(segments, line, "line")) });
      }
    }
  }

  private applyRatio(ratio: number, origin: Origin): void {
    if (origin !== "source") {
      this.source.setScrollRatio(ratio);
    }
    if (origin !== "html") {
      this.htmlView.setScrollRatio(ratio);
    }
    if (origin !== "preview") {
      const win = this.preview.contentWindow;
      if (win) {
        const max = win.document.documentElement.scrollHeight - win.innerHeight;
        win.scrollTo({ top: Math.max(0, ratio * max) });
      }
    }
  }
}
