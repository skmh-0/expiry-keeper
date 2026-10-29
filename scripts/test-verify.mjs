/**
 * 复验（第二轮放大重读）回归：
 *  1 按需复验：有低置信字段 → 两次调用，修正值生效
 *  2 按需复验：字段都很有把握 → 只调用一次
 *  3 不复验：即使低置信也只调用一次
 *  4 每次都复验：字段很有把握也调用两次
 *  5 复验没给原文依据 → 不采信，退回待核对
 *  6 日期修正必须能在 evidence 里逐位对上，否则不采信
 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const STUB_KEY = ['s', 'k', '-', 'stub'].join('');

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

let calls = [];
let firstPayload = {};
let verifyPayload = {};
await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  const body = route.request().postDataJSON();
  calls.push(body);
  const isVerify = JSON.stringify(body).includes('复验器');
  const content = isVerify ? verifyPayload : firstPayload;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  });
});

await page.goto(url, { waitUntil: 'networkidle' });

const baseFields = {
  gtin: '6901234567892',
  name: '测试冻干猫粮 100g',
  brand: '测试牌',
  manufacturer: '乖宝宠物食品集团股份有限公司',
  scCode: '鲁饲证(2023)02713',
  standardCode: 'GB/T 31217',
  ingredientsRaw: '鸡肉、鸡肝、蛋黄',
  storage: '阴凉干燥处',
  shelfLifeText: '18个月',
  productionDate: '2026-05-01',
  expiryDate: '2027-10-31',
  regions: { photoIndex: 1, ingredients: { x: 0.1, y: 0.4, w: 0.8, h: 0.3 }, date: { x: 0.1, y: 0.75, w: 0.4, h: 0.12 } },
};
const highConfidence = {
  name: 0.95,
  brand: 0.95,
  manufacturer: 0.95,
  scCode: 0.95,
  standardCode: 0.95,
  ingredientsRaw: 0.95,
  storage: 0.95,
  shelfLifeText: 0.95,
  productionDate: 0.95,
  expiryDate: 0.95,
};

const seed = async (verifyMode) => {
  await seedState(page, {
    schema: 3,
    skus: [],
    items: [],
    settings: { apiKey: STUB_KEY, remindEnabled: false, remindDays: 7, verifyMode },
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  calls = [];
};

const run = async () => {
  await page.locator('input[type=file]').nth(1).setInputFiles('shots/label-1400.jpg');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /识别这 \d+ 张/ }).click();
  await page.waitForSelector('.sheet', { timeout: 20000 });
  await page.waitForTimeout(400);
};

const closeSheet = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};

const fieldValue = (label) =>
  page.locator('.sheet label.field', { hasText: label }).locator('input, textarea').first().inputValue();

// 1. 按需复验：厂家置信度低 → 应触发复验并修正
await seed('auto');
firstPayload = { ...baseFields, confidence: { ...highConfidence, manufacturer: 0.4 } };
verifyPayload = {
  fields: { manufacturer: { value: '山东汉欧生物科技有限公司', evidence: '受托方：山东汉欧生物科技有限公司', confidence: 0.9 } },
  notes: '',
};
await run();
check('1 触发复验（两次调用）', calls.length === 2, `实际 ${calls.length} 次`);
check('1 第二次请求带上了放大图', (JSON.stringify(calls[1]).match(/image_url/g) ?? []).length >= 1);
check('1 修正值写进表单', (await fieldValue('生产厂家')) === '山东汉欧生物科技有限公司', await fieldValue('生产厂家'));
const notice1 = (await page.locator('.sheet .notice').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | ');
check('1 页面标出已复验与修正项', notice1.includes('已复验') && notice1.includes('生产厂家'), notice1.slice(0, 80));
await page.screenshot({ path: 'shots/verify-01-corrected.png', fullPage: false });
await closeSheet();

// 2. 按需复验：都很清楚 → 只调用一次
await seed('auto');
firstPayload = { ...baseFields, confidence: highConfidence };
verifyPayload = {};
await run();
check('2 高置信度只调用一次', calls.length === 1, `实际 ${calls.length} 次`);
await closeSheet();

// 3. 不复验：低置信度也不发第二次
await seed('off');
firstPayload = { ...baseFields, confidence: { ...highConfidence, manufacturer: 0.3 } };
await run();
check('3 关闭复验后只调用一次', calls.length === 1, `实际 ${calls.length} 次`);
await closeSheet();

// 4. 每次都复验：都很清楚也发第二次
await seed('always');
firstPayload = { ...baseFields, confidence: highConfidence };
verifyPayload = {
  fields: { shelfLifeText: { value: '18个月', evidence: '保质期：18个月', confidence: 0.95 } },
  notes: '',
};
await run();
check('4 每次都复验时调用两次', calls.length === 2, `实际 ${calls.length} 次`);
await closeSheet();

// 5. 复验没给依据 → 不采信
await seed('auto');
firstPayload = { ...baseFields, confidence: { ...highConfidence, name: 0.4 } };
verifyPayload = { fields: { name: { value: '麦富迪全价冻干双拼猫粮', evidence: '', confidence: 0.99 } }, notes: '' };
await run();
check('5 没有依据的修改不采信', (await fieldValue('商品名称')) === baseFields.name, await fieldValue('商品名称'));
const notice5 = (await page.locator('.sheet .notice').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | ');
check('5 标成仍没读清', notice5.includes('仍没读清') && notice5.includes('商品名称'), notice5.slice(0, 80));
await closeSheet();

// 6. 日期修正必须在 evidence 里逐位对得上
await seed('auto');
firstPayload = {
  ...baseFields,
  expiryDate: '',
  confidence: { ...highConfidence, expiryDate: 0.4 },
};
verifyPayload = {
  fields: { expiryDate: { value: '2027-11-01', evidence: '保质期至 2027.10.31', confidence: 0.9 } },
  notes: '',
};
await run();
const expiryValue = await page.locator('.sheet label.field', { hasText: '到期日' }).locator('input').first().inputValue();
check('6 对不上的日期修正被拒绝', expiryValue !== '2027-11-01', `表单里是 ${expiryValue}`);
await closeSheet();

// 6b. 证据对得上 → 接受
await seed('auto');
firstPayload = { ...baseFields, expiryDate: '', confidence: { ...highConfidence, expiryDate: 0.4 } };
verifyPayload = {
  fields: { expiryDate: { value: '2027-10-31', evidence: '保质期至 2027.10.31', confidence: 0.9 } },
  notes: '',
};
await run();
const expiryValue2 = await page.locator('.sheet label.field', { hasText: '到期日' }).locator('input').first().inputValue();
check('6b 证据对得上的日期修正被采纳', expiryValue2 === '2027-10-31', expiryValue2);
await closeSheet();

// 设置里的复验档位截图
await seed(undefined);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.section-title', { hasText: '识别精度' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/verify-02-mode.png', fullPage: false });
const modeSelected = await page.locator('.screen .segmented').filter({ hasText: '每次都复验' }).locator('button.on').innerText();
check('设置里默认选中「每次都复验」', modeSelected.trim() === '每次都复验', modeSelected.trim());

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
