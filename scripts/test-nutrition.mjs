/**
 * 1.3 营养成分 + AI prompt：
 *  1 请求给模型的提示词里包含新的营养成分字段
 *  2 模型返回的营养成分能回填到确认页
 *  3 冻干分类能被识别并选中
 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const STUB_KEY = ['s', 'k', '-', 'stub'].join('');
let calls = [];
let payload = {};

await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  const body = route.request().postDataJSON();
  calls.push(body);
  const isVerify = JSON.stringify(body).includes('复验器');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(isVerify ? {} : payload) } }] }),
  });
});

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 4,
  skus: [],
  items: [],
  pets: [],
  feedings: [],
  activePetId: '',
  settings: { apiKey: STUB_KEY, remindEnabled: false, remindDays: 7, verifyMode: 'off' },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

payload = {
  gtin: '6901234567892',
  name: '测试冻干猫粮',
  brand: '测试牌',
  category: '冻干',
  kind: '主食',
  manufacturer: '测试宠物食品有限公司',
  ingredientsRaw: '鸡肉',
  shelfLifeText: '18个月',
  packageGrams: '500g×6包',
  nutrition: {
    metabolizableEnergy: '4000 kcal/kg',
    crudeProtein: '≥38%',
    crudeFat: '≥16%',
    crudeFiber: '≤5%',
    crudeAsh: '≤9%',
    moisture: '≤10%',
    taurine: '≥0.2%',
    calciumPhosphorus: '1.2:1',
  },
  confidence: { ingredientsRaw: 0.9, shelfLifeText: 0.9, manufacturer: 0.9 },
};

await page.locator('input[type=file]').nth(1).setInputFiles('shots/label-1400.jpg');
await page.waitForTimeout(800);
await page.getByRole('button', { name: /识别这 1 张/ }).click();
await page.waitForSelector('.sheet', { timeout: 20000 });
await page.waitForTimeout(600);

const prompt = JSON.stringify(calls[0] ?? {});
check('1 提示词包含代谢能字段', prompt.includes('metabolizableEnergy'));
check('1 提示词包含粗蛋白/粗灰分/牛磺酸', prompt.includes('crudeProtein') && prompt.includes('crudeAsh') && prompt.includes('taurine'));
check('1 提示词包含单包净含量字段', prompt.includes('packageGrams') && prompt.includes('只取单包克重'));

const value = (label) =>
  page.locator('.sheet label.field', { hasText: label }).locator('input').first().inputValue();
check('2 代谢能回填', (await value('代谢能')) === '4000 kcal/kg', await value('代谢能'));
check('2 粗蛋白回填', (await value('粗蛋白')) === '≥38%', await value('粗蛋白'));
check('2 钙磷比回填', (await value('钙磷比')) === '1.2:1', await value('钙磷比'));
check('2 乘法规格只回填单包 500g', (await value('净含量')) === '500', await value('净含量'));

const selected = (await page.locator('.sheet .segmented button.on').allInnerTexts()).map((text) => text.trim());
check('3 冻干分类被选中', selected.includes('冻干'), selected.join(' / '));
await page.screenshot({ path: 'shots/pets-01-nutrition.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
