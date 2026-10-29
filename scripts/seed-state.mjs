/**
 * 测试用：把一份快照同时写进 localStorage 镜像和 IndexedDB。
 * 应用启动时以数据库为准，只写 localStorage 会被数据库里的旧数据盖掉。
 */
export async function seedState(page, snapshot) {
  await page.evaluate(async (value) => {
    localStorage.setItem('expiry-keeper:v1', JSON.stringify(value));
    await new Promise((resolve) => {
      const request = indexedDB.open('expiry-keeper', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').put(value, 'snapshot');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  }, snapshot);
}

/** 测试用：读取应用真正的数据源（IndexedDB 里的整份快照） */
export async function readSeededState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('expiry-keeper', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('state')) database.createObjectStore('state');
        if (!database.objectStoreNames.contains('photos')) database.createObjectStore('photos');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
    if (!db) return undefined;
    const value = await new Promise((resolve) => {
      try {
        const tx = db.transaction('state', 'readonly');
        const request = tx.objectStore('state').get('snapshot');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    db.close();
    return value;
  });
}
