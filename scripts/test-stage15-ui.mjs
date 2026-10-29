/**
 * 阶段 1.5 界面验收：
 * 日预算、净含量计划、疫苗本二次确认、驱虫、提醒中心、生命阶段、品种联想、头像。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
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
const now = Date.now();
const today = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const iso = (offset) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const sku = (gtin, name, category, me, packageGrams) => ({
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
  packageGrams,
  shelfLifeText: '18个月',
  nutrition: { metabolizableEnergy: me },
  source: 'manual',
  version: 1,
  confidence: {},
  createdAt: now,
  updatedAt: now,
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const storage = await import('/src/lib/storage.ts');
  await storage.putPhoto(
    'avatar_p1',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  );
});
await seedState(page, {
  schema: 5,
  skus: [
    sku('6901234567892', '测试主粮', 'dry', '4000 kcal/kg', 1500),
    sku('6901234567908', '测试冻干', 'freeze_dried', '3600 kcal/kg', 300),
    sku('6901234567915', '无营养表罐头', 'wet', '', 85),
  ],
  items: [
    {
      id: 'item-dry',
      gtin: '6901234567892',
      quantity: 1500,
      unit: '克',
      count: 1,
      location: '厨房',
      petId: 'p1',
      expiryDate: iso(120),
      createdAt: now,
    },
    {
      id: 'item-freeze',
      gtin: '6901234567908',
      quantity: 300,
      unit: '克',
      count: 1,
      location: '柜子',
      petId: 'p1',
      expiryDate: iso(200),
      createdAt: now,
    },
    {
      id: 'item-wet',
      gtin: '6901234567915',
      quantity: 85,
      unit: '克',
      count: 1,
      location: '柜子',
      petId: 'p1',
      expiryDate: iso(180),
      createdAt: now,
    },
  ],
  pets: [
    {
      id: 'p1',
      name: '奶糖',
      species: 'cat',
      breed: '英短',
      weightKg: 5,
      birthDate: iso(-1350),
      gender: 'female',
      neutered: true,
      avatar: '🐱',
      avatarPhotoId: 'avatar_p1',
      weightHistory: [{ date: today, weightKg: 5, createdAt: now }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'p2',
      name: '团子',
      species: 'cat',
      breed: '布偶',
      weightKg: 4,
      birthDate: iso(-240),
      gender: 'male',
      neutered: false,
      avatar: '🐈',
      createdAt: now,
      updatedAt: now,
    },
  ],
  feedings: [
    {
      id: 'feed-today',
      petId: 'p1',
      itemId: 'item-dry',
      gtin: '6901234567892',
      grams: 40,
      date: today,
      createdAt: now,
    },
  ],
  vaccinations: [
    {
      id: 'v1',
      petId: 'p1',
      vaccineName: '妙三多',
      vaccineKind: 'combo',
      doseDate: '2026-04-10',
      source: 'manual',
      confirmed: true,
      photoId: 'vacc_v1',
      createdAt: now,
    },
  ],
  dewormings: [
    {
      id: 'd1',
      petId: 'p1',
      type: 'internal',
      lastDate: '2026-09-15',
      nextDate: '2026-12-14',
      doneLog: ['2026-09-15'],
      missCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ],
  activePetId: 'p1',
  settings: {
    apiKey: '',
    remindEnabled: true,
    remindDays: 7,
    reminders: {
      expiryEnabled: true,
      vaccineEnabled: true,
      dewormEnabled: true,
      enabledAt: { expiry: now, vaccine: now, deworm: now },
    },
  },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

await page.getByRole('button', { name: '宠物', exact: true }).click();
await page.waitForTimeout(500);
check('生命阶段标签显示成年', (await page.locator('.pet-head').innerText()).includes('成年'));
check('自定义头像全页可见', (await page.locator('.pet-head .pet-avatar img').count()) === 1);
const energyCardText = await page.locator('.card', { hasText: 'RER（静息能量需求）' }).innerText();
check('RER 标注静息能量需求', energyCardText.includes('RER（静息能量需求）'));
check('MER 标注每日维持需求', energyCardText.includes('MER（每日维持需求）'));
await page.locator('.app-main').evaluate((element) => element.scrollTo(0, 0));
await page.screenshot({ path: 'shots/stage15-01-pet-top.png', fullPage: false });
const budgetText = (await page.locator('.budget-card').innerText()).replace(/\s+/g, ' ');
check('日预算显示已吃 160kcal', budgetText.includes('已吃 160 kcal'), budgetText.slice(0, 120));
check(
  '日预算列出冻干剩余克数',
  budgetText.includes('测试冻干') && /还能吃约 20(?:\.\d+)?g/.test(budgetText),
  budgetText.slice(0, 220),
);
check('无营养表库存有提示', budgetText.includes('无营养表罐头未填营养成分'), budgetText.slice(-180));
check('最近投喂显示折算热量', (await page.locator('.feed-list').innerText()).includes('40 克 · 160 kcal'));
check('疫苗本默认收起且显示下次加强', (await page.getByRole('button', { name: /疫苗本/ }).innerText()).includes('下次加强'));

await page.getByRole('button', { name: /疫苗本/ }).click();
await page.waitForTimeout(300);
check('展开后出现历史针次', (await page.locator('.timeline').innerText()).includes('妙三多'));
check('首年接种后出现年度加强', (await page.locator('.care-body').innerText()).includes('2027-04-10'));
await page.locator('.vaccine-book, .care-book').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: 'shots/stage15-02-vaccine.png', fullPage: false });
const beforeAdd = await readSeededState(page);
await page.getByRole('button', { name: '手动添加' }).click();
await page.waitForTimeout(250);
const stillBeforeConfirm = await readSeededState(page);
check('疫苗确认页出现前不落库', stillBeforeConfirm.vaccinations.length === beforeAdd.vaccinations.length);
await page.getByRole('button', { name: /确认无误，写入疫苗本/ }).click();
await page.waitForTimeout(600);
const afterVaccine = await readSeededState(page);
check('二次确认后写入疫苗本', afterVaccine.vaccinations.length === beforeAdd.vaccinations.length + 1, afterVaccine.vaccinations.length);
await page.locator('.timeline-row').first().getByRole('button', { name: '修改疫苗记录' }).click();
await page.locator('.sheet label.field', { hasText: '接种日期' }).locator('input').fill('2028-05-10');
await page.getByRole('button', { name: '保存修改' }).click();
await page.waitForTimeout(500);
const afterVaccineEdit = await readSeededState(page);
const editedVaccine = afterVaccineEdit.vaccinations.find((record) => record.doseDate === '2028-05-10');
check('修改末针日期后重新落库', Boolean(editedVaccine), editedVaccine?.doseDate);
check('年度加强随末针日期重算', (await page.locator('.care-body').innerText()).includes('2029-05-10'));

const dewormCard = page.locator('.care-deworm');
check('驱虫卡显示体内与体外', (await dewormCard.innerText()).includes('体内驱虫') && (await dewormCard.innerText()).includes('体外驱虫'));
await dewormCard.getByRole('button', { name: '已完成' }).click();
await page.waitForTimeout(500);
const afterDeworm = await readSeededState(page);
const dewormPlan = afterDeworm.dewormings.find((plan) => plan.id === 'd1');
check('完成后体内驱虫按成年 90 天顺延', dewormPlan?.nextDate === iso(90), dewormPlan?.nextDate);
await dewormCard.getByRole('button', { name: '修改体内驱虫' }).click();
check('点击体内驱虫后类型锁定为体内', (await page.locator('.sheet').innerText()).includes('本次只记录体内驱虫'));
check('体内驱虫页没有类型切换', (await page.locator('.sheet').getByRole('tab').count()) === 0);
await page.getByRole('button', { name: '关闭' }).click();
await dewormCard.getByRole('button', { name: '记录上次日期' }).click();
check('点击体外驱虫后类型锁定为体外', (await page.locator('.sheet').innerText()).includes('本次只记录体外驱虫'));
check('体外驱虫页没有类型切换', (await page.locator('.sheet').getByRole('tab').count()) === 0);
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('button', { name: '编辑宠物档案' }).click();
await page.waitForTimeout(250);
await page.getByPlaceholder('例如 金渐层').fill('蓝猫');
await page.waitForTimeout(250);
check('蓝猫按别名联想英短', (await page.locator('.breed-menu').innerText()).includes('英国短毛猫'));
await page.locator('.breed-menu').getByRole('button', { name: /英国短毛猫/ }).click();
await page.locator('.sheet .field', { hasText: '出生日期' }).locator('input').first().fill(iso(1));
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(200);
check('未来出生日期被拦住', (await page.locator('.sheet').innerText()).includes('出生日期不能晚于今天'));
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(350);
await page.locator('.list-item', { hasText: '测试主粮' }).click();
await page.waitForTimeout(350);
check('商品详情显示整包约 25 天', (await page.locator('.sheet').innerText()).includes('这一包约能吃 25 天'));
await page.getByRole('button', { name: '关闭' }).click();

await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(350);
check('提醒中心包含三个开关', (await page.locator('.screen').innerText()).includes('过期与临期') && (await page.locator('.screen').innerText()).includes('疫苗提醒') && (await page.locator('.screen').innerText()).includes('驱虫提醒'));
await page.getByRole('switch', { name: '疫苗提醒' }).click();
await page.waitForTimeout(450);
const afterToggle = await readSeededState(page);
check('关闭疫苗提醒写入快照', afterToggle.settings.reminders?.vaccineEnabled === false, JSON.stringify(afterToggle.settings.reminders));
check('关闭后记录 enabledAt 被撤销', afterToggle.settings.reminders?.enabledAt?.vaccine === undefined);
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '导出备份' }).click(),
]);
const backupPath = await download.path();
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
check('导出备份保留宠物档案', Array.isArray(backup.pets) && backup.pets.length === 2);
check('导出备份剥离头像引用', backup.pets[0]?.avatarPhotoId === undefined);
check('导出备份剥离疫苗照片引用', backup.vaccinations[0]?.photoId === undefined);
check('导出备份仍不带 API Key', backup.settings?.apiKey === '');
check('页面无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await page.screenshot({ path: 'shots/stage15-03-settings.png', fullPage: false });

await browser.close();
if (failed) {
  console.error(`失败 ${failed} 项`);
  process.exit(1);
}
console.log('全部通过');

