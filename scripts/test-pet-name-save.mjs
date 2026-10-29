/** 安卓输入法回归：名字只写入 DOM、不触发 React change 时仍必须能保存。 */
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

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 6,
  skus: [],
  items: [],
  feedings: [],
  vaccinations: [],
  dewormings: [],
  pets: [],
  activePetId: '',
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
await page.getByRole('button', { name: '添加宠物' }).click();
const createName = page.getByPlaceholder('例如 奶糖');
await createName.evaluate((element) => {
  element.value = '奶糖';
});
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(600);
let state = await readSeededState(page);
check('新增宠物不触发 change 也能保存名字', state.pets[0]?.name === '奶糖', state.pets[0]?.name);
check('保存后宠物页显示名字', (await page.locator('.pet-head').innerText()).includes('奶糖'));

await page.getByRole('button', { name: '编辑宠物档案' }).click();
const editName = page.getByPlaceholder('例如 奶糖');
await editName.evaluate((element) => {
  element.value = '团子';
});
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(600);
state = await readSeededState(page);
check('编辑宠物不触发 change 也能保存名字', state.pets[0]?.name === '团子', state.pets[0]?.name);
check('编辑后宠物页同步新名字', (await page.locator('.pet-head').innerText()).includes('团子'));

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

