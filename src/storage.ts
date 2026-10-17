// アプリ設定（保存フォルダのハンドルなど）を IndexedDB に保存・復元する
const DB_NAME = "manual-builder";
const DB_VERSION = 2;
const SETTINGS_STORE = "settings";
/** 旧版（素材をブラウザ内に保存していた頃）のストア。互換のため残す */
const LEGACY_STATE_STORE = "state";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [SETTINGS_STORE, LEGACY_STATE_STORE]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB を開けません"));
  });
}

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, mode);
        const request = action(tx.objectStore(SETTINGS_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB の操作に失敗しました"));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(value, key));
  } catch (error) {
    console.error(`[saveSetting] ${key} の保存に失敗しました:`, error);
    throw error;
  }
}

export async function loadSetting<T>(key: string): Promise<T | undefined> {
  try {
    const value = await withStore<T | undefined>("readonly", (store) => store.get(key));
    return value ?? undefined;
  } catch (error) {
    console.error(`[loadSetting] ${key} の読み込みに失敗しました:`, error);
    throw error;
  }
}

export async function deleteSetting(key: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(key));
  } catch (error) {
    console.error(`[deleteSetting] ${key} の削除に失敗しました:`, error);
    throw error;
  }
}
