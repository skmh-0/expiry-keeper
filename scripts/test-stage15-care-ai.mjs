/** 疫苗本识图 API 契约：只产出草稿，过滤坏日期，不直接落库。 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const key = ['s', 'k', '-', 'stage15'].join('');
let requestBody;
await page.route('https://api.deepseek.com/chat/completions', async (route) => {
  requestBody = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              records: [
                {
                  vaccineName: '妙三多',
                  doseDate: '2026-04-10',
                  nextDate: '2027-04-10',
                  clinic: '测试动物医院',
                },
                { vaccineName: '狂犬疫苗', doseDate: '看不清', nextDate: null, clinic: null },
              ],
            }),
          },
        },
      ],
    }),
  });
});
await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 5,
  skus: [],
  items: [],
  pets: [],
  feedings: [],
  vaccinations: [],
  dewormings: [],
  activePetId: '',
  settings: {
    apiKey: key,
    remindEnabled: false,
    remindDays: 7,
    reminders: {
      expiryEnabled: false,
      vaccineEnabled: true,
      dewormEnabled: true,
      enabledAt: { vaccine: Date.now(), deworm: Date.now() },
    },
  },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const result = await page.evaluate(async ({ apiKey }) => {
  const engine = await import('/src/lib/engine.ts');
  return engine.extractVaccinationsFromPhoto(
    {
      apiKey,
      remindEnabled: false,
      remindDays: 7,
      reminders: {
        expiryEnabled: false,
        vaccineEnabled: true,
        dewormEnabled: true,
        enabledAt: {},
      },
    },
    'data:image/jpeg;base64,ZmFrZQ==',
  );
}, { apiKey: key });
const serialized = JSON.stringify(requestBody ?? {});
check('请求包含疫苗本提示词', serialized.includes('宠物疫苗本照片'));
check('请求发送了图片', serialized.includes('image_url'));
check('只保留有效接种记录', result.records.length === 1, result.records.length);
check('保留疫苗名与医院', result.records[0]?.vaccineName === '妙三多' && result.records[0]?.clinic === '测试动物医院');
check('清空日期不会被猜成别的日期', result.records[0]?.doseDate === '2026-04-10');
check('下一针日期独立保留', result.records[0]?.nextDate === '2027-04-10');

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

