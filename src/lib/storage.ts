/**
 * 数据存储：记录和背标照片都放 IndexedDB（额度跟着手机剩余空间走，几百 MB 起步），
 * localStorage 只留一份不含照片的轻量镜像，作为读不到数据库时的兜底。
 *
 * 早期版本把压缩照片直接塞在记录里写进 localStorage，5MB 一满新记录就落不了盘，
 * 所以这里做了无缝迁移：启动时读完数据、把内联照片搬进照片仓库，再写回数据库。
 */
export const MIRROR_KEY = 'expiry-keeper:v1';

const DB_NAME = 'expiry-keeper';
const DB_VERSION = 1;
const STATE_STORE = 'state';
const PHOTO_STORE = 'photos';
const STATE_KEY = 'snapshot';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  if (!hasIndexedDb()) return Promise.resolve(undefined);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
          if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }
  return dbPromise;
}

function runTransaction<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest | void,
): Promise<{ ok: boolean; value?: T }> {
  return openDb().then((db) => {
    if (!db) return { ok: false };
    return new Promise<{ ok: boolean; value?: T }>((resolve) => {
      try {
        const transaction = db.transaction(store, mode);
        const request = work(transaction.objectStore(store));
        let result: T | undefined;
        if (request) {
          request.onsuccess = () => {
            result = request.result as T;
          };
        }
        transaction.oncomplete = () => resolve({ ok: true, value: result });
        transaction.onerror = () => resolve({ ok: false });
        transaction.onabort = () => resolve({ ok: false });
      } catch {
        resolve({ ok: false });
      }
    });
  });
}

/** 读整份数据（记录 + 设置 + 厂家名单） */
export async function readState<T>(): Promise<T | undefined> {
  const { ok, value } = await runTransaction<T>(STATE_STORE, 'readonly', (store) => store.get(STATE_KEY));
  return ok ? value : undefined;
}

/** 写整份数据；写不进去返回 false，由调用方决定怎么提示 */
export async function writeState(value: unknown): Promise<boolean> {
  const { ok } = await runTransaction(STATE_STORE, 'readwrite', (store) => store.put(value, STATE_KEY));
  return ok;
}

export async function clearState(): Promise<void> {
  await runTransaction(STATE_STORE, 'readwrite', (store) => store.clear());
}

export async function putPhoto(id: string, dataUrl: string): Promise<boolean> {
  const { ok } = await runTransaction(PHOTO_STORE, 'readwrite', (store) => store.put(dataUrl, id));
  return ok;
}

export async function getPhoto(id: string): Promise<string | undefined> {
  const { ok, value } = await runTransaction<string>(PHOTO_STORE, 'readonly', (store) => store.get(id));
  return ok && typeof value === 'string' ? value : undefined;
}

export async function deletePhoto(id: string): Promise<void> {
  await runTransaction(PHOTO_STORE, 'readwrite', (store) => store.delete(id));
}

export async function clearPhotos(): Promise<void> {
  await runTransaction(PHOTO_STORE, 'readwrite', (store) => store.clear());
}

/** 轻量镜像：只存记录本身，不含照片本体 */
export function readMirror<T>(): T | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeMirror(value: unknown): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 把记录里内联的老照片搬进照片仓库，返回搬完的数据 */
export async function moveInlinePhotos<T extends { items?: unknown }>(
  snapshot: T,
): Promise<{ snapshot: T; moved: number }> {
  const items = snapshot.items;
  if (!Array.isArray(items) || !items.length) return { snapshot, moved: 0 };
  const next: unknown[] = [];
  let moved = 0;
  for (const raw of items) {
    const item = raw as Record<string, unknown> | undefined;
    const photo = item?.photo;
    if (!item || typeof photo !== 'string' || item.photoId) {
      next.push(raw);
      continue;
    }
    const photoId = `photo-${String(item.id ?? Date.now())}`;
    if (await putPhoto(photoId, photo)) {
      const copy: Record<string, unknown> = { ...item, photoId };
      delete copy.photo;
      next.push(copy);
      moved += 1;
    } else {
      next.push(raw);
    }
  }
  return moved ? { snapshot: { ...snapshot, items: next }, moved } : { snapshot, moved: 0 };
}
