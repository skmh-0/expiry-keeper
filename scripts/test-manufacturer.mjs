/**
 * 厂家字段回归：模型把「委托方 / 品牌方」写进 manufacturer 时，
 * 要先取受托方，再剥掉标签与括号说明，别把品牌商当成生产商。
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { seedState } from './seed-state.mjs';

const STUB_KEY = ['s', 'k', '-', 'stub'].join('');

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const sampleImage = existsSync('shots/label-1400.jpg') ? 'shots/label-1400.jpg' : 'public/icon-round.png';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

let payload = {};
await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });
});

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 3,
  skus: [],
  items: [],
  settings: { apiKey: STUB_KEY, remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const cases = [
  {
    title: '委托方 + 受托方 → 取受托方',
    model: '委托方：上海某宠物用品有限公司  受托方：山东汉欧生物科技有限公司',
    expect: '山东汉欧生物科技有限公司',
    owner: '上海某宠物用品有限公司',
  },
  {
    title: '带「生产企业：」前缀和地址 → 只留公司名',
    model: '生产企业：乖宝宠物食品集团股份有限公司（山东省聊城市）',
    expect: '乖宝宠物食品集团股份有限公司',
    owner: '测试品牌管理有限公司',
  },
  {
    title: '括号里标着受托方 → 剥掉括号',
    model: '山东帅克宠物用品股份有限公司（受托方）',
    expect: '山东帅克宠物用品股份有限公司',
    owner: '测试品牌管理有限公司',
  },
  {
    title: '纯公司名 → 原样保留',
    model: '烟台中宠食品股份有限公司',
    expect: '烟台中宠食品股份有限公司',
    owner: '测试品牌管理有限公司',
  },
];

for (const item of cases) {
  payload = {
    gtin: '6901234567892',
    name: '测试猫粮 100g',
    brand: '测试牌',
    brandOwner: `委托方：${item.owner}`,
    manufacturer: item.model,
    ingredientsRaw: '鸡肉',
    shelfLifeText: '18个月',
    confidence: { manufacturer: 0.9 },
  };
  await page.locator('input[type=file]').nth(1).setInputFiles(sampleImage);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /识别这 \d+ 张/ }).click();
  await page.waitForSelector('.sheet', { timeout: 20000 });
  await page.waitForTimeout(500);
  const value = await page.locator('.sheet label.field', { hasText: '生产厂家' }).locator('input').first().inputValue();
  check(item.title, value === item.expect, `得到「${value}」，期望「${item.expect}」`);
  const owner = await page.locator('.sheet label.field', { hasText: '品牌商 / 委托方' }).locator('input').first().inputValue();
  check(`${item.title} · 品牌商独立保存`, owner === item.owner, `得到「${owner}」，期望「${item.owner}」`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

await page.locator('input[type=file]').nth(1).setInputFiles(sampleImage);
await page.waitForTimeout(800);
payload = {
  gtin: '6901234567892',
  name: '测试猫粮 100g',
  brand: '测试牌',
  manufacturer: '委托方：上海某宠物用品有限公司 受托方：山东汉欧生物科技有限公司',
  ingredientsRaw: '鸡肉',
  shelfLifeText: '18个月',
};
await page.getByRole('button', { name: /识别这 \d+ 张/ }).click();
await page.waitForSelector('.sheet', { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/maker-01-manufacturer.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
