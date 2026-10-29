import { sanitizeCleanedProduct } from './validation.mjs';

const CLEAN_PROMPT = `你是宠物商品资料清洗器。输入是一条用户确认入库后提交的纯文本商品记录，可能有错字、空白、营销词、字段缺失或格式混乱。
请只输出一个 JSON 对象，不要解释，不要 Markdown。
严格要求：
- 不猜测、不补全包装上没有提供的信息。
- 无法确认的字符串写空字符串，无法确认的数字、分类、用途写 null。
- category 只能是 dry、wet、freeze_dried、fresh_raw、medicine、supplies 之一，否则 null。
- kind 只能是 staple 或 snack，否则 null。
- shelfLifeMonths 只在包装明确写“12个月/1年”这类信息时填写整数。
- packageGrams 只填写单包净含量，乘法规格只取单包克重。
- ingredientsRaw 保留原文，不自行增加配料。
- nutrition 只保留原记录中明确出现的营养分析保证值。
输出字段：
{
  "barcode": "8-14 位条码",
  "name": "商品名",
  "brand": "品牌",
  "manufacturer": "真实生产厂家",
  "category": "dry|wet|freeze_dried|fresh_raw|medicine|supplies|null",
  "kind": "staple|snack|null",
  "ingredientsRaw": "配料原文",
  "storage": "贮存条件",
  "shelfLifeText": "保质期原文",
  "shelfLifeMonths": 12,
  "packageGrams": 1500,
  "nutrition": {
    "metabolizableEnergy": "",
    "crudeProtein": "",
    "crudeFat": "",
    "crudeFiber": "",
    "crudeAsh": "",
    "moisture": "",
    "taurine": "",
    "calciumPhosphorus": ""
  }
}`;

function extractJson(textValue) {
  const cleaned = String(textValue ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('清洗模型没有返回 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function createDeepSeekCleaner({
  apiKey,
  baseUrl = 'https://api.deepseek.com',
  model = 'deepseek-flash',
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) {
    return async () => {
      throw new Error('服务端未配置 DEEPSEEK_API_KEY，贡献记录保持待处理');
    };
  }
  return async ({ barcode, raw }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CLEAN_PROMPT },
            { role: 'user', content: JSON.stringify({ barcode, raw }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`清洗接口返回 ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      return sanitizeCleanedProduct(extractJson(content), barcode);
    } finally {
      clearTimeout(timer);
    }
  };
}

export { CLEAN_PROMPT };
