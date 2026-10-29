/**
 * 深度检查：老数据迁移、入库合并、件数换算、删除与持久化。
 *  1 旧 schema 快照：演示档案与 seeded 记录被清掉，到期日按新规则回迁
 *  2 设置缺字段时补默认值（复验默认最高精度）
 *  3 同条码 + 同到期日 + 同位置再次入库 → 合并数量与件数
 *  4 改件数时按单件克数换算总克数
 *  5 删除记录后刷新页面，删除结果保留
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

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
      schema: 2,
      skus: [
        {
          gtin: '6901234567892',
          name: '老数据猫粮',
          brand: '测试牌',
          manufacturer: '测试食品有限公司',
          ingredientsRaw: '鸡肉、鸡肝',
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
        {
          gtin: '6999999999999',
          name: '演示商品',
          brand: '演示',
          manufacturer: '',
          ingredientsRaw: '',
          ingredients: [],
          additives: [],
          allergens: [],
          source: 'demo',
          version: 1,
          confidence: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      items: [
        {
          id: 'item-real',
          gtin: '6901234567892',
          productionDate: '2025-05-01',
          expiryDate: '2026-11-01',
          quantity: 500,
          unit: '克',
          location: '厨房',
          createdAt: Date.now(),
        },
        {
          id: 'item-seeded',
          gtin: '6901234567892',
          quantity: 100,
          unit: '克',
          location: '厨房',
          seeded: true,
          createdAt: Date.now(),
        },
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const snapshot = () => readSeededState(page);

const after = await snapshot();
check('1 演示档案被清掉', !after.skus.some((sku) => sku.source === 'demo'), after.skus.map((s) => s.name).join(' / '));
check('1 seeded 记录被清掉', !after.items.some((item) => item.id === 'item-seeded'), `剩 ${after.items.length} 条`);
check('1 到期日按新规则回迁', after.items[0].expiryDate === '2026-10-31', after.items[0].expiryDate);
check('2 复验档位默认最高', after.settings.verifyMode === 'always', String(after.settings.verifyMode));

// 3. 同条码同到期日同位置再次入库 → 合并
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(500);
await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().fill('100');
await page.locator('.sheet label.field', { hasText: /^存放位置/ }).locator('input').first().fill('厨房');
await page.locator('.sheet label.field', { hasText: /^生产日期/ }).locator('input').first().fill('2025-05-01');
await page.waitForTimeout(300);
const expiryShown = await page.locator('.sheet label.field', { hasText: /^到期日/ }).locator('input').first().inputValue();
check('3 到期日按「生产日期 + 保质期 − 1 天」自动算出', expiryShown === '2026-10-31', expiryShown);
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);

const mergedRows = await page.locator('.list-item').allInnerTexts();
check('3 合并成一条库存', mergedRows.length === 1, `${mergedRows.length} 条`);
check('3 数量与件数累加', /600\s*克/.test(mergedRows[0]) && mergedRows[0].includes('2 件'), mergedRows[0].replace(/\s+/g, ' '));

// 4. 改件数按单件克数换算
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await page.locator('.sheet label.field', { hasText: /^(件数|数量)/ }).getByRole('button', { name: '增加' }).click();
await page.waitForTimeout(700);
const stateAfterCount = await snapshot();
const quantityValue = stateAfterCount.items[0]?.quantity;
const perUnitValue = await page.locator('.sheet label.field', { hasText: /重量/ }).locator('input').first().inputValue();
check(
  '4 件数 2→3 时总克数按单件换算',
  Math.abs(Number(quantityValue) - 900) < 0.01 && Math.abs(Number(perUnitValue) - 300) < 0.01,
  `单件 ${perUnitValue} 克 · 共 ${quantityValue} 克`,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 5. 删除记录 + 刷新
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '删除这条记录' }).click();
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const finalState = await snapshot();
check('5 删除后刷新仍为空', finalState.items.length === 0, `剩 ${finalState.items.length} 条`);
check('5 商品档案保留', finalState.skus.length === 1 && finalState.skus[0].name === '老数据猫粮', finalState.skus.map((s) => s.name).join(' / '));

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
