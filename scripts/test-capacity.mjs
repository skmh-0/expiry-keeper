/**
 * 量一下现在到底能存多少：手机浏览器给应用的配额、每条记录的实际占用、以及写入速度。
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const estimate = async () => page.evaluate(() => navigator.storage?.estimate?.() ?? {});

const before = await estimate();
console.log(`配额 ${(Number(before.quota) / 1024 / 1024).toFixed(1)} MB · 已用 ${(Number(before.usage) / 1024 / 1024).toFixed(2)} MB`);

// 每条记录的真实占用：一条 100 克的手工记录序列化后多大
const recordBytes = await page.evaluate(() => {
  const sample = {
    id: 'item-1758873600000-abc123',
    gtin: '6901234567892',
    productionDate: '2026-05-01',
    expiryDate: '2027-10-31',
    quantity: 100,
    unit: '克',
    count: 1,
    location: '厨房',
    note: '',
    photoId: 'photo-item-1758873600000-abc123',
    createdAt: Date.now(),
  };
  return JSON.stringify(sample).length;
});
console.log(`一条记录本身约 ${recordBytes} 字节（不含照片）`);

// 灌入 40 张 500KB 的"照片"，看配额和占用怎么走
const filled = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('expiry-keeper', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('state')) database.createObjectStore('state');
      if (!database.objectStoreNames.contains('photos')) database.createObjectStore('photos');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const blob = `data:image/jpeg;base64,${'c'.repeat(500 * 1024)}`;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (let i = 0; i < 40; i += 1) store.put(blob, `capacity-${i}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const writeMs = Date.now() - started;
  const loaded = await new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const request = tx.objectStore('photos').get('capacity-39');
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result.length : 0);
    request.onerror = () => resolve(0);
  });
  db.close();
  return { writeMs, loaded };
});
console.log(`写入 40 张 500KB 照片用了 ${filled.writeMs} ms，读回检查 ${filled.loaded > 0 ? '成功' : '失败'}`);

const after = await estimate();
console.log(`写完后：配额 ${(Number(after.quota) / 1024 / 1024).toFixed(1)} MB · 已用 ${(Number(after.usage) / 1024 / 1024).toFixed(2)} MB`);

const quotaMb = Number(after.quota) / 1024 / 1024;
const photoMb = 0.3;
console.log(`\n按每条约 300KB 背标照片估算：约 ${Math.floor(quotaMb / photoMb).toLocaleString('en-US')} 条`);
console.log(`按不存照片（扫码/手工记录，约 1KB 一条）：约 ${Math.floor((quotaMb * 1024) / 1).toLocaleString('en-US')} 条（实际受数据库开销限制）`);

// 列表渲染：几千条时打开「库存」要多久
for (const count of [500, 2000]) {
  const seed = await page.evaluate(async (total) => {
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
    const items = [];
    for (let i = 0; i < total; i += 1) {
      items.push({
        id: `perf-${i}`,
        gtin: `6901234${String(i).padStart(6, '0')}`,
        quantity: 100,
        unit: '克',
        location: '仓库',
        createdAt: Date.now(),
      });
    }
    const snapshot = { schema: 3, skus: [], items, settings: { apiKey: '', remindEnabled: false, remindDays: 7 }, makers: [] };
    await new Promise((resolve) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(snapshot, 'snapshot');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
    localStorage.setItem('expiry-keeper:v1', JSON.stringify(snapshot));
    return items.length;
  }, count);
  const started = Date.now();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '库存', exact: true }).click();
  await page.waitForSelector('.list-item', { timeout: 30000 });
  const rendered = await page.locator('.list-item').count();
  console.log(`塞 ${seed} 条：刷新到列表出现 ${Date.now() - started} ms，渲染 ${rendered} 行`);
}

// 设置里的存储用量（给用户看的那个数字）
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(600);
await page.locator('.section-title', { hasText: '数据' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const capacityText = (await page.locator('.card', { hasText: '本地记录' }).innerText()).replace(/\s+/g, ' ');
console.log(`设置页显示：${capacityText.slice(0, 120)}`);
await page.screenshot({ path: 'shots/capacity-01-settings.png', fullPage: false });

await browser.close();
