/**
 * 录入后会不会丢：
 *  1 手工录入一条 → 列表里有、localStorage 里有
 *  2 刷新 / 重新打开 → 还在
 *  3 照片不再写进 localStorage（搬到 IndexedDB）
 *  4 模拟「十几条带照片的老数据把 5MB 写满」→ 应用自动搬家瘦身，之后还能继续录入
 *  5 迁移后新录入带照片的记录，重启仍在，照片也能看回来
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

const storedBytes = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('expiry-keeper:v1');
    return { bytes: raw ? raw.length : 0, parsed: raw ? JSON.parse(raw) : { items: [], skus: [] } };
  });

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => new Promise((resolve) => {
  const request = indexedDB.deleteDatabase('expiry-keeper-photos');
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
  request.onblocked = () => resolve();
}));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 1. 手工录入一条
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(400);
await page.locator('.sheet label.field', { hasText: /^商品名称/ }).locator('input').first().fill('录入测试猫粮');
await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().fill('100');
await page.locator('.sheet label.field', { hasText: /^存放位置/ }).locator('input').first().fill('厨房');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(800);
check('1 入库后列表里有这条', (await page.locator('.list-item').count()) === 1);
const first = await storedBytes();
check('1 已写进本地存储', first.parsed.items.length === 1 && first.parsed.skus.length === 1, `${first.bytes} 字节`);

// 2. 刷新 / 重新打开
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
check('2 刷新后还在', (await page.locator('.list-item').count()) === 1);
const fresh = await context.newPage();
await fresh.goto(url, { waitUntil: 'networkidle' });
await fresh.waitForTimeout(500);
await fresh.getByRole('button', { name: '库存', exact: true }).click();
await fresh.waitForTimeout(400);
check('2 重新打开仍在', (await fresh.locator('.list-item').count()) === 1);
await fresh.close();

// 3. 配额实测
const quota = await page.evaluate(() => {
  const probe = (bytes) => {
    try {
      localStorage.setItem('__probe', 'a'.repeat(bytes));
      localStorage.removeItem('__probe');
      return true;
    } catch {
      localStorage.removeItem('__probe');
      return false;
    }
  };
  let low = 0;
  let high = 12 * 1024 * 1024;
  while (high - low > 64 * 1024) {
    const mid = Math.floor((low + high) / 2);
    if (probe(mid)) low = mid;
    else high = mid;
  }
  return low;
});
console.log(`   localStorage 配额约 ${(quota / 1024 / 1024).toFixed(2)} MB`);

// 4. 造出「老版本写满 5MB」的局面：一堆把照片内联在记录里的条目
const filled = await page.evaluate(
  ({ quota }) => {
    const raw = JSON.parse(localStorage.getItem('expiry-keeper:v1'));
    const unit = 'a'.repeat(250 * 1024);
    let count = 0;
    while (JSON.stringify(raw).length < quota * 0.96 && count < 200) {
      raw.items.push({
        id: `legacy-${count}`,
        gtin: `69012345${String(count).padStart(5, '0')}`,
        quantity: 100,
        unit: '克',
        location: '仓库',
        photo: `data:image/jpeg;base64,${unit}`,
        createdAt: Date.now(),
      });
      count += 1;
    }
    try {
      localStorage.setItem('expiry-keeper:v1', JSON.stringify(raw));
      return { ok: true, count };
    } catch {
      return { ok: false, count };
    }
  },
  { quota },
);
check('4 造出接近写满的老数据', filled.ok, `${filled.count} 条带内联照片`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const afterMigration = await page.evaluate(() => {
  const raw = localStorage.getItem('expiry-keeper:v1');
  const parsed = JSON.parse(raw);
  return {
    bytes: raw.length,
    inline: parsed.items.filter((item) => item.photo).length,
    withId: parsed.items.filter((item) => item.photoId).length,
    total: parsed.items.length,
  };
});
check(
  '4 老照片搬进 IndexedDB',
  afterMigration.inline === 0 && afterMigration.withId === filled.count,
  `内联 ${afterMigration.inline} 条 / 已搬家 ${afterMigration.withId} 条 / 原本带照片 ${filled.count} 条 / 共 ${afterMigration.total} 条`,
);
check(
  '4 localStorage 瘦身成功',
  afterMigration.bytes < 400 * 1024,
  `${(afterMigration.bytes / 1024).toFixed(0)} KB`,
);

// 5. 迁移后继续录入带照片的记录，重启后仍在且照片能看回来
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').nth(1).setInputFiles('shots/label-1400.jpg');
await page.waitForTimeout(900);
await page.getByRole('button', { name: '不识别，直接手填' }).click();
await page.waitForSelector('.sheet', { timeout: 20000 });
await page.waitForTimeout(400);
await page.locator('.sheet label.field', { hasText: /^商品名称/ }).locator('input').first().fill('带照片的新记录');
await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().fill('200');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(1200);
const afterAdd = await storedBytes();
const added = afterAdd.parsed.items.find((item) => item.quantity === 200);
check('5 新记录只留照片 id、不塞照片本体', Boolean(added?.photoId) && !added?.photo, JSON.stringify({ photoId: Boolean(added?.photoId), inline: Boolean(added?.photo) }));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
const rows = await page.locator('.list-item').allInnerTexts();
check('5 重启后新记录仍在', rows.some((text) => text.includes('带照片的新记录')), `${rows.length} 条库存`);
await page.locator('.list-item', { hasText: '带照片的新记录' }).first().click();
await page.waitForTimeout(600);
const photoShown = await page.locator('.sheet .photo-strip img').count();
check('5 背标照片还能看回来', photoShown === 1, `${photoShown} 张`);
await page.screenshot({ path: 'shots/persist-01-photo.png', fullPage: false });

console.log(errors.length ? `\n控制台报错 ${errors.length} 条：${errors.slice(0, 3).join(' | ')}` : '\n控制台无报错');
// 6. 大容量：直接往数据库里放 300 条带照片的记录（约 12MB，远超 localStorage 的 5MB），看能不能全部读回来
const bulk = await page.evaluate(async () => {
  const snapshot = JSON.parse(localStorage.getItem('expiry-keeper:v1'));
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('expiry-keeper', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const db = await open();
  const photo = `data:image/jpeg;base64,${'b'.repeat(40 * 1024)}`;
  const items = [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (let i = 0; i < 300; i += 1) {
      const id = `bulk-photo-${i}`;
      store.put(photo, id);
      items.push({
        id: `bulk-item-${i}`,
        gtin: `69099999${String(i).padStart(5, '0')}`,
        quantity: 100,
        unit: '克',
        location: '仓库',
        photoId: id,
        createdAt: Date.now(),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const next = { ...snapshot, items };
  await new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(next, 'snapshot');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const mirror = localStorage.getItem('expiry-keeper:v1').length;
  return { count: items.length, mirror };
});
console.log(`   数据库里放了 ${bulk.count} 条带照片记录，镜像只有 ${(bulk.mirror / 1024).toFixed(0)} KB`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(600);
const bulkRows = await page.locator('.list-item').count();
check('6 300 条记录全部读回来', bulkRows === bulk.count, `${bulkRows} 条`);

console.log(failed ? `有 ${failed} 项没通过` : '全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
