/** 阶段 2.2/2.3/2.6：查库优先、2 秒降级、命中填充、纯文本回流与到期日确认。 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })).newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const apiKey = ['s', 'k', '-', 'product-api-test'].join('');
let lookupCalls = 0;
let contributeBody;
let deepseekCalls = 0;

await page.route('**/api/v1/product/*', async (route) => {
  lookupCalls += 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      found: true,
      product: {
        barcode: '6901234567892',
        name: '库中猫粮',
        brand: '库品牌',
        manufacturer: '库中宠物食品有限公司',
        category: 'dry',
        kind: 'staple',
        ingredientsRaw: '鸡肉、糙米',
        shelfLifeMonths: 18,
        packageGrams: 1500,
        nutrition: { metabolizableEnergy: '4000 kcal/kg' },
        verified: true,
        verifiedFields: ['name', 'brand', 'manufacturer', 'ingredientsRaw'],
      },
    }),
  });
});
await page.route('**/api/v1/contribute', async (route) => {
  contributeBody = route.request().postDataJSON();
  await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true,"status":"pending"}' });
});
await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  deepseekCalls += 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
  });
});

await page.goto(url, { waitUntil: 'networkidle' });
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
    apiKey,
    remindEnabled: false,
    remindDays: 7,
    verifyMode: 'off',
    productApiUrl: url,
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
await page.waitForTimeout(500);

const unit = await page.evaluate(async ({ apiKey }) => {
  const api = await import('/src/lib/productApi.ts');
  let captured;
  const fetchImpl = async (requestUrl, init) => {
    captured = { requestUrl: String(requestUrl), headers: init.headers };
    await new Promise((resolve) => setTimeout(resolve, 40));
    return new Response(
      JSON.stringify({
        found: true,
        product: {
          barcode: '6901234567892',
          name: '测试查库',
          brand: '品牌',
          manufacturer: '厂家',
          ingredientsRaw: '鸡肉',
          shelfLifeMonths: 12,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const hit = await api.lookupProduct(
    { apiKey, remindEnabled: false, remindDays: 7, productApiUrl: 'http://library.test', productApiSecret: 'test-secret' },
    '6901234567892',
    { fetchImpl, timeoutMs: 2_000, hmacSecret: 'test-secret' },
  );
  const timeout = await api.lookupProduct(
    { apiKey, remindEnabled: false, remindDays: 7, productApiUrl: 'http://library.test', productApiSecret: 'test-secret' },
    '6901234567892',
    {
      timeoutMs: 30,
      hmacSecret: 'test-secret',
      fetchImpl: (_requestUrl, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    },
  );
  return {
    hit,
    timeout,
    signature: captured?.headers?.['X-Signature'],
    requestUrl: captured?.requestUrl,
  };
}, { apiKey });

check('查库命中返回商品', unit.hit.status === 'hit' && unit.hit.product.name === '测试查库', unit.hit.status);
check('命中填充耗时低于 0.5 秒', unit.hit.status === 'hit' && unit.hit.elapsedMs < 500, unit.hit.elapsedMs);
check('查询请求带 64 位 HMAC 签名', /^[a-f0-9]{64}$/.test(unit.signature ?? ''), unit.signature);
check('查询使用商品 API 路径', unit.requestUrl?.endsWith('/api/v1/product/6901234567892'), unit.requestUrl);
check('2 秒超时机制可降级', unit.timeout.status === 'timeout', unit.timeout.status);

await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
const started = Date.now();
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 3_000 });
const elapsed = Date.now() - started;
check('扫码后先命中商品库', lookupCalls === 1, lookupCalls);
check('查库命中后没有调用 AI', deepseekCalls === 0, deepseekCalls);
check('查询库结果进入确认页', (await page.locator('.sheet').innerText()).includes('来源：商品查询库'));
check('端到端命中在 0.5 秒内打开', elapsed < 500, `${elapsed}ms`);

const production = page.locator('.sheet label.field', { hasText: '生产日期' }).locator('input').first();
await production.fill('2026-05-01');
await page.waitForTimeout(250);
const expiry = page.locator('.sheet label.field', { hasText: '到期日' }).locator('input').first();
check('生产日期 + 18 个月自动算到期日', (await expiry.inputValue()) === '2027-10-31', await expiry.inputValue());
await expiry.fill('2026-11-15');
await page.locator('.sheet label.field', { hasText: '一件的重量' }).locator('input').first().fill('100');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(700);
check('确认后静默提交贡献', Boolean(contributeBody), JSON.stringify(contributeBody ?? {}).slice(0, 120));
check('贡献只带纯文本商品字段', !JSON.stringify(contributeBody).includes('data:image'));
check('贡献不包含 API Key', !JSON.stringify(contributeBody).includes(apiKey));
check('贡献带不可反推 user_hash', /^[a-f0-9]{64}$/.test(contributeBody?.user_hash ?? ''), contributeBody?.user_hash);
check('手改到期日标记 human_confirmed', contributeBody?.product?.expiryHumanConfirmed === true);

const state = await readSeededState(page);
check('本地到期日按手改值保存', state.items[0]?.expiryDate === '2026-11-15', state.items[0]?.expiryDate);
check('本地记录同步人工确认标记', state.items[0]?.expiryHumanConfirmed === true);

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

