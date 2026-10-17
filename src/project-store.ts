// 保存フォルダ（File System Access API）とプロジェクトフォルダの読み書き
import {
  PROJECT_LAYOUT,
  createDefaultManifest,
  imageMimeType,
  isManifest,
  type Manifest,
  type ProjectFiles,
} from "./core/project";
import { stripBom } from "./core/markdown";
import { loadSetting, saveSetting } from "./storage";

const ROOT_HANDLE_KEY = "rootHandle";
const PICKER_ID = "manual-builder-root";

export function supportsFileSystemAccess(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

/** 保存フォルダを選ばせ、次回のために記憶する */
export async function pickRootDirectory(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: "readwrite" });
  await saveSetting(ROOT_HANDLE_KEY, handle);
  return handle;
}

export async function loadSavedRoot(): Promise<FileSystemDirectoryHandle | undefined> {
  return loadSetting<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
}

/** 読み書き権限があるか。request=true のときはユーザー操作中に権限を求める */
export async function ensurePermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await handle.queryPermission(descriptor)) === "granted") {
    return true;
  }
  if (!request) {
    return false;
  }
  return (await handle.requestPermission(descriptor)) === "granted";
}

/** manual.json を持つサブフォルダ名を列挙する */
export async function listProjects(root: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory") {
      try {
        await handle.getFileHandle(PROJECT_LAYOUT.manifest);
        names.push(name);
      } catch {
        // manual.json が無いフォルダはプロジェクトではない
      }
    }
  }
  return names.sort((a, b) => a.localeCompare(b, "ja"));
}

/** 新しいプロジェクトフォルダ（標準構成 + manual.json）を作る */
export async function createProject(root: FileSystemDirectoryHandle, name: string, title: string): Promise<ProjectDir> {
  const dir = await root.getDirectoryHandle(name, { create: true });
  for (const sub of [PROJECT_LAYOUT.chapters, PROJECT_LAYOUT.images, PROJECT_LAYOUT.catalog, PROJECT_LAYOUT.output]) {
    await dir.getDirectoryHandle(sub, { create: true });
  }
  const project = new ProjectDir(dir, name);
  if (!(await project.exists(PROJECT_LAYOUT.manifest))) {
    await project.writeManifest(createDefaultManifest(title));
  }
  return project;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((p) => p && p !== ".");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

/**
 * 1 つのプロジェクトフォルダ。ProjectFiles として core に渡す。
 * 読んだテキストと画像はキャッシュし、エディタで編集中の内容は setCachedText で差し替える
 */
export class ProjectDir implements ProjectFiles {
  private textCache = new Map<string, string>();
  private dataUriCache = new Map<string, string>();

  constructor(
    readonly handle: FileSystemDirectoryHandle,
    readonly name: string,
  ) {}

  private async getDirectory(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = this.handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  private async getFile(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = splitPath(path);
    const fileName = parts.pop();
    if (!fileName) {
      throw new Error(`ファイル名がありません: ${path}`);
    }
    const dir = await this.getDirectory(parts, create);
    return dir.getFileHandle(fileName, { create });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getFile(path, false);
      return true;
    } catch {
      return false;
    }
  }

  async readText(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const file = await (await this.getFile(path, false)).getFile();
    const text = stripBom(await file.text());
    this.textCache.set(path, text);
    return text;
  }

  async readDataUri(path: string): Promise<string> {
    const cached = this.dataUriCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const file = await (await this.getFile(path, false)).getFile();
    let dataUri = await readFileAsDataUrl(file);
    // ブラウザが MIME を判定できなかった場合は拡張子から補う
    const mime = imageMimeType(path);
    if (mime && dataUri.startsWith("data:application/octet-stream")) {
      dataUri = dataUri.replace("data:application/octet-stream", `data:${mime}`);
    }
    this.dataUriCache.set(path, dataUri);
    return dataUri;
  }

  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await this.getDirectory(splitPath(dir), false);
    } catch {
      return out;
    }
    const prefix = splitPath(dir).join("/");
    await this.walk(handle, prefix, out);
    return out.sort((a, b) => a.localeCompare(b, "ja"));
  }

  private async walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === "directory") {
        await this.walk(entry, path, out);
      } else {
        out.push(path);
      }
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    try {
      const file = await this.getFile(path, true);
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
      this.textCache.set(path, text);
    } catch (error) {
      console.error(`[ProjectDir.writeText] ${path} の書き込みに失敗しました:`, error);
      throw error;
    }
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    try {
      const file = await this.getFile(path, true);
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      this.dataUriCache.delete(path);
      this.textCache.delete(path);
    } catch (error) {
      console.error(`[ProjectDir.writeBlob] ${path} の書き込みに失敗しました:`, error);
      throw error;
    }
  }

  /** エディタで編集中の内容をキャッシュに反映する（ファイルにはまだ書かない） */
  setCachedText(path: string, text: string): void {
    this.textCache.set(path, text);
  }

  /** キャッシュを捨てて次回はディスクから読み直す */
  invalidate(): void {
    this.textCache.clear();
    this.dataUriCache.clear();
  }

  async readManifest(): Promise<Manifest> {
    const value: unknown = JSON.parse(await this.readText(PROJECT_LAYOUT.manifest));
    if (!isManifest(value)) {
      throw new Error(`${PROJECT_LAYOUT.manifest} が manifest（title + chapters）の形式ではありません`);
    }
    return value;
  }

  async writeManifest(manifest: Manifest): Promise<void> {
    await this.writeText(PROJECT_LAYOUT.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  /** chapters/ にあって manifest に載っていないファイル */
  async unusedChapterFiles(manifest: Manifest): Promise<string[]> {
    const used = new Set(manifest.chapters.map((c) => c.file));
    const files = await this.list(PROJECT_LAYOUT.chapters);
    return files.filter((f) => /\.(md|markdown|json)$/i.test(f) && !used.has(f));
  }
}
