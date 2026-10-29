/**
 * 自主修改开封 / 用完日期：
 *  1 消耗页每条都有「改日期」按钮
 *  2 把用完日从 9-15 改成 9-10 → 天数、日均、期间消耗跟着重算
 *  3 用完日早于开封日会被拦住
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

/** 用「相对今天」的日期，避免和默认的最近 30 天筛选打架 */
const isoAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};
const opened = isoAgo(10);
const finishedAt = isoAgo(5);
const changed = isoAgo(8);
const tooEarly = isoAgo(12);

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
      id: 'item-finish',
      gtin: '6901234567892',
      quantity: 100,
      unit: '克',
      location: '厨房',
      openedAt: opened,
      finishedAt,
      createdAt: Date.now(),
    },
  ],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.waitForTimeout(600);
const before = (await page.locator('.consume-row').first().innerText()).replace(/\s+/g, ' ');
check('1 消耗页列出这条记录', before.includes(finishedAt), before.slice(0, 70));
check('1 有改日期按钮', (await page.getByRole('button', { name: '改开封 / 用完日期' }).count()) === 1);

// 改成 9-10 用完
await page.getByRole('button', { name: '改开封 / 用完日期' }).click();
await page.waitForTimeout(400);
const finishInput = page.locator('.consume-edit input[type=date]').nth(1);
await finishInput.fill(changed);
await page.getByRole('button', { name: '保存日期' }).click();
await page.waitForTimeout(800);
const after = (await page.locator('.consume-row').first().innerText()).replace(/\s+/g, ' ');
check('2 已用完日期改成功', after.includes(changed), after.slice(0, 80));
check('2 天数按新日期重算', after.includes('2 天'), after.slice(0, 80));
const stored = await readSeededState(page);
check('2 落盘的是新日期', stored.items[0].finishedAt === changed, String(stored.items[0].finishedAt));

// 把用完日改到开封日之前，应被拦住
await page.getByRole('button', { name: '改开封 / 用完日期' }).click();
await page.waitForTimeout(400);
await page.locator('.consume-edit input[type=date]').nth(1).fill(tooEarly);
await page.getByRole('button', { name: '保存日期' }).click();
await page.waitForTimeout(500);
const errorText = await page.locator('.consume-edit .notice-error').count();
check('3 日期倒挂被拦住并提示', errorText === 1, `${errorText} 条提示`);
const stillStored = await readSeededState(page);
check('3 没有写入非法日期', stillStored.items[0].finishedAt === changed, String(stillStored.items[0].finishedAt));
await page.screenshot({ path: 'shots/finish-date-01.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
