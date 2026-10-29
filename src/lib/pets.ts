import type { PantryItem, Pet, PetCategory, Sku, WeightUnit } from '../types';
import { diffDays, isValidIso, shiftDays, todayIso } from './shelfLife';

export type CategoryMeta = {
  label: string;
  short: string;
  /** 开封后建议天数，0 表示该分类不按开封效期管理 */
  openedDays: number;
  /** 无标签代谢能时使用的分类均值 kcal/kg */
  meKcalPerKg: number;
  food: boolean;
};

export const CATEGORY_META: Record<PetCategory, CategoryMeta> = {
  dry: { label: '干粮', short: '干粮', openedDays: 42, meKcalPerKg: 3600, food: true },
  wet: { label: '湿粮罐头', short: '湿粮', openedDays: 2, meKcalPerKg: 900, food: true },
  freeze_dried: { label: '冻干零食', short: '冻干', openedDays: 30, meKcalPerKg: 3800, food: true },
  fresh_raw: { label: '鲜粮生骨肉', short: '鲜粮', openedDays: 3, meKcalPerKg: 1500, food: true },
  medicine: { label: '药品保健品', short: '药品', openedDays: 0, meKcalPerKg: 0, food: false },
  supplies: { label: '用品耗材', short: '用品', openedDays: 0, meKcalPerKg: 0, food: false },
};

export const CATEGORY_ORDER: PetCategory[] = ['dry', 'wet', 'freeze_dried', 'fresh_raw', 'medicine', 'supplies'];
export const FOOD_CATEGORIES: PetCategory[] = ['dry', 'wet', 'freeze_dried', 'fresh_raw'];

export const WEIGHT_UNITS: { value: WeightUnit; label: string; perKg: number }[] = [
  { value: 'g', label: '克', perKg: 1000 },
  { value: 'jin', label: '斤', perKg: 2 },
  { value: 'kg', label: '公斤', perKg: 1 },
];

export function weightUnitMeta(unit: WeightUnit | undefined) {
  return WEIGHT_UNITS.find((item) => item.value === unit) ?? WEIGHT_UNITS[1];
}

/** 用户输入值 → 内部 kg。1 斤 = 0.5kg。 */
export function weightToKg(value: number, unit: WeightUnit | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.round((value / weightUnitMeta(unit).perKg) * 1000) / 1000;
}

/** 内部 kg → 用户单位下的显示值。 */
export function weightFromKg(weightKg: number | undefined, unit: WeightUnit | undefined): number | undefined {
  if (!Number.isFinite(weightKg) || Number(weightKg) <= 0) return undefined;
  return Math.round(Number(weightKg) * weightUnitMeta(unit).perKg * 100) / 100;
}

export function formatWeight(weightKg: number | undefined, unit: WeightUnit | undefined): string {
  const value = weightFromKg(weightKg, unit);
  return value === undefined ? '未填写' : `${value} ${weightUnitMeta(unit).label}`;
}

export function categoryOf(sku?: Sku): PetCategory {
  const value = sku?.category;
  if (value && value !== 'other') return value;
  return 'supplies';
}

export function categoryLabel(sku?: Sku): string {
  return CATEGORY_META[categoryOf(sku)].label;
}

/** 库存/消耗页使用的干湿分组；冻干归在干粮侧。 */
export function foodGroupOf(sku?: Sku): 'dry' | 'wet' | undefined {
  const category = categoryOf(sku);
  if (category === 'dry' || category === 'freeze_dried') return 'dry';
  if (category === 'wet') return 'wet';
  return undefined;
}

export function kindLabel(sku?: Sku): string {
  if (sku?.kind === 'staple') return '主食';
  if (sku?.kind === 'snack') return '零食';
  return '';
}

export function petAgeMonths(pet: Pet, today = todayIso()): number | undefined {
  if (!isValidIso(pet.birthDate) || pet.birthDate > today) return undefined;
  // 用「天数 / 30.4375」近似月龄，足够判断幼/成/老
  const days = diffDays(pet.birthDate, today);
  return Math.max(0, Math.round(days / 30.4375));
}

export type PetStage = 'young' | 'adult' | 'senior' | 'unknown';

export function petStage(pet: Pet, today = todayIso()): PetStage {
  const months = petAgeMonths(pet, today);
  if (months === undefined) return 'unknown';
  if (months < 12) return 'young';
  if (months >= 96) return 'senior';
  return 'adult';
}

export type EnergyPlan = {
  weightKg: number;
  rer: number;
  factor: number;
  factorLabel: string;
  mer: number;
};

/** RER = 70 × 体重^0.75；系数按幼/成绝育/成未绝育/老/减重 */
export function energyPlan(pet: Pet, today = todayIso()): EnergyPlan | undefined {
  const weightKg = Number(pet.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) return undefined;
  const rer = 70 * Math.pow(weightKg, 0.75);
  const stage = petStage(pet, today);
  let factor = 1.0;
  let factorLabel = '成猫 · 已绝育 1.0';
  if (stage === 'young') {
    factor = 1.2;
    factorLabel = '幼年 1.2';
  } else if (stage === 'senior') {
    factor = 0.8;
    factorLabel = '老年 0.8';
  } else if (pet.neutered === false) {
    factor = 1.2;
    factorLabel = '成猫 · 未绝育 1.2';
  } else if (pet.neutered === undefined) {
    factor = 1.0;
    factorLabel = '成猫 · 绝育未知 1.0';
  }
  return { weightKg, rer, factor, factorLabel, mer: rer * factor };
}

/** 每日克数 = MER ÷ 代谢能(kcal/kg) × 1000 */
export function dailyGrams(plan: EnergyPlan | undefined, meKcalPerKg: number | undefined): number | undefined {
  if (!plan || !meKcalPerKg || meKcalPerKg <= 0) return undefined;
  return Math.round(((plan.mer / meKcalPerKg) * 1000) * 10) / 10;
}

/** 包装规格转成单包克数：1.5kg → 1500；500g×6包 → 500。 */
export function parsePackageGrams(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 10) / 10 : undefined;
  }
  if (!raw) return undefined;
  const text = raw.trim().toLowerCase().replace(/,/g, '');
  const kg = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|千克|公斤)/i);
  if (kg) {
    const value = Number(kg[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 1000 * 10) / 10 : undefined;
  }
  const gram = text.match(/(\d+(?:\.\d+)?)\s*(?:g|克)(?:\s*[×x*]\s*\d+)?/i);
  if (gram) {
    const value = Number(gram[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : undefined;
  }
  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const value = Number(bare[1]);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : undefined;
  }
  return undefined;
}

/** 解析标签上的代谢能：4000 kcal/kg、4.0 kcal/g、3800 千卡/千克 都认 */
export function parseMetabolizableEnergy(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (/kcal\s*\/\s*g|千卡\s*\/\s*克|大卡\s*\/\s*克/i.test(text) || value < 50) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

export function mealEnergy(sku: Sku | undefined): { me: number; fromLabel: boolean } {
  const label = parseMetabolizableEnergy(sku?.nutrition?.metabolizableEnergy);
  if (label) return { me: label, fromLabel: true };
  return { me: CATEGORY_META[categoryOf(sku)].meKcalPerKg, fromLabel: false };
}

export type PackageStats = {
  packageGrams: number;
  meKcalPerKg: number;
  dailyGrams: number;
  totalKcal: number;
  days: number;
  displayDays: string;
};

/** 1.5.1：按该 SKU 的代谢能和单包克数，估算这一包能吃多久。 */
export function pkgStats(sku: Sku | undefined, pet: Pet, today = todayIso()): PackageStats | undefined {
  const packageGrams = Number(sku?.packageGrams);
  const meKcalPerKg = parseMetabolizableEnergy(sku?.nutrition?.metabolizableEnergy);
  const plan = energyPlan(pet, today);
  const perDay = dailyGrams(plan, meKcalPerKg);
  if (!plan || !packageGrams || packageGrams <= 0 || !meKcalPerKg || !perDay) return undefined;
  const totalKcal = Math.round(((meKcalPerKg * packageGrams) / 1000) * 10) / 10;
  const days = Math.max(0, Math.floor(totalKcal / plan.mer));
  return {
    packageGrams,
    meKcalPerKg,
    dailyGrams: perDay,
    totalKcal,
    days,
    displayDays: days > 365 ? '约能吃一年以上' : `约能吃 ${days} 天`,
  };
}

/** 开封后到期日 = 开封日 + 分类预设天数 */
export function openedExpirySuggestion(sku: Sku | undefined, fromDate = todayIso()): string | undefined {
  const meta = CATEGORY_META[categoryOf(sku)];
  if (!meta.openedDays || !isValidIso(fromDate)) return undefined;
  return shiftDays(fromDate, meta.openedDays);
}

/** 已开封商品的实际到期日取「包装到期日」和「开封后到期日」中较早的那个 */
export function effectiveExpiry(item: PantryItem): string | undefined {
  const dates = [item.expiryDate, item.openedAt ? item.openedExpiryDate : undefined].filter(
    (value): value is string => isValidIso(value),
  );
  if (!dates.length) return undefined;
  return dates.sort()[0];
}
