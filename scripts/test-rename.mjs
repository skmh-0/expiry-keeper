/**
 * 改名回归：
 *  A 库存详情里改档案名要落盘
 *  B 录入确认页里改名，入库后列表跟着变
 *  C 档案库里改名只影响这一条
 *  D 没有条码的老档案各拿一个内部码，改名不再串档
 *  E 再次录入同一商品时，确认页带出的是档案里的名字（不被模型覆盖）
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

const base = {
  brand: '测试牌',
  ingredientsRaw: '水、小麦粉',
  ingredients: [],
  additives: [],
  allergens: [],
  shelfLifeText: '12个月',
  source: 'manual',
  version: 1,
  confidence: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 3,
  skus: [
    { ...base, gtin: '6901234567892', name: '原始商品名', manufacturer: '测试食品有限公司' },
    { ...base, gtin: '', name: '无条码档案一', manufacturer: '' },
    { ...base, gtin: '', name: '无条码档案二', manufacturer: '', createdAt: Date.now() + 1 },
  ],
  items: [
    { id: 'item-x', gtin: '6901234567892', quantity: 500, unit: '克', location: '厨房', createdAt: Date.now() },
  ],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const skuNames = async () => ((await readSeededState(page))?.skus ?? []).map((sku) => sku.name);
const gtinList = async () => ((await readSeededState(page))?.skus ?? []).map((sku) => sku.gtin);
const openLibrary = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '打开商品档案库' }).click();
  await page.waitForTimeout(450);
};
const editOpenSheetName = async (next) => {
  const input = page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first();
  await input.fill(next);
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(500);
};

// A. 库存详情 → 编辑商品档案 → 改名
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '编辑商品档案' }).click();
await page.waitForTimeout(400);
await editOpenSheetName('改名后 A');
check('A 库存详情改名落盘', (await skuNames())[0] === '改名后 A', (await skuNames())[0]);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
check('A 库存行显示新名字', (await page.locator('.list-item').first().innerText()).includes('改名后 A'));

// A2. 库存详情里直接改名字（失焦提交）
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
const detailName = page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first();
check('A2 详情页有商品名称输入框', (await detailName.count()) === 1);
await detailName.fill('详情页改的名');
await page.locator('.sheet-head h2').click();
await page.waitForTimeout(500);
check('A2 详情页改名落盘', (await skuNames())[0] === '详情页改的名', (await skuNames())[0]);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// B. 扫码录入 → 确认页 → 改名 → 入库
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(600);
const entryName = page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first();
check('B 确认页带出档案里的名字', (await entryName.inputValue()) === '详情页改的名', await entryName.inputValue());
await entryName.fill('录入时改的 B');
await page.locator('.sheet label.field', { hasText: '重量' }).locator('input').first().fill('100');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
check('B 入库后档案名跟着改', (await skuNames())[0] === '录入时改的 B', (await skuNames())[0]);
check('B 库存列表显示新名字', (await page.locator('.list-item').first().innerText()).includes('录入时改的 B'));

// C. 档案库改名
await openLibrary();
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await editOpenSheetName('档案库改的名 C');
const afterC = await skuNames();
check('C 档案库改名生效', afterC[0] === '档案库改的名 C', afterC[0]);
check('C 只影响这一条', afterC[1] === '无条码档案一' && afterC[2] === '无条码档案二', afterC.join(' / '));

// D. 无条码档案：各拿一个内部码，互不串档
const codes = await gtinList();
check('D 老档案都补上了条码', codes.every((gtin) => gtin && gtin.length === 13), codes.join(' / '));
check('D 两个内部码不重复', new Set(codes).size === codes.length);
const rows = page.locator('.list-item');
const total = await rows.count();
let target = -1;
for (let i = 0; i < total; i += 1) {
  if ((await rows.nth(i).innerText()).includes('无条码档案二')) target = i;
}
check('D 找得到「无条码档案二」这一行', target >= 0, `第 ${target} 行`);
await rows.nth(target).click();
await page.waitForTimeout(400);
const openedName = await page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first().inputValue();
check('D 打开的是被点中的那条', openedName === '无条码档案二', openedName);
await editOpenSheetName('无条码档案二·改');
const afterD = await skuNames();
check('D 只改了被点中的那条', afterD[2] === '无条码档案二·改' && afterD[1] === '无条码档案一', afterD.join(' / '));

// E. 再次录入：确认页仍带档案里的名字
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(500);
const again = await page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first().inputValue();
check('E 二次录入仍用档案里的名字', again === '档案库改的名 C', again);
await page.screenshot({ path: 'shots/rename-01-sheet.png', fullPage: false });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// F. 档案被删掉的记录（未命名商品）也要能改名，并且不依赖失焦
await seedState(page, {
  schema: 3,
  skus: [],
  items: [
    { id: 'item-orphan', gtin: '6901234567899', quantity: 300, unit: '克', location: '厨房', createdAt: Date.now() },
  ],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
const orphanName = page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first();
check('F 未建档记录也有名称输入框', (await orphanName.count()) === 1);
await orphanName.fill('孤儿记录改名');
await page.waitForTimeout(400);
const orphanSkus = await skuNames();
check('F 改名时顺手建档', orphanSkus.length === 1 && orphanSkus[0] === '孤儿记录改名', orphanSkus.join(' / '));
const orphanGtin = (await gtinList())[0];
check('F 新档案沿用记录的条码', orphanGtin === '6901234567899', orphanGtin);
// 不点别处、直接按 Esc 关掉抽屉，验证不靠失焦提交
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const orphanRow = (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' ');
check('F 关掉抽屉后列表显示新名字', orphanRow.includes('孤儿记录改名'), orphanRow);

// G. 逐字输入过程中就落盘（不等失焦、不等保存按钮）
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
const typingName = page.locator('.sheet label.field', { hasText: '商品名称' }).locator('input').first();
await typingName.fill('');
await page.keyboard.type('猫粮改名G');
await page.waitForTimeout(400);
const typedSkus = await skuNames();
check('G 逐字输入就写进档案', typedSkus[0] === '猫粮改名G', typedSkus.join(' / '));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const typedRow = (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' ');
check('G 列表同步显示', typedRow.includes('猫粮改名G'), typedRow);
await page.screenshot({ path: 'shots/rename-02-live.png', fullPage: false });

// H. 输入法不触发 change 事件时（安卓上真实存在），只靠失焦也要能存
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('.sheet label.field'));
  const target = labels.find((label) => label.textContent?.includes('商品名称'));
  const input = target?.querySelector('input');
  if (input) {
    input.focus();
    input.value = '没触发change的名字';
  }
});
await page.locator('.sheet-head h2').click();
await page.waitForTimeout(600);
check('H 只靠失焦也能改名', (await skuNames())[0] === '没触发change的名字', (await skuNames())[0]);

// I. 点「保存名称」按钮
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('.sheet label.field'));
  const target = labels.find((label) => label.textContent?.includes('商品名称'));
  const input = target?.querySelector('input');
  if (input) input.value = '点按钮保存的名字';
});
await page.getByRole('button', { name: '保存名称' }).click();
await page.waitForTimeout(600);
check('I 点保存按钮生效', (await skuNames())[0] === '点按钮保存的名字', (await skuNames())[0]);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const finalRow = (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' ');
check('I 列表显示新名字', finalRow.includes('点按钮保存的名字'), finalRow);

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
