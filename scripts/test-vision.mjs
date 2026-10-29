/**
 * 用真机同样的请求打一次 DeepSeek 视觉接口，用来单独验证接口侧问题。
 * 提示词与 src/lib/engine.ts 里的 EXTRACTION_PROMPT 保持一致。
 *
 * 用法：
 *   $env:DEEPSEEK_API_KEY='sk-...'
 *   node scripts/test-vision.mjs shots/label-960.jpg
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const key = (process.env.DEEPSEEK_API_KEY ?? '').trim();
const args = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const mode = process.argv.includes('--date') ? 'date' : 'label';
const file = args[0];

if (!key || !file) {
  console.error('用法：设置 DEEPSEEK_API_KEY 后执行 node scripts/test-vision.mjs <图片路径>');
  process.exit(1);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const mime = MIME[extname(file).toLowerCase()] ?? 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const DATE_PROMPT = `这是一张商品包装上喷码/打印日期的特写照片。只输出一个 JSON 对象，不要解释。
字段：
{
  "productionDate": "生产日期 YYYY-MM-DD，读不到留空",
  "expiryDate": "到期日 YYYY-MM-DD，没有留空",
  "raw": "你看到的原始字符，原样抄写",
  "confidence": 0.0
}
注意：喷码常是点阵字、可能竖排（需要在脑中把图旋转 90 度再读）、可能分行。逐位核对，看不清就把 productionDate 留空，不要猜。`;

const LABEL_PROMPT = `你是包装标签信息抽取器。标签可能来自预包装食品、宠物食品或日化用品，请阅读图片上的文字，只输出一个 JSON 对象，不要输出解释。
读取要求：
- 只写印在包装上的内容，不要推断、不要补全没印出来的信息。
- 生产日期以包装上的喷码/压印数字为准，逐位核对；看不清就留空，宁可留空也不要猜。
- 配料原文照抄。宠物食品把「原料组成」和「添加剂组成」两段都写进 ingredientsRaw。
- scCode 放生产许可证编号：食品是 SC 加 14 位数字，宠物食品是「鲁饲证(2023)02713」这类饲料生产许可证编号，原样写。
- 营养成分表/营养成分分析保证值都写进 nutrition，单位照抄（例如 ≥65%）。
字段：
{
  "gtin": "条码数字，没有就留空",
  "name": "产品名称（含系列与口味）",
  "brand": "品牌",
  "category": "宠物食品填 干粮 或 湿粮；其他商品留空",
  "kind": "宠物食品填 主食 或 零食；其他商品留空",
  "manufacturer": "生产者名称（有地址不要写地址）",
  "scCode": "生产许可证编号",
  "standardCode": "产品标准代号",
  "netContent": "净含量",
  "ingredientsRaw": "配料/原料原文",
  "storage": "贮存条件原文",
  "shelfLifeText": "保质期原文，例如 18个月",
  "productionDate": "生产日期 YYYY-MM-DD，没有就留空",
  "expiryDate": "保质期至/到期日 YYYY-MM-DD，没有就留空",
  "nutrition": { "energy": "", "protein": "", "fat": "", "carbohydrate": "", "sodium": "" },
  "confidence": { "ingredients": 0.9, "shelfLife": 0.9, "manufacturer": 0.9 }
}
识别不到的内容用空字符串。confidence 用 0 到 1 表示每个字段的把握。`;

const PROMPT = mode === 'date' ? DATE_PROMPT : LABEL_PROMPT;

const started = Date.now();
try {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-flash',
      // 结构化抽取不需要思考链：思考模式默认开启会吃掉 token 并拖慢返回
      thinking: { type: 'disabled' },
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你只输出 JSON，不输出任何解释文字。' },
        { role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
    }),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const text = await response.text();
  console.log(`HTTP ${response.status} · ${seconds}s · 请求体 ${Math.round(dataUrl.length / 1024)} KB`);
  try {
    const payload = JSON.parse(text);
    const content = payload.choices?.[0]?.message?.content ?? '';
    const json = JSON.parse(content);
    console.log(mode === 'date'
      ? [
          `productionDate=${json.productionDate}`,
          `expiryDate=${json.expiryDate}`,
          `raw=${json.raw}`,
          `confidence=${json.confidence}`,
        ].join('\n')
      : [
        `gtin=${json.gtin}`,
        `name=${json.name}`,
        `brand=${json.brand}`,
        `manufacturer=${json.manufacturer}`,
        `scCode=${json.scCode}`,
        `standardCode=${json.standardCode}`,
        `shelfLife=${json.shelfLifeText}`,
        `productionDate=${json.productionDate}`,
        `expiryDate=${json.expiryDate}`,
        `ingredients=${String(json.ingredientsRaw ?? '').slice(0, 60)}…`,
      ].join('\n'));
  } catch (error) {
    console.log(`解析回包失败：${error.message}`);
    console.log(text.slice(0, 1200));
  }
} catch (error) {
  console.log(`请求异常（${((Date.now() - started) / 1000).toFixed(1)}s）：${error?.message ?? error}`);
}
