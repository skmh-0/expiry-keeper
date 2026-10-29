/**
 * 阶段 1.5 计算引擎验收：
 * 1.5.1 整包可吃天数 / 1.5.2 今日额度 / 1.5.4 年度加强
 * 1.5.5 驱虫周期 / 1.5.6 不补发 / 1.5.7 生命阶段 / 1.5.8 品种联想
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(url, { waitUntil: 'networkidle' });

const rows = await page.evaluate(async () => {
  const pets = await import('/src/lib/pets.ts');
  const budget = await import('/src/lib/feedingBudget.ts');
  const care = await import('/src/lib/care.ts');
  const carePlan = await import('/src/lib/carePlan.ts');
  const breeds = await import('/src/lib/breeds.ts');
  const shelf = await import('/src/lib/shelfLife.ts');
  const checks = [];
  const check = (label, ok, detail = '') =>
    checks.push({ label, ok: Boolean(ok), detail: String(detail ?? '') });
  const today = shelf.todayIso();
  const pet = {
    id: 'p1',
    name: '奶糖',
    species: 'cat',
    breed: '英短',
    weightKg: 5,
    birthDate: '2020-01-01',
    gender: 'female',
    neutered: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const dry = {
    gtin: '6900000000001',
    name: '测试主粮',
    brand: '测试',
    manufacturer: '',
    ingredientsRaw: '',
    ingredients: [],
    additives: [],
    allergens: [],
    category: 'dry',
    packageGrams: 1500,
    nutrition: { metabolizableEnergy: '4000 kcal/kg' },
    source: 'manual',
    version: 1,
    confidence: {},
    createdAt: 0,
    updatedAt: 0,
  };
  const freeze = {
    ...dry,
    gtin: '6900000000002',
    name: '测试冻干',
    category: 'freeze_dried',
    packageGrams: 300,
    nutrition: { metabolizableEnergy: '3600 kcal/kg' },
  };
  const noNutrition = {
    ...dry,
    gtin: '6900000000003',
    name: '无营养表罐头',
    category: 'wet',
    packageGrams: 85,
    nutrition: {},
  };
  const item = {
    id: 'item-dry',
    gtin: dry.gtin,
    quantity: 1500,
    unit: '克',
    petId: pet.id,
    count: 1,
    location: '',
    createdAt: Date.now(),
  };
  const itemFreeze = {
    ...item,
    id: 'item-freeze',
    gtin: freeze.gtin,
    quantity: 300,
  };
  const itemNoNutrition = {
    ...item,
    id: 'item-no-nutrition',
    gtin: noNutrition.gtin,
    quantity: 85,
  };
  const plan = pets.energyPlan(pet, today);
  const packageStats = pets.pkgStats(dry, pet, today);
  check('1.5.1 1.5kg/4000kcal 对 5kg 绝育猫约 25 天', packageStats?.days === 25, packageStats?.days);
  check('1.5.1 500g×6包只取单包 500g', pets.parsePackageGrams('500g×6包') === 500, pets.parsePackageGrams('500g×6包'));
  check('1.5.1 1.5kg 规格换算 1500g', pets.parsePackageGrams('净含量 1.5kg') === 1500, pets.parsePackageGrams('净含量 1.5kg'));
  check('1.5.1 未填净含量不显示计划', pets.pkgStats({ ...dry, packageGrams: undefined }, pet, today) === undefined);

  const feedings = [
    {
      id: 'f1',
      petId: pet.id,
      itemId: item.id,
      gtin: dry.gtin,
      grams: 40,
      date: today,
      createdAt: Date.now(),
    },
    {
      id: 'f2',
      petId: pet.id,
      itemId: itemNoNutrition.id,
      gtin: noNutrition.gtin,
      grams: 20,
      date: today,
      createdAt: Date.now(),
    },
    {
      id: 'yesterday',
      petId: pet.id,
      itemId: item.id,
      gtin: dry.gtin,
      grams: 999,
      date: shelf.shiftDays(today, -1),
      createdAt: Date.now(),
    },
  ];
  const day = budget.todayBudget(
    pet,
    [item, itemFreeze, itemNoNutrition],
    [dry, freeze, noNutrition],
    feedings,
    today,
  );
  check('1.5.2 40g 主粮折算 160kcal', day?.consumed === 160, day?.consumed);
  check('1.5.2 剩余额度约 74kcal', day && Math.abs(day.remaining - (plan.mer - 160)) < 0.2, day?.remaining);
  const freezeFood = day?.items.find((food) => food.gtin === freeze.gtin);
  check('1.5.2 冻干还能吃约 20g', freezeFood && freezeFood.canEatGrams >= 19 && freezeFood.canEatGrams <= 22, freezeFood?.canEatGrams);
  check('1.5.2 昨天记录不计入今天', day?.consumed === 160, day?.consumed);
  check('1.5.2 无营养数据明确提示', day?.uncounted.includes(noNutrition.name), day?.uncounted.join('/'));
  const noMeal = budget.todayBudget(pet, [item, itemFreeze], [dry, freeze], [], today);
  check('1.5.2 今天没喂显示全额', noMeal?.consumed === 0 && noMeal.remaining > 200, `${noMeal?.consumed}/${noMeal?.remaining}`);
  const afterDelete = budget.todayBudget(pet, [item, itemFreeze], [dry, freeze], feedings.slice(1, 2), today);
  check('1.5.2 删除有营养记录后实时减少', afterDelete?.consumed === 0, afterDelete?.consumed);

  const vaccines = [
    {
      id: 'v1',
      petId: pet.id,
      vaccineName: '妙三多',
      vaccineKind: 'combo',
      doseDate: '2026-04-10',
      source: 'manual',
      confirmed: true,
      createdAt: Date.now(),
    },
    {
      id: 'v2',
      petId: pet.id,
      vaccineName: '狂犬疫苗',
      vaccineKind: 'rabies',
      doseDate: '2026-04-10',
      source: 'manual',
      confirmed: true,
      createdAt: Date.now(),
    },
  ];
  const schedules = care.vaccineSchedule(vaccines);
  const combo = schedules.find((entry) => entry.kind === 'combo');
  const rabies = schedules.find((entry) => entry.kind === 'rabies');
  check('1.5.4 末针 +1 年生成联苗日程', combo?.dueDate === '2027-04-10', combo?.dueDate);
  check('1.5.4 狂犬也生成年度日程', rabies?.dueDate === '2027-04-10', rabies?.dueDate);
  const firstShots = care.firstVaccineSchedule(pet);
  const thirdCombo = firstShots.find((item) => item.label === '第三针联苗')?.date;
  const rabiesFirst = firstShots.find((item) => item.label === '狂犬疫苗')?.date;
  check(
    '1.5.4 狂犬首免为第三针联苗后 1 个月',
    Boolean(thirdCombo) && rabiesFirst === shelf.shiftMonths(thirdCombo, 1),
    `${thirdCombo} → ${rabiesFirst}`,
  );
  const comboSlots = care.vaccineReminderSlots(combo);
  check('1.5.4 联苗提前 7 天', comboSlots.find((slot) => slot.role === 'before')?.date === '2027-04-03');
  check('1.5.4 错过提醒第 22 天封顶', comboSlots.filter((slot) => slot.role === 'miss').at(-1)?.date === '2027-05-01');
  check('1.5.4 missCount 上限 4', care.weeklyMissCount('2027-04-10', '2027-05-20') === 4, care.weeklyMissCount('2027-04-10', '2027-05-20'));

  const kitten = { ...pet, birthDate: shelf.shiftDays(today, -150) };
  const adult = { ...pet, birthDate: shelf.shiftDays(today, -365 * 3) };
  check('1.5.5 5 月龄体内周期 30 天', care.dewormIntervalDays(kitten, 'internal', today) === 30);
  check('1.5.5 成年体内周期 90 天', care.dewormIntervalDays(adult, 'internal', today) === 90);
  check('1.5.5 满 6 月后新排程切 90 天', care.dewormIntervalDays(kitten, 'internal', shelf.shiftDays(today, 60)) === 90);
  check('1.5.5 体外固定 30 天', care.dewormIntervalDays(kitten, 'external', today) === 30);

  const seniorPet = { ...pet, birthDate: shelf.shiftDays(today, -365 * 9) };
  const intactPet = { ...pet, neutered: false };
  const adultMer = pets.energyPlan(pet, today)?.mer ?? 0;
  const seniorMer = pets.energyPlan(seniorPet, today)?.mer ?? 0;
  const intactMer = pets.energyPlan(intactPet, today)?.mer ?? 0;
  check('每日热量 MER 按年龄变化 · 老年低于成年', seniorMer < adultMer, `${seniorMer}/${adultMer}`);
  check('每日热量 MER 按绝育状态变化 · 未绝育高于已绝育', intactMer > adultMer, `${intactMer}/${adultMer}`);

  const baseSettings = {
    apiKey: '',
    remindEnabled: false,
    remindDays: 7,
    reminders: {
      expiryEnabled: false,
      vaccineEnabled: true,
      dewormEnabled: true,
      enabledAt: { vaccine: Date.parse('2027-01-01T00:00:00'), deworm: Date.parse('2026-11-01T00:00:00') },
    },
  };
  const careNotifications = carePlan.planCareNotifications(
    [pet],
    vaccines,
    [],
    baseSettings,
    {},
    Date.parse('2027-03-01T00:00:00'),
  );
  check('1.5.4 联苗与狂犬各 5 个提醒时点', careNotifications.notifications.length === 10, careNotifications.notifications.length);
  const noBackfill = carePlan.planCareNotifications(
    [pet],
    [{ ...vaccines[0], doseDate: '2025-04-10' }],
    [],
    { ...baseSettings, reminders: { ...baseSettings.reminders, enabledAt: { vaccine: Date.parse('2027-01-01') } } },
    {},
    Date.parse('2027-03-01T00:00:00'),
  );
  check('1.5.6 开关前已错过的日程不补推', noBackfill.notifications.length === 0, noBackfill.notifications.length);

  check('1.5.7 11 月龄为幼年', pets.petStage({ ...pet, birthDate: shelf.shiftDays(today, -335) }, today) === 'young');
  check('1.5.7 97 月龄为老年', pets.petStage({ ...pet, birthDate: shelf.shiftDays(today, -2950) }, today) === 'senior');
  const gold = breeds.breedSuggestions('cat', '金');
  check('1.5.8 「金」命中金渐层', gold.some((entry) => entry.name === '金渐层'), gold.map((entry) => entry.name).join('/'));
  const blue = breeds.breedSuggestions('cat', '蓝猫');
  check('1.5.8 「蓝猫」按别名命中英短', blue[0]?.name === '英国短毛猫' && blue[0]?.reason === '别名匹配', blue[0]?.name);
  const custom = breeds.breedSuggestions('cat', '我家串串');
  check('1.5.8 自定义串串不强行匹配', custom.length === 0, custom.length);
  check('1.5.8 猫品种库 40-70 个', breeds.BREEDS.cat.length >= 40 && breeds.BREEDS.cat.length <= 70, breeds.BREEDS.cat.length);
  check('1.5.8 犬品种库 60-100 个', breeds.BREEDS.dog.length >= 60 && breeds.BREEDS.dog.length <= 100, breeds.BREEDS.dog.length);
  check('1.5 空输入给 TOP8 常用品种', breeds.breedSuggestions('cat', '').length === 8);

  return checks;
});

let failed = 0;
for (const row of rows) {
  if (!row.ok) failed += 1;
  console.log(`${row.ok ? '通过' : '失败'} · ${row.label}${row.detail ? ` · ${row.detail}` : ''}`);
}
await browser.close();
if (failed) {
  console.error(`失败 ${failed} 项`);
  process.exit(1);
}
console.log('全部通过');

