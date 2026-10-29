/** P3：老快照缺字段时必须补默认值，不能因 undefined 访问白屏。 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })).newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
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
      category: 'other',
      ingredientsRaw: null,
      nutrition: null,
      confidence: null,
    },
  ],
  items: [
    {
      id: 'legacy-item',
      gtin: '6901234567892',
      quantity: null,
      unit: null,
      location: null,
      createdAt: null,
    },
  ],
  pets: [
    {
      id: 'legacy-pet',
      name: null,
      species: 'unknown-species',
      weightKg: null,
      weightHistory: null,
      createdAt: null,
      updatedAt: null,
    },
  ],
  feedings: [
    {
      id: 'legacy-feed',
      grams: 20,
      date: null,
      createdAt: null,
    },
  ],
  vaccinations: [{ id: 'bad-vaccine', petId: 'legacy-pet', vaccineName: null, doseDate: null }],
  dewormings: [{ id: 'bad-deworm', petId: 'legacy-pet' }],
  makers: [{ city: '上海' }, { name: '测试厂家' }],
  activePetId: 'legacy-pet',
  settings: {},
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const state = await readSeededState(page);
const sku = state.skus[0];
const item = state.items[0];
const pet = state.pets[0];
check('旧 SKU 缺失字符串字段补齐', sku.name === '' && sku.brand === '' && sku.manufacturer === '');
check('旧 SKU 缺失数组字段补齐', Array.isArray(sku.ingredients) && Array.isArray(sku.additives) && Array.isArray(sku.allergens));
check('旧 SKU 缺失对象字段补齐', sku.confidence && typeof sku.confidence === 'object');
check('旧分类 other 迁移为用品', sku.category === 'supplies', sku.category);
check('旧库存单位与位置补齐', item.unit === '克' && item.location === '' && item.count === 1);
check('旧库存数量缺失降级为 0', item.quantity === 0, item.quantity);
check('旧宠物名与种类补齐', pet.name === '未命名宠物' && pet.species === 'cat', `${pet.name}/${pet.species}`);
check('旧宠物体重单位默认补成斤', pet.weightUnit === 'jin', pet.weightUnit);
check('旧宠物体重历史补齐为空数组', Array.isArray(pet.weightHistory), pet.weightHistory);
check('旧投喂日期补齐为今天', /^\d{4}-\d{2}-\d{2}$/.test(state.feedings[0].date), state.feedings[0].date);
check('坏疫苗/驱虫记录不会进入正式档案', state.vaccinations.length === 0 && state.dewormings.length === 0);
check('旧设置补齐三类提醒', Boolean(state.settings.reminders && 'expiryEnabled' in state.settings.reminders));
check('迁移后 schema 升级到 6', state.schema === 6, state.schema);

await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(350);
check('迁移后库存页可渲染', (await page.locator('.list-item').innerText()).includes('0克'));
await page.locator('.list-item').first().click();
await page.waitForTimeout(250);
check('迁移后商品详情可渲染', (await page.locator('.sheet').innerText()).includes('未命名商品'));
await page.getByRole('button', { name: '关闭' }).click();
await page.getByRole('button', { name: '宠物', exact: true }).click();
await page.waitForTimeout(250);
check('迁移后宠物页可渲染', (await page.locator('.pet-head').innerText()).includes('未命名宠物'));
check('迁移过程无 undefined 白屏异常', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

