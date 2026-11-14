/** 2.2：商品库超过 2 秒时自动降级到 AI，不阻断扫码流程。 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const sampleImage = existsSync('shots/label-1400.jpg') ? 'shots/label-1400.jpg' : 'public/icon-round.png';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })).newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const apiKey = ['s', 'k', '-', 'timeout-test'].join('');
let deepseekCalls = 0;

await page.route('**/api/v1/product/*', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 2_300));
  await route.abort('timedout').catch(() => undefined);
});
await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  deepseekCalls += 1;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              gtin: '6901234567892',
              name: '超时降级猫粮',
              brand: '降级品牌',
              manufacturer: '降级工厂',
              category: '干粮',
              kind: '主食',
              ingredientsRaw: '鸡肉',
              shelfLifeText: '18个月',
              confidence: { name: 0.9, brand: 0.9, manufacturer: 0.9, ingredientsRaw: 0.9 },
            }),
          },
        },
      ],
    }),
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
await page.waitForTimeout(400);
await page.locator('input[type=file]').nth(1).setInputFiles(sampleImage);
await page.waitForTimeout(300);
const started = Date.now();
await page.getByRole('button', { name: /识别这 1 张/ }).click();
await page.waitForSelector('.sheet', { timeout: 10_000 });
const elapsed = Date.now() - started;
check('商品库超时后自动调用 AI', deepseekCalls === 1, deepseekCalls);
check('查询失败不超过 2 秒就降级', elapsed < 2_500, `${elapsed}ms`);
check('AI 降级结果进入确认页', (await page.locator('.sheet input[name="name"]').inputValue()) === '超时降级猫粮');

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');
