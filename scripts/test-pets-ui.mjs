/**
 * 阶段 1 界面验收：
 *  1.1 两只宠物 + 库存按宠筛选 + 录入时归属宠物
 *  1.2 分类筛选 + 开封后到期日自动预填且可改
 *  1.4 每日建议克数 + 投喂记录扣库存
 *  1.5 三维存量统计
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
const today = new Date();
const iso = (offset) => {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const sku = (gtin, name, category) => ({
  gtin,
  name,
  brand: '测试牌',
  manufacturer: '测试宠物食品有限公司',
  ingredientsRaw: '鸡肉',
  ingredients: [],
  additives: [],
  allergens: [],
  category,
  kind: 'staple',
  shelfLifeText: '18个月',
  source: 'manual',
  version: 1,
  confidence: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 4,
  skus: [sku('6901234567892', '测试干粮', 'dry'), sku('6901234567908', '测试湿粮罐', 'wet')],
  items: [
    { id: 'item-a', gtin: '6901234567892', quantity: 1500, unit: '克', location: '厨房', petId: 'p1', expiryDate: iso(120), createdAt: Date.now() },
    { id: 'item-b', gtin: '6901234567908', quantity: 200, unit: '克', location: '阳台', petId: 'p2', expiryDate: iso(200), createdAt: Date.now() },
  ],
  pets: [
    { id: 'p1', name: '奶糖', species: 'cat', breed: '金渐层', weightKg: 5, birthDate: '2020-01-01', gender: 'female', neutered: true, avatar: '🐱', createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'p2', name: '团子', species: 'cat', breed: '布偶', weightKg: 4, birthDate: '2022-01-01', gender: 'male', neutered: false, avatar: '🐈', createdAt: Date.now(), updatedAt: Date.now() },
  ],
  feedings: Array.from({ length: 7 }).map((_, index) => ({
    id: `f${index}`,
    petId: 'p1',
    itemId: 'item-a',
    gtin: '6901234567892',
    grams: 50,
    date: iso(-index),
    createdAt: Date.now(),
  })),
  activePetId: 'p1',
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// 1.1 宠物多 Tab
await page.getByRole('button', { name: '宠物', exact: true }).click();
await page.waitForTimeout(500);
check('1.1 两只宠物都在', (await page.locator('.pet-tab:not(.pet-tab-add)').count()) === 2, `${await page.locator('.pet-tab:not(.pet-tab-add)').count()} 只`);
await page.getByRole('button', { name: /团子/ }).click();
await page.waitForTimeout(400);
check('1.1 切换宠物生效', (await page.locator('.pet-head .li-title').innerText()) === '团子');

// 1.4 每日建议克数
await page.getByRole('button', { name: /奶糖/ }).click();
await page.waitForTimeout(400);
const energyCard = (await page.locator('.card', { hasText: 'MER' }).innerText()).replace(/\s+/g, ' ');
check('1.4 5kg 绝育成猫建议约 58.5g', energyCard.includes('58.5'), energyCard.slice(0, 80));
await page.screenshot({ path: 'shots/pets-01-overview.png', fullPage: false });

// 库存页不显示宠物筛选、宠物名或公共标签
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(500);
const pantryText = await page.locator('.screen').innerText();
check('库存页不显示所有宠物/公共筛选', !pantryText.includes('所有宠物') && !pantryText.includes('公共'));
check('库存页不显示宠物名称', !pantryText.includes('奶糖') && !pantryText.includes('团子'));
check('库存仍展示全部 2 条记录', (await page.locator('.list-item').count()) === 2);

// 库存用途筛选保持「全部 / 主食 / 零食」
const pantryKindRow = page.locator('.screen > .segmented').last();
check('库存用途筛选保持全部/主食/零食', /全部\s*主食\s*零食/.test(await pantryKindRow.innerText()));
const pantryFoodRow = page.locator('.screen > .segmented').filter({ hasText: '全部干湿' });
check('库存提供全部干湿/干粮/湿粮筛选', /全部干湿\s*干粮\s*湿粮/.test(await pantryFoodRow.innerText()));

// 1.2 开封后到期日自动预填
await page.locator('.list-item').first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '记录开封' }).click();
await page.waitForTimeout(700);
let state = await readSeededState(page);
let opened = state.items.find((item) => item.id === 'item-a');
check('1.2 开封后到期日自动预填 42 天', opened?.openedExpiryDate === iso(42), opened?.openedExpiryDate);
const openedField = page.locator('.sheet label.field', { hasText: '开封后到期日' }).locator('input').first();
check('1.2 开封效期在页面上可见', (await openedField.count()) === 1);
await openedField.fill(iso(30));
await page.waitForTimeout(500);
state = await readSeededState(page);
opened = state.items.find((item) => item.id === 'item-a');
check('1.2 开封效期可改', opened?.openedExpiryDate === iso(30), opened?.openedExpiryDate);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 1.4 投喂记录 + 扣库存
await page.getByRole('button', { name: '宠物', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '记录一次投喂' }).click();
await page.waitForTimeout(400);
await page.locator('.sheet label.field', { hasText: '吃掉的克数' }).locator('input').first().fill('60');
await page.getByRole('button', { name: '保存投喂' }).click();
await page.waitForTimeout(700);
state = await readSeededState(page);
opened = state.items.find((item) => item.id === 'item-a');
check('1.4 投喂后库存自动扣 60g', opened?.quantity === 1440, `${opened?.quantity} 克`);
check('1.4 投喂记录已保存', state.feedings.length === 8, `${state.feedings.length} 条`);
const recent = (await page.locator('.feed-list').innerText()).replace(/\s+/g, ' ');
check('1.4 最近投喂显示 60 克', recent.includes('60 克'), recent.slice(0, 60));

// 1.5 三维存量统计
await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.waitForTimeout(500);
const stockCard = (await page.locator('.card', { hasText: '可吃天数' }).first().innerText()).replace(/\s+/g, ' ');
check('1.5 按分类存量与天数', stockCard.includes('干粮') && stockCard.includes('天'), stockCard.slice(0, 80));
await page.getByRole('tab', { name: '按宠物', exact: true }).click();
await page.waitForTimeout(400);
const petStock = (await page.locator('.card', { hasText: '可吃天数' }).first().innerText()).replace(/\s+/g, ' ');
check('1.5 按宠物统计', petStock.includes('奶糖') && petStock.includes('团子'), petStock.slice(0, 80));
await page.screenshot({ path: 'shots/pets-02-stock.png', fullPage: false });
await page.getByRole('tab', { name: '全家庭', exact: true }).click();
await page.waitForTimeout(400);
const allStock = (await page.locator('.card', { hasText: '可吃天数' }).first().innerText()).replace(/\s+/g, ' ');
check('1.5 全家庭统计', allStock.includes('全家庭'), allStock.slice(0, 60));

// 1.1 录入时选择归属宠物
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder('13 位商品条码').fill('6901234567908');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 15000 });
await page.waitForTimeout(500);
await page.locator('.sheet').getByRole('tab', { name: '团子', exact: true }).click();
await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().fill('100');
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(800);
state = await readSeededState(page);
check('1.1 录入的商品带上 pet_id', state.items.some((item) => item.petId === 'p2' && item.quantity === 100), JSON.stringify(state.items.map((item) => [item.id, item.petId, item.quantity])));

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
