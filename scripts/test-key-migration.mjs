/**
 * 0.3 旧明文 Key 迁移：
 *  1 老版本 settings.apiKey 明文 → 启动后搬进安全存储（浏览器用 sessionStorage 模拟）
 *  2 IndexedDB / localStorage 镜像里的 apiKey 必须被清空
 *  3 界面上仍然能读回 Key，用户不用重输
 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
const LEGACY_KEY = ['s', 'k', '-', 'legacy', '-', 'migration', '-', 'test'].join('');
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 3,
  skus: [],
  items: [],
  settings: { apiKey: LEGACY_KEY, remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const persisted = await readSeededState(page);
const mirror = await page.evaluate(() => JSON.parse(localStorage.getItem('expiry-keeper:v1') ?? '{}'));
const secure = await page.evaluate(() => sessionStorage.getItem('expiry-keeper:session-api-key'));
check('1 Key 搬进安全存储', secure === LEGACY_KEY, secure ?? '(空)');
check('2 IndexedDB 里没有明文 Key', persisted.settings.apiKey === '', persisted.settings.apiKey || '(空)');
check('2 镜像里没有明文 Key', mirror.settings?.apiKey === '', mirror.settings?.apiKey || '(空)');

await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(500);
const input = await page.locator('input[type=password]').inputValue();
check('3 升级后界面仍能读回 Key', input === LEGACY_KEY, input === LEGACY_KEY ? '已回填' : input);

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
