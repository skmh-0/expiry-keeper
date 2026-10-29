/**
 * 1 API Key 输入后不用二次输入：
 *   a 粘贴（不触发 change）后直接切走页面也要存下来
 *   b 刷新后 Key 还在，识别引擎显示已配置
 * 2 单件克数在库存列表与详情里明确显示：
 *   a 300 克 / 3 件 → 列表显示「共 300克」「100克/件」「3 件」
 *   b 详情里「一件的重量」是 100 克，并标出共 300 克
 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

const TEST_KEY = ['s', 'k', '-', 'pasted', '-', 'without', '-', 'change'].join('');

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 3,
  skus: [
    {
      gtin: '6901234567892',
      name: '测试冻干猫粮',
      brand: '测试牌',
      manufacturer: '测试宠物食品有限公司',
      ingredientsRaw: '鲜鸡胸肉',
      ingredients: [],
      additives: [],
      allergens: [],
      shelfLifeText: '18个月',
      source: 'manual',
      version: 1,
      confidence: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  items: [
    {
      id: 'item-3pack',
      gtin: '6901234567892',
      quantity: 300,
      unit: '克',
      count: 3,
      location: '厨房',
      createdAt: Date.now(),
    },
  ],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// ---- 1. API Key
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(500);
await page.evaluate((key) => {
  const input = document.querySelector('input[type=password]');
  if (input) {
    input.focus();
    input.value = key;
  }
}, TEST_KEY);
// 不点别处、不失焦，直接切到扫码页 → 离开设置页时应该把 Key 存下来
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(800);
const afterLeave = await readSeededState(page);
const storedInSession = await page.evaluate(() => sessionStorage.getItem('expiry-keeper:session-api-key'));
check('1a 离开设置页就把 Key 存下来', storedInSession === TEST_KEY, storedInSession ?? '(空)');
check('1a 记录数据里不再有明文 Key', afterLeave.settings.apiKey === '', afterLeave.settings.apiKey || '(空)');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(500);
const keyValue = await page.locator('input[type=password]').inputValue();
check('1b 刷新后 Key 还在，不用二次输入', keyValue === TEST_KEY, keyValue);
const engineChip = (await page.locator('.card', { hasText: 'DeepSeek 视觉识别' }).innerText()).replace(/\s+/g, ' ');
check('1c 识别引擎显示已配置', engineChip.includes('已配置'), engineChip.slice(0, 60));

// ---- 2. 单件克数
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(500);
const row = (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' ');
check('2a 列表写明总量', row.includes('共 300克'), row);
check('2a 列表写明单价重量', row.includes('100克/件'), row);
check('2a 列表写明件数', row.includes('3 件'), row);

await page.locator('.list-item').first().click();
await page.waitForTimeout(500);
const perUnit = await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().inputValue();
const fieldText = (await page.locator('.sheet label.field', { hasText: /重量/ }).innerText()).replace(/\s+/g, ' ');
check('2b 详情里一件是 100 克', Math.abs(Number(perUnit) - 100) < 0.01, `一件 ${perUnit} 克`);
check('2b 详情里标出共 300 克', fieldText.includes('共 300克'), fieldText.slice(0, 60));
await page.screenshot({ path: 'shots/piece-02-detail.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
