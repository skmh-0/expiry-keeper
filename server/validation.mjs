const CATEGORY_VALUES = new Set(['dry', 'wet', 'freeze_dried', 'fresh_raw', 'medicine', 'supplies']);
const KIND_VALUES = new Set(['staple', 'snack']);

export const LIMITS = {
  barcode: 14,
  name: 200,
  brand: 80,
  manufacturer: 160,
  ingredientsRaw: 8000,
  storage: 500,
  shelfLifeText: 80,
  nutritionValue: 120,
  userHash: 64,
};

export function text(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export function normalizeBarcode(value) {
  const barcode = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return barcode.length >= 8 && barcode.length <= LIMITS.barcode ? barcode : '';
}

export function validUserHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function normalizeNutrition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const keys = [
    'metabolizableEnergy',
    'crudeProtein',
    'crudeFat',
    'crudeFiber',
    'crudeAsh',
    'moisture',
    'taurine',
    'calciumPhosphorus',
  ];
  const output = {};
  for (const key of keys) {
    const value = text(raw[key], LIMITS.nutritionValue);
    if (value) output[key] = value;
  }
  return Object.keys(output).length ? output : undefined;
}

function boundedNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.round(number * 100) / 100;
}

/** 模型输出和用户回流的最后一道硬校验：脏字段直接丢弃，不靠猜测补齐。 */
export function sanitizeCleanedProduct(candidate, fallbackBarcode = '') {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const barcode = normalizeBarcode(candidate.barcode || fallbackBarcode);
  const name = text(candidate.name, LIMITS.name);
  if (!barcode || !name) return undefined;
  const category = CATEGORY_VALUES.has(candidate.category) ? candidate.category : undefined;
  const kind = KIND_VALUES.has(candidate.kind) ? candidate.kind : undefined;
  return {
    barcode,
    name,
    brand: text(candidate.brand, LIMITS.brand),
    manufacturer: text(candidate.manufacturer, LIMITS.manufacturer),
    category,
    kind,
    ingredientsRaw: text(candidate.ingredientsRaw, LIMITS.ingredientsRaw),
    storage: text(candidate.storage, LIMITS.storage),
    shelfLifeText: text(candidate.shelfLifeText, LIMITS.shelfLifeText),
    shelfLifeMonths: boundedNumber(candidate.shelfLifeMonths, 1, 1200),
    packageGrams: boundedNumber(candidate.packageGrams, 0.01, 1_000_000),
    nutrition: normalizeNutrition(candidate.nutrition),
  };
}

export function validateContributionBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体必须是对象';
  const barcode = normalizeBarcode(body.barcode);
  if (!barcode) return '条码长度应为 8-14 位数字';
  if (!validUserHash(body.user_hash)) return 'user_hash 必须是 SHA-256 十六进制字符串';
  const product = body.product;
  if (!product || typeof product !== 'object' || Array.isArray(product)) return '缺少 product 对象';
  if (!text(product.name, LIMITS.name)) return '商品名称不能为空';
  if (text(product.name, LIMITS.name + 1).length > LIMITS.name) return `商品名称不能超过 ${LIMITS.name} 字`;
  if (text(product.brand, LIMITS.brand + 1).length > LIMITS.brand) return `品牌不能超过 ${LIMITS.brand} 字`;
  if (
    text(product.manufacturer, LIMITS.manufacturer + 1).length > LIMITS.manufacturer
  ) {
    return `生产厂家不能超过 ${LIMITS.manufacturer} 字`;
  }
  if (
    text(product.ingredientsRaw, LIMITS.ingredientsRaw + 1).length > LIMITS.ingredientsRaw
  ) {
    return `配料表不能超过 ${LIMITS.ingredientsRaw} 字`;
  }
  if (product.category && !CATEGORY_VALUES.has(product.category)) return '商品分类不合法';
  if (product.kind && !KIND_VALUES.has(product.kind)) return '商品用途不合法';
  return undefined;
}

export { CATEGORY_VALUES, KIND_VALUES };
