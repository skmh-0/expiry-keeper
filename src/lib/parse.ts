/** 配料表切分与添加剂、致敏物质识别：规则引擎，不依赖模型。 */

export function splitTopLevel(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of raw) {
    if (char === '（' || char === '(') depth += 1;
    else if (char === '）' || char === ')') depth = Math.max(0, depth - 1);
    const isSeparator = depth === 0 && '、,，;；'.includes(char);
    if (isSeparator) {
      if (buffer.trim()) out.push(buffer.trim());
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out.filter(Boolean);
}

export function parenthetical(raw: string, keyword: string): string | undefined {
  const index = raw.indexOf(keyword);
  if (index < 0) return undefined;
  const rest = raw.slice(index + keyword.length);
  const start = rest.search(/[（(]/);
  if (start < 0) return undefined;
  const open = rest[start];
  const close = open === '（' ? '）' : ')';
  const end = rest.indexOf(close, start + 1);
  if (end < 0) return undefined;
  return rest.slice(start + 1, end);
}

const ADDITIVE_TERMS = [
  '山梨酸钾',
  '苯甲酸钠',
  '脱氢乙酸钠',
  '三氯蔗糖',
  '甜蜜素',
  '安赛蜜',
  '糖精钠',
  '阿斯巴甜',
  '纽甜',
  '甜菊糖苷',
  '罗汉果甜苷',
  '亚硝酸钠',
  '硝酸钠',
  '亚硫酸钠',
  '焦亚硫酸钠',
  '柠檬酸',
  '柠檬酸钠',
  '碳酸氢钠',
  '碳酸钠',
  '磷酸氢钙',
  '焦磷酸钠',
  '三聚磷酸钠',
  '六偏磷酸钠',
  '谷氨酸钠',
  '呈味核苷酸二钠',
  '黄原胶',
  '卡拉胶',
  '瓜尔胶',
  '果胶',
  '明胶',
  '单，双甘油脂肪酸酯',
  '单双甘油脂肪酸酯',
  '蔗糖脂肪酸酯',
  '聚甘油脂肪酸酯',
  '丙二醇',
  '二氧化钛',
  '焦糖色',
  '日落黄',
  '柠檬黄',
  '胭脂红',
  '诱惑红',
  '亮蓝',
  '红曲红',
  '抗坏血酸',
  '维生素C',
  '维生素E',
  '生育酚',
  '乳酸',
  '乳酸钠',
  '乳酸链球菌素',
  '冰醋酸',
  '纳他霉素',
  '麦芽糖醇',
  '山梨糖醇',
  '木糖醇',
  '赤藓糖醇',
  '聚葡萄糖',
  '甲基纤维素钠',
  '微晶纤维素',
  '海藻酸钠',
  '葡萄糖酸内酯',
  '食用香精',
  '食用香料',
  '柠檬酸钙',
  '乳酸钙',
  '氧化锌',
];

export function detectAdditives(raw: string): string[] {
  const found: string[] = [];
  const push = (value: string) => {
    const name = value.trim().replace(/^[：:]+/, '');
    if (!name) return;
    if (found.some((item) => item === name || item.includes(name) || name.includes(item))) return;
    found.push(name);
  };
  const group = parenthetical(raw, '食品添加剂');
  if (group) {
    splitTopLevel(group).forEach((item) => {
      const cleaned = item.replace(/[（(].*?[）)]/g, '').trim();
      if (cleaned.length <= 24) push(cleaned);
    });
  }
  for (const term of ADDITIVE_TERMS) {
    if (raw.includes(term)) push(term);
  }
  return found;
}

const ALLERGEN_GROUPS: { label: string; keywords: string[] }[] = [
  { label: '含麸质的谷物（小麦）', keywords: ['小麦', '麸质', '面粉', '大麦', '黑麦', '燕麦', '全麦'] },
  { label: '乳及乳制品', keywords: ['生牛乳', '牛乳', '乳粉', '乳清', '奶油', '黄油', '干酪', '酪蛋白', '炼乳', '奶粉'] },
  { label: '大豆', keywords: ['大豆', '豆粉', '酱油', '豆油', '卵磷脂', '豆瓣酱', '蚕豆'] },
  { label: '蛋类', keywords: ['鸡蛋', '蛋粉', '蛋黄', '蛋白粉', '全蛋', '蛋液'] },
  { label: '花生', keywords: ['花生'] },
  { label: '坚果', keywords: ['杏仁', '核桃', '腰果', '榛子', '开心果', '夏威夷果', '巴旦木', '坚果'] },
  { label: '鱼类及甲壳类', keywords: ['鱼', '虾', '蟹', '贝', '牡蛎', '鱿鱼'] },
  { label: '芝麻', keywords: ['芝麻'] },
];

export function detectAllergens(raw: string): string[] {
  return ALLERGEN_GROUPS.filter((group) => group.keywords.some((keyword) => raw.includes(keyword))).map(
    (group) => group.label,
  );
}

export function completenessOf(input: {
  name?: string;
  brand?: string;
  brandOwner?: string;
  manufacturer?: string;
  scCode?: string;
  ingredientsRaw?: string;
  shelfLifeText?: string;
  nutrition?: Record<string, string | undefined>;
}): number {
  const fields = [
    !!input.name,
    !!input.brand,
    !!input.brandOwner,
    !!input.manufacturer,
    !!input.scCode,
    !!input.ingredientsRaw,
    !!input.shelfLifeText,
    !!input.nutrition && Object.values(input.nutrition).some(Boolean),
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}
