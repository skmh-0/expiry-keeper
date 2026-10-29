/**
 * 单件克数贯通性检查：
 * 录入「一件 300 克 × 3 件」→ 库存显示共 900 克 / 3 件
 * 开封扣 1 件 → 剩下的 2 件共 600 克，被扣的那件是 300 克
 * 用完那件 → 消耗页记的是 300 克（一件），不是 900 克
 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

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
      name: '三件装猫粮',
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
  items: [],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 录入：一件 300 克 × 3 件
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(400);
await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().fill('300');
const countField = page.locator('.sheet label.field', { hasText: /^(件数|数量)/ });
await countField.getByRole('button', { name: '增加' }).click();
await countField.getByRole('button', { name: '增加' }).click();
await page.waitForTimeout(400);
const entryHint = (await page.locator('.sheet label.field', { hasText: /重量/ }).innerText()).replace(/\s+/g, ' ');
check('1 录入页按一件算并提示总量', entryHint.includes('共 900'), entryHint.slice(0, 60));
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
const rowText = (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' ');
check('2 列表显示总量与件数', rowText.includes('900克') && rowText.includes('3 件'), rowText);

// 详情页：一件的重量 + 共多少
await page.locator('.list-item').first().click();
await page.waitForTimeout(500);
const perUnit = await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().inputValue();
const detailText = (await page.locator('.sheet label.field', { hasText: /重量/ }).innerText()).replace(/\s+/g, ' ');
check('3 详情页显示一件的重量', Math.abs(Number(perUnit) - 300) < 0.01, `一件 ${perUnit} 克`);
check('3 详情页标出总量', detailText.includes('共 900'), detailText.slice(0, 60));

// 开封扣 1 件
await page.getByRole('button', { name: '开封扣 1 件' }).click();
await page.waitForTimeout(900);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const stateAfterOpen = await readSeededState(page);
const openedPiece = stateAfterOpen.items.find((item) => item.openedAt && !item.finishedAt);
check('4 扣下来的那件是一件 300 克', Math.abs(Number(openedPiece?.quantity) - 300) < 0.01, `${openedPiece?.quantity} 克`);
const rowsAfterOpen = (await page.locator('.list-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
check('4 剩下的 2 件是 600 克', rowsAfterOpen.some((text) => text.includes('600克') && text.includes('2 件')), rowsAfterOpen.join(' || '));

// 用完那件 → 消耗页应记 300 克
await page.locator('.list-item', { hasText: '已开封' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '已用完' }).click();
await page.waitForTimeout(900);
await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.waitForTimeout(600);
const consumeRows = (await page.locator('.consume-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
check('5 消耗页记的是一件 300 克', consumeRows.some((text) => text.includes('共 300克')), consumeRows.join(' || '));
const stats = (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | ');
check('5 统计的期间消耗也是一件', stats.includes('300'), stats.slice(0, 80));
await page.screenshot({ path: 'shots/piece-01-consume.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
