/** 验证常用厂家的增删与恢复，以及识别页名单是否跟着变。 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(400);
const countText = await page.locator('.card', { hasText: '名单里的厂家' }).innerText();
console.log('设置页显示：', countText.replace(/\s+/g, ' ').slice(0, 40));

await page.getByRole('button', { name: '管理常用厂家' }).click();
await page.waitForTimeout(500);
console.log('初始名单条数：', await page.locator('.maker-manage li').count());

// 新增
await page.locator('label.field', { hasText: /^厂家名称/ }).locator('input').fill('测试宠物食品有限公司');
await page.locator('label.field', { hasText: /^所在地/ }).locator('input').fill('江苏南京');
await page.getByRole('button', { name: '添加到名单' }).click();
await page.waitForTimeout(500);
console.log('新增后条数：', await page.locator('.maker-manage li').count());
console.log('第一条：', (await page.locator('.maker-manage li').first().innerText()).replace(/\s+/g, ' '));

// 重复添加应被忽略
await page.locator('label.field', { hasText: /^厂家名称/ }).locator('input').fill('测试宠物食品有限公司');
await page.getByRole('button', { name: '添加到名单' }).click();
await page.waitForTimeout(400);
console.log('重复添加后条数：', await page.locator('.maker-manage li').count());

// 删除默认名单里的一条
await page.getByRole('button', { name: '删除 烟台中宠食品股份有限公司' }).click();
await page.waitForTimeout(400);
console.log('删掉一条后条数：', await page.locator('.maker-manage li').count());
await page.screenshot({ path: 'shots/makers-01-manage.png', fullPage: false });

// 刷新后应保持
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '管理常用厂家' }).click();
await page.waitForTimeout(500);
console.log('刷新后条数：', await page.locator('.maker-manage li').count());
console.log(
  '是否还有中宠：',
  (await page.locator('.maker-manage').innerText()).includes('烟台中宠') ? '还在（不对）' : '已删除 ✓',
);

// 恢复默认
await page.getByRole('button', { name: '恢复默认名单' }).click();
await page.waitForTimeout(500);
console.log('恢复默认后条数：', await page.locator('.maker-manage li').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 识别页的名单应跟着变（这里含刚才新增的测试厂家）
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /从常见厂家里选/ }).click();
await page.waitForTimeout(400);
console.log('确认页名单条数：', await page.locator('.maker-list li').count());
await page.screenshot({ path: 'shots/makers-02-picker.png', fullPage: false });

await browser.close();
