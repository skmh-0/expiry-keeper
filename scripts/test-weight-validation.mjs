/** P3/P4：负体重必须明确报错，超过 100kg 只软提醒；图标文字 placeholder 不与商品名撞车。 */
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
const now = Date.now();
const today = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 5,
  skus: [],
  items: [],
  feedings: [],
  vaccinations: [],
  dewormings: [],
  pets: [
    {
      id: 'p1',
      name: '奶糖',
      species: 'cat',
      weightKg: 5,
      gender: 'female',
      neutered: true,
      avatar: '🐱',
      createdAt: now,
      updatedAt: now,
    },
  ],
  activePetId: 'p1',
  settings: {
    apiKey: '',
    remindEnabled: false,
    remindDays: 7,
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

await page.getByRole('button', { name: '宠物', exact: true }).click();
await page.getByRole('button', { name: '编辑宠物档案' }).click();
const weightField = page.locator('.sheet .field', { hasText: '体重' }).locator('input').first();
check('旧体重默认按斤显示', (await weightField.inputValue()) === '10', await weightField.inputValue());
await page.locator('.sheet .field', { hasText: '体重' }).getByRole('tab', { name: '克', exact: true }).click();
await page.waitForTimeout(150);
check('切到克后 5kg 显示 5000 克', (await weightField.inputValue()) === '5000', await weightField.inputValue());
await page.locator('.sheet .field', { hasText: '体重' }).getByRole('tab', { name: '斤', exact: true }).click();
await page.waitForTimeout(150);
check('切回斤后 5kg 恢复 10 斤', (await weightField.inputValue()) === '10', await weightField.inputValue());
await page.getByRole('button', { name: '更换头像' }).click();
check(
  '头像每次可选择拍照或相册',
  (await page.locator('.avatar-source-picker').innerText()).includes('拍照') &&
    (await page.locator('.avatar-source-picker').innerText()).includes('从相册选择'),
);
await weightField.fill('-5');
await page.waitForTimeout(200);
check('档案体重 -5 立即提示不能为负', (await page.locator('.sheet').innerText()).includes('体重不能为负'));
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(250);
const afterNegative = await readSeededState(page);
check('负体重保存被阻止且不会偷偷存成 5', afterNegative.pets[0].weightKg === 5, afterNegative.pets[0].weightKg);
check('负体重保存后抽屉仍打开', (await page.locator('.sheet').count()) === 1);

await page.locator('.sheet .field', { hasText: '体重' }).getByRole('tab', { name: '公斤', exact: true }).click();
await weightField.fill('101');
await page.waitForTimeout(200);
check(
  '101kg 只给软提醒',
  (await page.locator('.sheet').innerText()).includes('体重超过 100kg') &&
    (await page.getByRole('button', { name: '保存', exact: true }).isEnabled()),
);
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('button', { name: /记录体重/ }).click();
const quickWeight = page.locator('.sheet .field', { hasText: '当前体重' }).locator('input').first();
await quickWeight.fill('-7');
await page.waitForTimeout(200);
check('快捷体重 -7 明确提示', (await page.locator('.sheet').innerText()).includes('体重不能为负'));
check('快捷体重负值不能提交', await page.getByRole('button', { name: '保存体重' }).isDisabled());
await quickWeight.fill('99999');
await page.waitForTimeout(200);
check(
  '快捷体重 99999kg 给软提醒且不崩',
  (await page.locator('.sheet').innerText()).includes('体重超过 100kg') &&
    (await page.getByRole('button', { name: '保存体重' }).isEnabled()),
);
await page.locator('.sheet .field', { hasText: '当前体重' }).getByRole('tab', { name: '克', exact: true }).click();
await quickWeight.fill('100');
await page.getByRole('button', { name: '保存体重' }).click();
await page.waitForTimeout(500);
const afterKittenWeight = await readSeededState(page);
check(
  '幼猫 100 克按 0.1kg 入库并保留克单位',
  afterKittenWeight.pets[0].weightKg === 0.1 && afterKittenWeight.pets[0].weightUnit === 'g',
  `${afterKittenWeight.pets[0].weightKg}/${afterKittenWeight.pets[0].weightUnit}`,
);

await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet');
const iconPlaceholder = await page.locator('.sheet input[name="iconLabel"]').getAttribute('placeholder');
check('图标文字 placeholder 不再与商品名撞车', iconPlaceholder === '品牌缩写，最多 4 字', iconPlaceholder);

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

