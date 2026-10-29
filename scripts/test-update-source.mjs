/**
 * 更新源不再写死局域网 IP：
 *  1 默认留空（自动发现）
 *  2 手动填地址后点「自动发现」会清空，交给局域网扫描
 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

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
  schema: 3,
  skus: [],
  items: [],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(500);

const sourceInput = page.locator('label.field', { hasText: '更新源' }).locator('input').first();
const initial = await sourceInput.inputValue();
check('1 默认不写死 IP', initial === '', initial || '(空)');
const hint = (await page.locator('label.field', { hasText: '更新源' }).innerText()).replace(/\s+/g, ' ');
check('1 界面说明自动发现', hint.includes('自动扫描'), hint.slice(0, 80));

await sourceInput.fill('http://127.0.0.1:5276');
await page.waitForTimeout(250);
check('2 可以手填地址', (await sourceInput.inputValue()) === 'http://127.0.0.1:5276');
await page.getByRole('button', { name: '自动发现' }).click();
await page.waitForTimeout(400);
check('2 点自动发现会清空手填地址', (await sourceInput.inputValue()) === '', await sourceInput.inputValue());
await page.screenshot({ path: 'shots/update-source-01.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
