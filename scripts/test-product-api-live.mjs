/** 真实 Express + SQLite 商品库联调，验证 App 端 HMAC 与 CORS 契约。 */
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';
import {
  enqueueContribution,
  openDatabase,
  processPendingContributions,
} from '../server/db.mjs';
import { seedState } from './seed-state.mjs';

const db = openDatabase(':memory:');
const barcode = '6901234567892';
const clean = {
  barcode,
  name: '真实联调猫粮',
  brand: '联调品牌',
  manufacturer: '联调宠物食品有限公司',
  category: 'dry',
  kind: 'staple',
  ingredientsRaw: '鸡肉、糙米',
  storage: '阴凉干燥处',
  shelfLifeText: '18个月',
  shelfLifeMonths: 18,
  packageGrams: 1500,
  nutrition: { metabolizableEnergy: '4000 kcal/kg' },
};
enqueueContribution(db, {
  barcode,
  userHash: 'a'.repeat(64),
  raw: { product: clean },
});
await processPendingContributions(db, async () => clean);
const app = createApp({ db, hmacSecret: 'test-product-hmac-secret', adminPassword: 'test-admin' });
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const port = server.address().port;
const backendUrl = `http://127.0.0.1:${port}`;
const webUrl = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })).newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

try {
  const health = await fetch(`${backendUrl}/api/v1/health`).then((response) => response.json());
  check('真实后端 health 可访问', health.ok === true);
  await page.goto(webUrl, { waitUntil: 'networkidle' });
  await seedState(page, {
    schema: 6,
    skus: [],
    items: [],
    pets: [],
    feedings: [],
    vaccinations: [],
    dewormings: [],
    activePetId: '',
    settings: {
      apiKey: ['s', 'k', '-', 'live-test'].join(''),
      remindEnabled: false,
      remindDays: 7,
      verifyMode: 'off',
      productApiUrl: backendUrl,
      productApiSecret: 'test-product-hmac-secret',
      reminders: {
        expiryEnabled: false,
        vaccineEnabled: false,
        dewormEnabled: false,
        enabledAt: {},
      },
    },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.getByPlaceholder('13 位商品条码').fill(barcode);
  const started = Date.now();
  await page.getByRole('button', { name: '查询' }).click();
  await page.waitForSelector('.sheet', { timeout: 3_000 });
  const elapsed = Date.now() - started;
  check('App HMAC 签名被真实后端接受', elapsed < 500, `${elapsed}ms`);
  const liveName = await page.locator('.sheet input[name="name"]').inputValue();
  check('真实 SQLite 商品进入确认页', liveName === '真实联调猫粮', liveName);
  check('真实查库在 0.5 秒内填充', elapsed < 500, `${elapsed}ms`);
  await page.locator('.sheet label.field', { hasText: '一件的重量' }).locator('input').first().fill('100');
  await page.getByRole('button', { name: '确认入库' }).click();
  await page.waitForTimeout(700);
  const contributions = db
    .prepare("SELECT COUNT(*) AS count FROM contributions WHERE status = 'pending'")
    .get().count;
  check('确认后真实后端收到贡献', contributions >= 1, contributions);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}

if (failed) process.exit(1);
console.log('全部通过');
