/**
 * 入库前的硬校验（寒崽那五条）：
 *  1 不填「一件的重量」→ 点确认要有明确提示，不能静默禁用
 *  2 不填商品名称 → 同样提示
 *  3 到期日早于生产日期 → 拦住不让入库，并说清是哪两项矛盾
 *  4 填齐了 → 正常入库
 *  5 条码校验位不通过 → 不跑解析流程，直接进确认页并说明原因
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

const seed = async () => {
  await seedState(page, {
    schema: 3,
    skus: [],
    items: [],
    settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
};

const openSheet = async (gtin = '6901234567892') => {
  await page.getByRole('button', { name: '扫码', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByPlaceholder('13 位商品条码').fill(gtin);
  await page.getByRole('button', { name: '查询' }).click();
  await page.waitForSelector('.sheet', { timeout: 15000 });
  await page.waitForTimeout(400);
};

const field = (label) => page.locator('.sheet label.field', { hasText: label }).locator('input').first();
const footerError = async () => (await page.locator('.sheet-foot .notice-error').allInnerTexts()).join(' ');

// 1. 缺重量
await page.goto(url, { waitUntil: 'networkidle' });
await seed();
await openSheet();
await field('商品名称').fill('测试猫粮');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(500);
const error1 = await footerError();
check('1 缺重量时给出明确提示', error1.includes('重量'), error1 || '(没有提示)');
check('1 按钮不是静默禁用', await page.getByRole('button', { name: '确认入库' }).isEnabled());
let stored = await readSeededState(page);
check('1 没有偷偷入库', stored.items.length === 0, `${stored.items.length} 条`);

// 2. 缺名称
await field('商品名称').fill('');
await field('一件的重量').fill('100');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(500);
const error2 = await footerError();
check('2 缺名称时给出明确提示', error2.includes('商品名称'), error2 || '(没有提示)');
stored = await readSeededState(page);
check('2 没有偷偷入库', stored.items.length === 0, `${stored.items.length} 条`);

// 3. 日期矛盾
await field('商品名称').fill('测试猫粮');
await field(/^生产日期/).fill('2026-06-01');
await page.waitForTimeout(200);
await field(/^到期日/).fill('2025-01-01');
await page.waitForTimeout(200);
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(500);
const error3 = await footerError();
check('3 日期矛盾被拦住', error3.includes('早于生产日期'), error3 || '(没有提示)');
const checkList = (await page.locator('.sheet .check-list').innerText()).replace(/\s+/g, ' ');
check('3 规则校验里也标出这条', checkList.includes('早于生产日期'), checkList.slice(0, 80));
stored = await readSeededState(page);
check('3 矛盾记录没有入库', stored.items.length === 0, `${stored.items.length} 条`);
await page.screenshot({ path: 'shots/guard-01-date-conflict.png', fullPage: false });

// 4. 改成合法日期后正常入库
await field(/^到期日/).fill('2027-06-01');
await page.waitForTimeout(200);
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
stored = await readSeededState(page);
check('4 合法数据正常入库', stored.items.length === 1, `${stored.items.length} 条`);
check('4 入库的是单件克数 × 件数', stored.items[0]?.quantity === 100, `${stored.items[0]?.quantity} 克`);

// 5. 非法条码：不进解析动画、直接给结果
await seed();
const started = Date.now();
await openSheet('6901234567890');
const waited = Date.now() - started;
const invalidNotice = (await page.locator('.sheet .notice').allInnerTexts()).join(' ');
check('5 提示条码校验位不通过', invalidNotice.includes('校验位不通过'), invalidNotice.slice(0, 60));
check('5 没有白跑一遍解析（秒开）', waited < 3000, `${waited} ms（含打开确认页的等待）`);
await page.screenshot({ path: 'shots/guard-02-bad-gtin.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
