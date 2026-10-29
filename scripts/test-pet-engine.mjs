/**
 * 阶段 1 计算引擎验收（通过 Vite 页面加载 TS 模块）：
 *  1 5kg 绝育成猫 + 4000 kcal/kg ≈ 55~60 g/天
 *  2 幼年 / 未绝育 / 老年系数
 *  3 分类开封效期预设
 *  4 7 天滑动窗口日均消耗与剩余天数（误差 ±1 天）
 *  5 连续 7 天超推荐 110% 预警
 *  6 三维存量统计
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(url, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const pets = await import('/src/lib/pets.ts');
  const estimate = await import('/src/lib/estimate.ts');
  const intake = await import('/src/lib/intake.ts');
  const life = await import('/src/lib/shelfLife.ts');
  const checks = [];
  const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail: String(detail ?? '') });
  const round = (value) => Math.round(value * 10) / 10;

  const basePet = {
    id: 'p1',
    name: '奶糖',
    species: 'cat',
    breed: '金渐层',
    weightKg: 5,
    birthDate: '2020-01-01',
    gender: 'female',
    neutered: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const plan = pets.energyPlan(basePet);
  check('1 RER = 70×5^0.75', plan && Math.abs(plan.rer - 234.06) < 0.2, round(plan?.rer ?? 0));
  check('1 绝育成猫系数 1.0', plan?.factor === 1, plan?.factor);
  const grams = pets.dailyGrams(plan, 4000);
  check('1 5kg 绝育成猫 · 4000kcal/kg ≈55~60g', grams !== undefined && grams >= 55 && grams <= 60, `${grams} g/天`);

  const today = life.todayIso();
  const young = pets.energyPlan({ ...basePet, birthDate: life.shiftDays(today, -200) });
  check('2 幼年系数 1.2', young?.factor === 1.2, young?.factor);
  check('2 幼年识别约 7 个月', pets.petAgeMonths({ ...basePet, birthDate: life.shiftDays(today, -200) }) === 7, '约 7 个月');
  const intact = pets.energyPlan({ ...basePet, neutered: false });
  check('2 成猫未绝育系数 1.2', intact?.factor === 1.2, intact?.factor);
  const senior = pets.energyPlan({ ...basePet, birthDate: life.shiftDays(today, -365 * 9) });
  check('2 老年系数 0.8', senior?.factor === 0.8, senior?.factor);

  const drySku = { gtin: '6901', name: '干粮', brand: '测试', manufacturer: '', ingredientsRaw: '', ingredients: [], additives: [], allergens: [], category: 'dry', source: 'manual', version: 1, confidence: {}, createdAt: 0, updatedAt: 0 };
  const wetSku = { ...drySku, gtin: '6902', category: 'wet' };
  const fdSku = { ...drySku, gtin: '6903', category: 'freeze_dried' };
  const freshSku = { ...drySku, gtin: '6904', category: 'fresh_raw' };
  const legacySku = { ...drySku, gtin: '6905', category: 'other' };
  check('3 干粮开封 42 天', pets.openedExpirySuggestion(drySku, '2026-10-01') === '2026-11-12', pets.openedExpirySuggestion(drySku, '2026-10-01'));
  check('3 湿粮开封 2 天', pets.openedExpirySuggestion(wetSku, '2026-10-01') === '2026-10-03', pets.openedExpirySuggestion(wetSku, '2026-10-01'));
  check('3 冻干开封 30 天', pets.openedExpirySuggestion(fdSku, '2026-10-01') === '2026-10-31', pets.openedExpirySuggestion(fdSku, '2026-10-01'));
  check('3 鲜粮开封 3 天', pets.openedExpirySuggestion(freshSku, '2026-10-01') === '2026-10-04', pets.openedExpirySuggestion(freshSku, '2026-10-01'));
  check('3 旧「其他」归入用品耗材', pets.categoryOf(legacySku) === 'supplies', pets.categoryOf(legacySku));

  const feedings = Array.from({ length: 7 }).map((_, index) => ({
    id: `f${index}`,
    petId: 'p1',
    itemId: 'item-a',
    grams: 50,
    date: life.shiftDays(today, -index),
    createdAt: Date.now(),
  }));
  const item = { id: 'item-a', gtin: '6901', quantity: 1150, unit: '克', location: '', petId: 'p1', createdAt: Date.now() };
  const one = estimate.estimateItem(item, drySku, feedings, today);
  check('4 7 天日均消耗 50g', one?.daily === 50, one?.daily);
  check('4 剩余 23 天（误差 ±1 天）', one?.remainingDays !== undefined && Math.abs(one.remainingDays - 23) <= 1, `${one?.remainingDays} 天`);
  check('4 预警线 = 日均×7 = 350g', one?.warningGrams === 350, one?.warningGrams);

  const overFeedings = Array.from({ length: 7 }).map((_, index) => ({
    id: `o${index}`,
    petId: 'p1',
    grams: 60,
    date: life.shiftDays(today, -index),
    createdAt: Date.now(),
  }));
  const over = intake.dailyIntake(overFeedings, 'p1', 50, 7, today);
  check('5 连续 7 天 >110% 触发预警', over.warning && over.overStreak === 7, `连续 ${over.overStreak} 天`);
  const sixDays = intake.dailyIntake(overFeedings.slice(0, 6), 'p1', 50, 7, today);
  check('5 只有 6 天数据不预警', !sixDays.warning && sixDays.overStreak === 6, `连续 ${sixDays.overStreak} 天`);

  const petList = [basePet, { ...basePet, id: 'p2', name: '团子' }];
  const itemList = [
    item,
    { id: 'item-b', gtin: '6902', quantity: 200, unit: '克', location: '', petId: 'p2', createdAt: Date.now() },
  ];
  const byPet = estimate.summarizeStock(itemList, [drySku, wetSku], feedings, petList, 'pet', today);
  check('6 按宠物分组', byPet.length === 2 && byPet[0].label === '奶糖' && byPet[1].label === '团子', byPet.map((group) => group.label).join('/'));
  check('6 奶糖可吃天数约 23 天', Math.abs((byPet[0].remainingDays ?? 0) - 23) <= 1, `${byPet[0].remainingDays} 天`);
  const byCategory = estimate.summarizeStock(itemList, [drySku, wetSku], feedings, petList, 'category', today);
  check('6 按分类分组', byCategory.some((group) => group.label === '干粮') && byCategory.some((group) => group.label === '湿粮罐头'), byCategory.map((group) => group.label).join('/'));
  return checks;
});

let failed = 0;
for (const item of results) {
  if (!item.ok) failed += 1;
  console.log(`${item.ok ? '通过' : '失败'} · ${item.label}${item.detail ? ` · ${item.detail}` : ''}`);
}
console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
