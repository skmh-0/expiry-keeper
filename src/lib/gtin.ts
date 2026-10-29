/** 条码与食品生产许可证编号的校验规则，全部为真实规则。 */

export function normalizeGtin(raw: string | undefined): string {
  return (raw ?? '').replace(/\D+/g, '');
}

/** GTIN-8/12/13/14 校验位校验（mod 10，权重 3/1 交替）。 */
export function isValidGtin(raw: string | undefined): boolean {
  const digits = normalizeGtin(raw);
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const nums = digits.split('').map(Number);
  const check = nums.pop() as number;
  let sum = 0;
  let weight = 3;
  for (let i = nums.length - 1; i >= 0; i -= 1) {
    sum += nums[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export function gtinKind(raw: string | undefined): string {
  const digits = normalizeGtin(raw);
  switch (digits.length) {
    case 8:
      return 'GTIN-8';
    case 12:
      return 'UPC-A';
    case 13:
      return 'EAN-13';
    case 14:
      return 'GTIN-14';
    default:
      return '未知码制';
  }
}

/** 无条码商品按 GS1 店内码规则生成 EAN-13：前缀 2，仅本地使用，不与外部数据冲突。 */
export function makeInternalGtin(): string {
  let body = '2';
  while (body.length < 12) body += Math.floor(Math.random() * 10).toString();
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function isInternalGtin(raw: string | undefined): boolean {
  const digits = normalizeGtin(raw);
  return digits.length === 13 && digits.startsWith('2');
}

/**
 * 生产许可编号有两种：食品是 SC + 14 位数字，
 * 宠物食品走饲料生产许可证，形如「鲁饲证(2023)02713」。
 */
export function licenseKind(raw: string | undefined): 'food' | 'feed' | 'unknown' {
  const code = (raw ?? '').replace(/\s+/g, '');
  if (!code) return 'unknown';
  if (/^SC\d{14}$/i.test(code)) return 'food';
  if (/^[\u4e00-\u9fa5]{1,3}饲证[（(]?\d{4}[)）]?\d{4,}$/.test(code)) return 'feed';
  return 'unknown';
}

export function normalizeScCode(raw: string | undefined): string {
  const compact = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!compact) return '';
  if (compact.startsWith('SC')) return compact;
  return /^\d{14}$/.test(compact) ? `SC${compact}` : compact;
}

export function isValidScCode(raw: string | undefined): boolean {
  return /^SC\d{14}$/.test(normalizeScCode(raw));
}

const CATEGORY_NAMES: Record<string, string> = {
  '101': '粮食加工品',
  '102': '食用油、油脂及其制品',
  '103': '调味品',
  '104': '肉制品',
  '105': '乳制品',
  '106': '饮料',
  '107': '方便食品',
  '108': '饼干',
  '109': '罐头',
  '110': '冷冻饮品',
  '111': '速冻食品',
  '112': '薯类和膨化食品',
  '113': '糖果制品',
  '114': '茶叶及相关制品',
  '115': '酒类',
  '116': '蔬菜制品',
  '117': '水果制品',
  '118': '炒货食品及坚果制品',
  '119': '蛋制品',
  '120': '可可及焙烤咖啡产品',
  '121': '食糖',
  '122': '水产制品',
  '123': '淀粉及淀粉制品',
  '124': '糕点',
  '125': '豆制品',
  '126': '蜂产品',
  '127': '保健食品',
  '128': '特殊医学用途配方食品',
  '129': '婴幼儿配方食品',
  '130': '特殊膳食食品',
  '131': '其他食品',
};

/** SC 编号结构：SC + 3 位食品类别 + 2 位省 + 2 位市 + 2 位县 + 4 位顺序码 + 1 位校验码。 */
export function describeScCode(raw: string | undefined): string | undefined {
  const code = normalizeScCode(raw);
  if (!isValidScCode(code)) return undefined;
  const body = code.slice(2);
  const category = body.slice(0, 3);
  const province = body.slice(3, 5);
  const city = body.slice(5, 7);
  const county = body.slice(7, 9);
  const seq = body.slice(9, 13);
  const categoryName = CATEGORY_NAMES[category] ?? '未收录类别';
  return `${categoryName} · ${province}/${city}/${county} · 顺序码 ${seq}`;
}
