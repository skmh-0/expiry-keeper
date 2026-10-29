import type {
  CheckResult,
  Maker,
  PhotoRole,
  PhotoShot,
  RecognizeOutcome,
  Region,
  Regions,
  Settings,
  Sku,
  VerifyMode,
} from '../types';
import {
  describeScCode,
  gtinKind,
  isInternalGtin,
  licenseKind,
  isValidGtin,
  isValidScCode,
  normalizeGtin,
  normalizeScCode,
} from './gtin';
import { splitTopLevel } from './parse';
import { daysUntil, expiryFrom, isValidIso, parseShelfLife } from './shelfLife';
import { createEmptySku, refreshSku } from './sku';
import { DEEPSEEK_BASE_URL, DEEPSEEK_VISION_MODEL } from './config';
import { cropRegion } from './image';
import { parsePackageGrams } from './pets';

export function buildChecks(
  sku: Sku,
  context: { gtin?: string; productionDate?: string; expiryDate?: string } = {},
): CheckResult[] {
  const checks: CheckResult[] = [];
  const gtin = normalizeGtin(context.gtin || sku.gtin);

  if (gtin) {
    if (!isValidGtin(gtin)) {
      checks.push({ level: 'error', text: `条码校验位不通过（${gtin}），建议重新扫描或核对` });
    } else if (isInternalGtin(gtin)) {
      checks.push({ level: 'ok', text: `店内码（EAN-13 前缀 2）：${gtin}，仅本地使用` });
    } else {
      checks.push({ level: 'ok', text: `${gtinKind(gtin)} 校验位通过：${gtin}` });
    }
  } else {
    checks.push({ level: 'warn', text: '未取到条码，该记录不会进入共享商品库' });
  }

  const license = licenseKind(sku.scCode);
  if (license === 'unknown') {
    checks.push({ level: sku.scCode ? 'warn' : 'warn', text: sku.scCode ? `生产许可证编号格式未识别：${sku.scCode}` : '缺少生产许可证编号（食品为 SC，宠物食品为饲证）' });
  } else if (license === 'feed') {
    checks.push({ level: 'ok', text: `饲料生产许可证编号：${(sku.scCode ?? '').trim()}` });
  } else {
    const sc = normalizeScCode(sku.scCode);
    checks.push({ level: 'ok', text: `SC 编号格式有效：${describeScCode(sc)}` });
  }

  if (!sku.ingredientsRaw.trim()) {
    checks.push({ level: 'warn', text: '配料表为空，建议补拍包装背标' });
  } else {
    const items = splitTopLevel(sku.ingredientsRaw);
    checks.push({ level: 'ok', text: `配料表已切分为 ${items.length} 项` });
    if (sku.ingredientsRaw.includes('食品添加剂') && sku.additives.length === 0) {
      checks.push({ level: 'warn', text: '标签含「食品添加剂」字样，但未匹配到具体添加剂名称' });
    } else if (sku.additives.length > 0) {
      checks.push({ level: 'ok', text: `匹配到 ${sku.additives.length} 项食品添加剂：${sku.additives.slice(0, 4).join('、')}${sku.additives.length > 4 ? ' 等' : ''}` });
    }
  }

  if (sku.allergens.length > 0) {
    checks.push({ level: 'warn', text: `致敏物质为规则推测：${sku.allergens.join('、')}，请按包装原文核对` });
  }

  const life = parseShelfLife(sku.shelfLifeText);
  if (!life) {
    checks.push({ level: 'warn', text: '未能从标签文本解析出保质期天数' });
  } else {
    checks.push({ level: 'ok', text: `保质期解析：${life.text}（约 ${life.days} 天）` });
  }

  const production = context.productionDate;
  const expiry = context.expiryDate;

  // 到期日早于生产日期：一定是读错或填错了，直接标红
  if (isValidIso(production) && isValidIso(expiry) && expiry < production) {
    checks.push({
      level: 'error',
      text: `到期日 ${expiry} 早于生产日期 ${production}，这两项至少有一个不对，请按包装核对`,
    });
  }

  if (!isValidIso(production)) {
    checks.push(
      isValidIso(expiry)
        ? { level: 'ok', text: `以包装标注的到期日为准：${expiry}（无生产日期，不做推算）` }
        : { level: 'warn', text: '未填写生产日期，无法推算到期日' },
    );
  } else {
    const left = daysUntil(production);
    if (left !== undefined && left > 1) {
      checks.push({ level: 'error', text: `生产日期 ${production} 晚于今天，请核对` });
    } else {
      checks.push({ level: 'ok', text: `生产日期有效：${production}` });
    }
    const expected = expiryFrom(production, life);
    if (expected && isValidIso(expiry)) {
      const diff = Math.round(
        (new Date(`${expiry as string}T00:00:00Z`).getTime() - new Date(`${expected}T00:00:00Z`).getTime()) / 86_400_000,
      );
      checks.push(
        Math.abs(diff) <= 2
          ? { level: 'ok', text: `到期日与「生产日期 + 保质期 − 1 天」推算一致（推算 ${expected}）` }
          : { level: 'warn', text: `到期日 ${expiry} 与推算 ${expected} 相差 ${Math.abs(diff)} 天，请核对包装` },
      );
    } else if (expected) {
      checks.push({ level: 'ok', text: `按标签保质期推算到期日：${expected}` });
    }
  }

  return checks;
}

const EXTRACTION_PROMPT = `你是包装标签信息抽取器。标签可能来自预包装食品、宠物食品或日化用品，请阅读图片上的文字，只输出一个 JSON 对象，不要输出解释。
读取要求：
- 只写印在包装上的内容，不要推断、不要补全没印出来的信息。
- 每张照片前面标了类型（整张背标 / 配料表特写 / 喷码日期特写 / 包装正面）。喷码日期只认「喷码日期特写」或背标上的喷码，不要拿保质期时长当日期。
- 多张照片请合并信息，冲突时以更清楚的那张为准。
- 生产日期以包装上的喷码/压印数字为准，可能单独拍在特写里，逐位核对；看不清就留空，宁可留空也不要猜。
- brand 只写品牌名（例如「麦富迪」），不要把公司全称当作品牌。
- manufacturer 只写真正生产的那家工厂：取包装上「生产商 / 生产企业 / 制造商 / 受托方 / 受委托方 / 代工方 / 加工厂」后面的公司名称。品牌方、委托方、出品方、经销商、商标持有人都不是生产商，不要填进 manufacturer；同一处既有委托方又有受托方时填受托方。带地址时只写公司名，不要写地址。
- 配料原文照抄。宠物食品把「原料组成」和「添加剂组成」两段都写进 ingredientsRaw。
- scCode 放生产许可证编号：食品是 SC 加 14 位数字，宠物食品是「鲁饲证(2023)02713」这类饲料生产许可证编号，原样写。
- 宠物食品必须读取「营养成分分析保证值 / 保证分析值」，按粗蛋白、粗脂肪、粗纤维、粗灰分、水分、牛磺酸、钙磷比、代谢能分别抄写；代谢能单位原样保留（kcal/kg 或 kcal/g）。
- 读取包装净含量/规格字段（如「净含量:1.5kg」「规格:500g×6包」），换算成单包克数。乘法规格只取单包克重，例如 500g×6包 输出 500，不输出 3000。
- confidence 里每个字段都要给 0 到 1 的把握：字清楚就是 0.9 以上，有点模糊给 0.6 左右，靠猜给的字段一律低于 0.4。
- regions 用来告诉程序小字在哪块，方便放大重读：x/y/w/h 都是 0 到 1 的比例，左上角是原点，w/h 是宽高比例；photoIndex 是照片序号（第一张是 1）。看不清位置就留空对象。
字段：
{
  "gtin": "条码数字，没有就留空",
  "name": "产品名称（含系列与口味）",
  "brand": "品牌",
  "category": "宠物食品填 干粮 或 湿粮；其他商品留空",
  "kind": "宠物食品填 主食 或 零食（全价/主粮/主食罐算主食，奖励/训练用算零食）；其他商品留空",
  "manufacturer": "实际生产工厂全称（不是品牌方 / 委托方 / 经销商；不带地址）",
  "scCode": "生产许可证编号",
  "standardCode": "产品标准代号",
  "ingredientsRaw": "配料/原料原文",
  "storage": "贮存条件原文",
  "shelfLifeText": "保质期原文，例如 18个月",
  "packageGrams": 1500,
  "productionDate": "生产日期 YYYY-MM-DD，没有就留空",
  "expiryDate": "保质期至/到期日 YYYY-MM-DD，没有就留空",
  "nutrition": {
    "metabolizableEnergy": "代谢能，例如 4000 kcal/kg",
    "crudeProtein": "粗蛋白质，例如 ≥38%",
    "crudeFat": "粗脂肪，例如 ≥16%",
    "crudeFiber": "粗纤维，例如 ≤5%",
    "crudeAsh": "粗灰分，例如 ≤9%",
    "moisture": "水分，例如 ≤10%",
    "taurine": "牛磺酸，例如 ≥0.2%",
    "calciumPhosphorus": "钙磷比，例如 1.2:1"
  },
  "evidence": { "productionDate": "喷码上抄下来的原始字符", "expiryDate": "到期日原始字符", "shelfLifeText": "保质期原始字符" },
  "regions": {
    "photoIndex": 1,
    "ingredients": { "x": 0, "y": 0, "w": 0, "h": 0 },
    "date": { "x": 0, "y": 0, "w": 0, "h": 0 }
  },
  "confidence": {
    "name": 0.9, "brand": 0.9, "manufacturer": 0.9, "scCode": 0.9, "standardCode": 0.9,
    "ingredientsRaw": 0.9, "storage": 0.9, "shelfLifeText": 0.9, "packageGrams": 0.9, "productionDate": 0.9, "expiryDate": 0.9
  }
}
识别不到的内容用空字符串。confidence 用 0 到 1 表示每个字段的把握。`;

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

/** 单次识别的等待上限：超过就报超时，避免界面一直停在「正在解析」。 */
const VISION_TIMEOUT_MS = 120_000;

async function requestJson(apiKey: string, parts: unknown[], maxTokens = 4000): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error('未填写 API Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  let response: Response;
  try {
    const sentAt = Date.now();
    if (import.meta.env.DEV) console.info(`[vision] 上传 ${Math.round(JSON.stringify(parts).length / 1024)}KB`);
    response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_VISION_MODEL,
        // 结构化抽取不需要思考链，关掉省 token 也更快
        thinking: { type: 'disabled' },
        // 抽取要可复现：同样的图不该两次给出不同的字段
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你只输出 JSON，不输出任何解释文字。' },
          { role: 'user', content: parts },
        ],
      }),
    });
    if (import.meta.env.DEV) console.info(`[vision] ${response.status} · ${Date.now() - sentAt}ms`);
  } catch (error) {
    if (import.meta.env.DEV) console.info(`[vision] 请求异常 ${error instanceof Error ? error.name : ''}`);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`等待模型超时（${VISION_TIMEOUT_MS / 1000} 秒），可以换张更小的照片重试`);
    }
    throw new Error(`网络请求失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(await describeHttpError(response));
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容（可能被 max_tokens 截断），请重试或换张更清晰的照片');
  return extractJson(content);
}

const ROLE_LABEL: Record<PhotoRole, string> = {
  back: '整张背标',
  ingredients: '配料表特写',
  date: '喷码日期特写',
  front: '包装正面',
};

function imageParts(shots: PhotoShot[], intro?: string): unknown[] {
  return [
    ...(intro ? [{ type: 'text', text: intro }] : []),
    ...shots.flatMap((shot, index) => [
      { type: 'text', text: `照片 ${index + 1}（${ROLE_LABEL[shot.role]}）：` },
      { type: 'image_url', image_url: { url: shot.dataUrl } },
    ]),
  ];
}

async function callVisionApi(settings: Settings, shots: PhotoShot[]): Promise<Record<string, unknown>> {
  return requestJson(settings.apiKey.trim(), imageParts(shots, EXTRACTION_PROMPT));
}

const DATE_PROMPT = `这是一张商品包装上喷码/打印日期的特写照片。只输出一个 JSON 对象，不要解释。
{
  "productionDate": "生产日期 YYYY-MM-DD，读不到留空",
  "expiryDate": "到期日 YYYY-MM-DD，没有留空",
  "raw": "你看到的原始字符，原样抄写",
  "confidence": 0.0
}
注意：喷码常是点阵字、可能竖排（需要在脑中把图旋转 90 度再读）、可能分行。逐位核对，看不清就把 productionDate 留空，不要猜。`;

export type DateReading = {
  productionDate?: string;
  expiryDate?: string;
  raw?: string;
  confidence?: number;
};

export type VaccinationDraft = {
  vaccineName: string;
  doseDate: string;
  nextDate?: string;
  clinic?: string;
};

const VACCINE_PROMPT = `这是宠物疫苗本照片。只输出一个 JSON 对象，不要解释。
请提取所有接种记录：
{
  "records": [
    { "vaccineName": "疫苗原名", "doseDate": "YYYY-MM-DD", "nextDate": "YYYY-MM-DD 或 null", "clinic": "医院/诊所或 null" }
  ]
}
注意：
- vaccineName 保留原名，如 妙三多、卫佳伍、猫三联、狂犬疫苗。
- 日期统一 YYYY-MM-DD；手写字迹不清的字段填 null，不要猜。
- 没有下一针日期就填 null。
- 一张图里有几针就输出几条，不完整记录也保留能读清的字段。`;

/** 疫苗本识图只返回草稿；必须经过确认页才能写入正式记录。 */
export async function extractVaccinationsFromPhoto(
  settings: Settings,
  photo: string,
): Promise<{ records: VaccinationDraft[]; notice?: string }> {
  if (!settings.apiKey.trim()) throw new Error('先在设置里填写 API Key，或直接手动添加');
  const json = await requestJson(
    settings.apiKey.trim(),
    [
      { type: 'text', text: VACCINE_PROMPT },
      { type: 'image_url', image_url: { url: photo } },
    ],
    2400,
  );
  const raw = Array.isArray(json.records) ? json.records : [];
  const records = raw
    .map((value) => {
      const row = (value ?? {}) as Record<string, unknown>;
      const text = (key: string) => (typeof row[key] === 'string' ? String(row[key]).trim() : '');
      return {
        vaccineName: text('vaccineName'),
        doseDate: text('doseDate'),
        nextDate: isValidIso(text('nextDate')) ? text('nextDate') : undefined,
        clinic: text('clinic') || undefined,
      };
    })
    .filter((record) => record.vaccineName && isValidIso(record.doseDate));
  return {
    records,
    notice: records.length ? undefined : '没认出接种记录，试试手动添加',
  };
}

/** 单独拍一张喷码特写时走这里：像素足够，日期比整张背标可靠得多。 */
export async function extractDateFromPhoto(settings: Settings, photo: string): Promise<DateReading> {
  const json = await requestJson(
    settings.apiKey.trim(),
    [
      { type: 'text', text: DATE_PROMPT },
      { type: 'image_url', image_url: { url: photo } },
    ],
    1200,
  );
  const text = (key: string) => (typeof json[key] === 'string' ? (json[key] as string).trim() : '');
  return {
    productionDate: text('productionDate') || undefined,
    expiryDate: text('expiryDate') || undefined,
    raw: text('raw') || undefined,
    confidence: typeof json.confidence === 'number' ? json.confidence : undefined,
  };
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // 响应不是 JSON 时只报状态码
  }
  if (response.status === 401) {
    return `API Key 无效或已过期（401），请到「设置 → 识别引擎」更新 Key${detail ? `：${detail}` : ''}`;
  }
  if (response.status === 402) return '账户余额不足（402）';
  if (response.status === 429) return '请求过于频繁（429），稍后再试';
  return detail ? `${response.status} ${detail}` : `接口返回 ${response.status}`;
}

/** 设置页用来验证 Key 是否可用：发一个最小请求，成功即返回模型回包。 */
export async function verifyApiKey(apiKey: string): Promise<string> {
  const key = apiKey.trim();
  if (!key) throw new Error('请先填写 API Key');
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_VISION_MODEL,
      temperature: 0,
      max_tokens: 32,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: '只回复 JSON：{"ok":true}' }],
    }),
  });
  if (!response.ok) throw new Error(await describeHttpError(response));
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() || '已连通';
}

/** 包装上同时印委托方和受托方时取受托方；带标注的原始文本先剥掉标签和括号说明。 */
function normalizeManufacturer(raw: string): string {
  const labeled = raw.match(
    /(?:生产企业|生产商|制造商|生产者|生产厂家|受托方|受委托方|代工方|加工厂)\s*[:：]\s*([^；;，,\n]{2,60})/,
  )?.[1];
  return (labeled ?? raw)
    // 结尾括号里是地址的（省 / 市 / 路 / 号…）整段去掉，只留公司名
    .replace(/[（(][^)）]{0,40}(?:省|市|区|县|镇|乡|村|路|街|号|幢|栋|室|工业园|开发区)[^)）]{0,40}[)）]\s*$/, '')
    .replace(/[（(][^)）]*(?:委托方|受托方|品牌方|出品|经销|商标|代工)[^)）]*[)）]/g, '')
    .replace(
      /^(?:生产企业|生产商|制造商|生产者|生产厂家|厂家|受托方|受委托方|代工方|加工厂|品牌方|委托方|出品方|经销商|商标持有人)\s*[:：]?\s*/,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 模型给的 confidence 键名不固定（name / shelfLife / ingredients 都见过），
 * 统一成字段名，否则界面上的「待核对」标记会失效。
 */
const CONFIDENCE_ALIAS: Record<string, string> = {
  name: 'name',
  brand: 'brand',
  manufacturer: 'manufacturer',
  maker: 'manufacturer',
  factory: 'manufacturer',
  sccode: 'scCode',
  sc: 'scCode',
  license: 'scCode',
  standardcode: 'standardCode',
  standard: 'standardCode',
  ingredients: 'ingredientsRaw',
  ingredient: 'ingredientsRaw',
  ingredientsraw: 'ingredientsRaw',
  storage: 'storage',
  shelflife: 'shelfLifeText',
  shelflifetext: 'shelfLifeText',
  packagegrams: 'packageGrams',
  netcontent: 'packageGrams',
  productiondate: 'productionDate',
  production: 'productionDate',
  producedate: 'productionDate',
  expirydate: 'expiryDate',
  expire: 'expiryDate',
  expiry: 'expiryDate',
};

function normalizeConfidence(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const score = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(score)) continue;
    const lookup = key.trim().toLowerCase().replace(/[\s_-]/g, '');
    const field = CONFIDENCE_ALIAS[lookup] ?? key;
    // 同一字段给了多个分数时取最低的，宁可多提醒一次
    out[field] = out[field] === undefined ? score : Math.min(out[field], score);
  }
  return out;
}

function skuFromModel(json: Record<string, unknown>, fallbackGtin: string): Sku {
  const text = (key: string) => (typeof json[key] === 'string' ? (json[key] as string).trim() : '');
  const packageValue =
    typeof json.packageGrams === 'number' || typeof json.packageGrams === 'string'
      ? json.packageGrams
      : undefined;
  const nutrition = (json.nutrition ?? {}) as Record<string, string>;
  const confidence = normalizeConfidence(json.confidence);
  // 扫码结果比读图可靠，但扫到的码校验位不通过时改用图片上读到的码
  const scannedGtin = normalizeGtin(fallbackGtin);
  const imageGtin = normalizeGtin(text('gtin'));
  const base = createEmptySku(isValidGtin(scannedGtin) ? scannedGtin : imageGtin || scannedGtin);
  const categoryText = text('category');
  const category: Sku['category'] = /冻干/.test(categoryText)
    ? 'freeze_dried'
    : /鲜粮|生骨肉|生食|主食包/.test(categoryText)
      ? 'fresh_raw'
      : /湿粮|罐头|湿性|主食罐/.test(categoryText)
        ? 'wet'
        : /干粮|烘焙粮|膨化/.test(categoryText)
          ? 'dry'
          : /药品|保健品|营养膏|驱虫/.test(categoryText)
            ? 'medicine'
            : /用品|耗材|猫砂|玩具/.test(categoryText)
              ? 'supplies'
              : categoryText
                ? 'supplies'
                : undefined;
  const kindText = text('kind');
  const kind: Sku['kind'] = /零食|奖励|训练/.test(kindText)
    ? 'snack'
    : /主食|全价|主粮|主餐/.test(kindText)
      ? 'staple'
      : undefined;
  return refreshSku({
    ...base,
    source: 'api',
    category,
    kind,
    name: text('name'),
    brand: text('brand'),
    manufacturer: normalizeManufacturer(text('manufacturer')),
    scCode: normalizeScCode(text('scCode')),
    standardCode: text('standardCode'),
    ingredientsRaw: text('ingredientsRaw'),
    storage: text('storage'),
    shelfLifeText: text('shelfLifeText'),
    packageGrams: parsePackageGrams(packageValue),
    nutrition: {
      metabolizableEnergy: nutrition.metabolizableEnergy ?? nutrition.energy ?? '',
      crudeProtein: nutrition.crudeProtein ?? nutrition.protein ?? '',
      crudeFat: nutrition.crudeFat ?? nutrition.fat ?? '',
      crudeFiber: nutrition.crudeFiber ?? '',
      crudeAsh: nutrition.crudeAsh ?? '',
      moisture: nutrition.moisture ?? '',
      taurine: nutrition.taurine ?? '',
      calciumPhosphorus: nutrition.calciumPhosphorus ?? '',
      energy: nutrition.energy ?? '',
      protein: nutrition.protein ?? '',
      fat: nutrition.fat ?? '',
      carbohydrate: nutrition.carbohydrate ?? '',
      sodium: nutrition.sodium ?? '',
    },
    confidence,
  });
}

export type RecognizeInput = {
  settings: Settings;
  gtin?: string;
  /** 带角色说明的照片：正面 / 背标 / 配料表特写 / 喷码特写 */
  shots?: PhotoShot[];
  /** 老调用方式：只给图片，一律按「整张背标」处理 */
  photos?: string[];
  /** 常用厂家名单，用来把读歪的厂名对回标准写法 */
  makers?: Maker[];
};

function manualSku(gtin: string): Sku {
  return createEmptySku(gtin);
}

export function isEngineConfigured(settings: Settings): boolean {
  return Boolean(settings.apiKey.trim());
}

/** 字段中文名，用来提示「哪一项没读清」 */
const FIELD_LABEL: Record<string, string> = {
  name: '商品名称',
  brand: '品牌',
  manufacturer: '生产厂家',
  scCode: '生产许可证编号',
  standardCode: '产品标准代号',
  ingredientsRaw: '配料表',
  storage: '贮存条件',
  shelfLifeText: '保质期',
  productionDate: '生产日期',
  expiryDate: '到期日',
  packageGrams: '净含量',
};

const ALL_FIELDS = Object.keys(FIELD_LABEL);
/** 这几项缺了就等于没建档，必须复验一次 */
const REQUIRED_FIELDS = ['name', 'manufacturer', 'ingredientsRaw'];
/** 低于这个把握就认为不可信 */
const LOW_CONFIDENCE = 0.75;

const textOf = (json: Record<string, unknown>, key: string) =>
  typeof json[key] === 'string' ? (json[key] as string).trim() : '';

/** 模型给区域可能是对象也可能是数组，两种都收，坏数据一律丢掉 */
function parseRegion(raw: unknown): Region | undefined {
  const clamp = (value: unknown) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return Math.min(1, Math.max(0, num));
  };
  const build = (x?: number, y?: number, w?: number, h?: number) => {
    if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
    if (w < 0.03 || h < 0.03) return undefined;
    return { x, y, w, h };
  };
  if (Array.isArray(raw) && raw.length >= 4) {
    return build(clamp(raw[0]), clamp(raw[1]), clamp(raw[2]), clamp(raw[3]));
  }
  if (raw && typeof raw === 'object') {
    const box = raw as Record<string, unknown>;
    return build(clamp(box.x), clamp(box.y), clamp(box.w), clamp(box.h));
  }
  return undefined;
}

function parseRegions(json: Record<string, unknown>): Regions {
  const raw = (json.regions ?? {}) as Record<string, unknown>;
  const index = Number(raw.photoIndex);
  return {
    photoIndex: Number.isFinite(index) && index >= 1 ? Math.round(index) : undefined,
    ingredients: parseRegion(raw.ingredients),
    date: parseRegion(raw.date),
  };
}

/** 二元字相似度：用来把「漏字 / 多字」的厂名对回常用厂家名单里的标准写法 */
function similarity(left: string, right: string): number {
  const clean = (text: string) => text.replace(/[\s（）()·、,，.。]/g, '');
  const a = clean(left);
  const b = clean(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (text: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const gram = text.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const aGrams = grams(a);
  const bGrams = grams(b);
  let overlap = 0;
  for (const [gram, count] of aGrams) overlap += Math.min(count, bGrams.get(gram) ?? 0);
  return (2 * overlap) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}

function matchMaker(name: string, makers: Maker[]): string | undefined {
  const trimmed = name.trim();
  if (!trimmed || !makers.length) return undefined;
  let best: { name: string; score: number } | undefined;
  for (const maker of makers) {
    const score = similarity(trimmed, maker.name);
    if (!best || score > best.score) best = { name: maker.name, score };
  }
  return best && best.score >= 0.8 && best.name !== trimmed ? best.name : undefined;
}

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');
const isDateField = (key: string) => key === 'productionDate' || key === 'expiryDate';

/**
 * 复验结果能不能采信：
 * 没有 evidence 的修改一律不认（防模型按常识编），日期还必须在证据里逐位出现。
 */
function acceptCorrection(key: string, value: string, evidence: string): boolean {
  if (!value.trim()) return false;
  if (evidence.trim().length < 2) return false;
  if (isDateField(key)) {
    if (!isValidIso(value)) return false;
    const digits = digitsOnly(value);
    return digits.length >= 6 && digitsOnly(evidence).includes(digits);
  }
  return true;
}

const VERIFY_PROMPT = `你是包装标签复验器。第一遍读图时有几个字段拿不准，现在把放大后的局部图（必要时附整张原图）给你，请逐字段重读。
规则：
- 只依据图片上真实印着的字，禁止按常识补全或猜测，宁可留空。
- 每个字段都要给 evidence：把看到的那一小段原文照抄下来；日期就照抄数字原样，例如 2025.05.01 或 20250501。
- 还是看不清就把 value 留成空字符串，并在 notes 里说明是哪一块看不清。
- 第一遍的值如果是对的，原样返回它。
只输出一个 JSON 对象：
{ "fields": { "字段名": { "value": "修正后的值，读不清留空", "evidence": "原图字符", "confidence": 0.0 } }, "notes": "哪里看不清" }
字段名用下面给出的英文键。`;

async function callVerifyApi(
  settings: Settings,
  baseline: Record<string, string>,
  shots: PhotoShot[],
): Promise<Record<string, unknown>> {
  const intro = `${VERIFY_PROMPT}\n待复验字段（第一遍的值仅供参考，不要照抄）：${JSON.stringify(baseline)}`;
  return requestJson(settings.apiKey.trim(), imageParts(shots, intro), 2000);
}

/** 复验要看的图：有对应特写就直接用，没有就把第一遍标出的区域裁出来放大 */
async function verifyShots(shots: PhotoShot[], targets: string[], regions: Regions): Promise<PhotoShot[]> {
  if (!shots.length) return [];
  const wantsDate = targets.some(isDateField);
  const wantsText = targets.some((key) => !isDateField(key));
  const baseIndex = (regions.photoIndex ?? 1) - 1;
  const base = shots[baseIndex] ?? shots[0];
  const picked: PhotoShot[] = [];
  const push = (shot: PhotoShot) => {
    if (!picked.some((item) => item.dataUrl === shot.dataUrl)) picked.push(shot);
  };
  if (wantsDate) {
    const closeUp = shots.find((shot) => shot.role === 'date');
    const crop = closeUp || !regions.date ? undefined : await cropRegion(base.dataUrl, regions.date);
    push(crop ? { dataUrl: crop, role: 'date' } : closeUp ?? base);
  }
  if (wantsText) {
    const closeUp = shots.find((shot) => shot.role === 'ingredients');
    const crop = closeUp || !regions.ingredients ? undefined : await cropRegion(base.dataUrl, regions.ingredients);
    push(crop ? { dataUrl: crop, role: 'ingredients' } : closeUp ?? base);
  }
  if (!picked.length) push(base);
  return picked.slice(0, 3);
}

type VerifyOutcome = {
  patch: Partial<Sku>;
  productionDate?: string;
  expiryDate?: string;
  corrected: string[];
  unclear: string[];
  confirmed: string[];
};

async function runVerify(params: {
  settings: Settings;
  shots: PhotoShot[];
  sku: Sku;
  production: string;
  expiry: string;
  regions: Regions;
  targets: string[];
}): Promise<VerifyOutcome> {
  const { settings, sku, production, expiry, targets } = params;
  const baseline: Record<string, string> = {};
  for (const key of targets) {
    if (key === 'productionDate') baseline[key] = production;
    else if (key === 'expiryDate') baseline[key] = expiry;
  else baseline[key] = String((sku as unknown as Record<string, unknown>)[key] ?? '');
  }
  const images = await verifyShots(params.shots, targets, params.regions);
  const json = await callVerifyApi(settings, baseline, images);
  const fields = (json.fields ?? {}) as Record<string, unknown>;
  const result: VerifyOutcome = { patch: {}, corrected: [], unclear: [], confirmed: [] };
  const trust = { ...sku.confidence };

  for (const key of targets) {
    const entry = (fields[key] ?? {}) as Record<string, unknown>;
    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
    const previous = baseline[key] ?? '';
    const label = FIELD_LABEL[key] ?? key;
    if (!value) {
      // 复验也没读出来：保持原值，但明确标成不可信
      trust[key] = 0.3;
      result.unclear.push(label);
      continue;
    }
    if (value === previous) {
      trust[key] = Math.max(trust[key] ?? 0, 0.9);
      result.confirmed.push(label);
      continue;
    }
    if (!acceptCorrection(key, value, evidence)) {
      trust[key] = 0.3;
      result.unclear.push(label);
      continue;
    }
    trust[key] = 0.85;
    if (key === 'productionDate') result.productionDate = value;
    else if (key === 'expiryDate') result.expiryDate = value;
    else if (key === 'packageGrams') {
      const parsed = parsePackageGrams(value);
      if (parsed) (result.patch as Record<string, unknown>)[key] = parsed;
    } else (result.patch as Record<string, unknown>)[key] = value;
    result.corrected.push(label);
  }

  result.patch.confidence = trust;
  return result;
}

/** 挑出需要复验的字段：把握不够、该有的没读到、或者日期和保质期对不上 */
function pickTargets(sku: Sku, production: string, expiry: string): string[] {
  const confidence = sku.confidence ?? {};
  const values: Record<string, string> = {
    name: sku.name,
    brand: sku.brand,
    manufacturer: sku.manufacturer,
    scCode: sku.scCode ?? '',
    standardCode: sku.standardCode ?? '',
    ingredientsRaw: sku.ingredientsRaw,
    storage: sku.storage ?? '',
    shelfLifeText: sku.shelfLifeText ?? '',
    packageGrams: sku.packageGrams ? String(sku.packageGrams) : '',
    productionDate: production,
    expiryDate: expiry,
  };
  const targets = ALL_FIELDS.filter((key) => {
    const score = confidence[key];
    // 净含量是新增的非必填字段：第一遍完全没读到又没给 confidence 时，
    // 不让所有旧商品都因此多跑一遍复验；模型明确标低分时仍会复验。
    if (key === 'packageGrams' && score === undefined && !values[key].trim()) return false;
    // 模型没给这一项的把握，也当成不可信处理
    if (score === undefined || score < LOW_CONFIDENCE) return true;
    if (REQUIRED_FIELDS.includes(key) && !values[key].trim()) return true;
    return false;
  });
  // 到期日和「生产日期 + 保质期 − 1 天」差得太多，说明至少有一项读错了，拉进去复验
  const life = parseShelfLife(sku.shelfLifeText);
  const expected = production && life ? expiryFrom(production, life) : undefined;
  if (expected && isValidIso(expiry)) {
    const diff = Math.abs(
      (new Date(`${expiry}T00:00:00Z`).getTime() - new Date(`${expected}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (diff > 2) {
      for (const key of ['productionDate', 'expiryDate', 'shelfLifeText']) {
        if (!targets.includes(key)) targets.push(key);
      }
    }
  } else if (!production && !expiry) {
    for (const key of ['productionDate', 'expiryDate']) if (!targets.includes(key)) targets.push(key);
  }
  return targets;
}

/**
 * 识别只走两条路：视觉模型解析，或让用户手工补全。
 * 不再有任何本地伪造数据的兜底，避免出现看似真实其实编造的商品信息。
 */
export async function recognize(input: RecognizeInput): Promise<RecognizeOutcome> {
  const gtin = normalizeGtin(input.gtin);
  const shots: PhotoShot[] = input.shots?.length
    ? input.shots.filter((shot) => Boolean(shot.dataUrl))
    : (input.photos ?? []).filter(Boolean).map((dataUrl) => ({ dataUrl, role: 'back' as PhotoRole }));
  const notices: string[] = [];

  if (!isEngineConfigured(input.settings)) {
    const sku = manualSku(gtin);
    notices.push('尚未填写 DeepSeek API Key，无法自动识别包装内容');
    notices.push('在「设置 → 识别引擎」填入 API Key 后即可自动解析背标');
    return { sku, engine: 'manual', notices, checks: buildChecks(sku, { gtin }) };
  }

  if (!shots.length) {
    const sku = manualSku(gtin);
    notices.push(gtin ? '只扫到条码，没有背标照片，商品信息需要手工补全' : '没有可识别的输入');
    notices.push('拍一张包装背标即可自动解析品牌、厂家、配料表与保质期');
    return { sku, engine: 'manual', notices, checks: buildChecks(sku, { gtin }) };
  }

  try {
    const json = await callVisionApi(input.settings, shots);
    let sku = skuFromModel(json, gtin);
    let production = textOf(json, 'productionDate');
    let expiry = textOf(json, 'expiryDate');
    const regions = parseRegions(json);

    notices.push(
      shots.length > 1
        ? `${shots.length} 张照片已交给视觉模型合并解析，已做条码、SC 编号、保质期三项规则校验`
        : '背标由视觉模型解析，已做条码、SC 编号、保质期三项规则校验',
    );

    // 规则修复：厂名对回常用厂家名单的标准写法
    const canonicalMaker = matchMaker(sku.manufacturer, input.makers ?? []);
    if (canonicalMaker) {
      sku = { ...sku, manufacturer: canonicalMaker, confidence: { ...sku.confidence, manufacturer: 0.9 } };
      notices.push(`厂家名按常用名单校正为「${canonicalMaker}」`);
    }

    // 第二轮：只对拿不准的字段，用放大图重读一遍
    const mode: VerifyMode = input.settings.verifyMode ?? 'auto';
    const targets = mode === 'off' ? [] : pickTargets(sku, production, expiry);
    let verified = false;
    let corrected: string[] = [];
    let unclear: string[] = [];
    if (mode !== 'off' && (mode === 'always' || targets.length)) {
      try {
        const outcome = await runVerify({
          settings: input.settings,
          shots,
          sku,
          production,
          expiry,
          regions,
          targets: targets.length ? targets : ['name', 'manufacturer', 'shelfLifeText', 'productionDate'],
        });
        verified = true;
        corrected = outcome.corrected;
        unclear = outcome.unclear;
        sku = refreshSku({ ...sku, ...outcome.patch });
        production = outcome.productionDate ?? production;
        expiry = outcome.expiryDate ?? expiry;
      } catch (error) {
        // 复验失败不影响第一遍结果，用户照样能入库
        const message = error instanceof Error ? error.message : String(error);
        notices.push(`复验没跑成功：${message}（第一遍结果仍然可用）`);
      }
    }

    return {
      sku,
      engine: 'api',
      notices,
      checks: buildChecks(sku, { gtin: sku.gtin || gtin, productionDate: production, expiryDate: expiry }),
      productionDate: production || undefined,
      expiryDate: expiry || undefined,
      verified,
      corrected,
      unclear,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sku = manualSku(gtin);
    return {
      sku,
      engine: 'manual',
      notices: [`视觉模型调用失败：${message}`, '照片已保留，请按包装手工补全后再入库'],
      checks: buildChecks(sku, { gtin }),
    };
  }
}
