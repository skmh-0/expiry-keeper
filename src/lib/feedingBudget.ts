import type { FeedingLog, PantryItem, Pet, Sku } from '../types';
import { toGrams } from './consumption';
import { categoryOf, energyPlan, parseMetabolizableEnergy } from './pets';
import { todayIso } from './shelfLife';

export type BudgetFood = {
  itemId: string;
  gtin: string;
  skuName: string;
  gramsLeft: number;
  meKcalPerKg: number;
  canEatGrams: number;
};

export type TodayBudget = {
  limit: number;
  consumed: number;
  remaining: number;
  ratio: number;
  state: 'full' | 'low' | 'over';
  items: BudgetFood[];
  uncounted: string[];
};

/**
 * 1.5.2：当天热量额度。只统计能关联到 SKU 且有标签代谢能的投喂；
 * 缺营养数据的商品会列在 uncounted 里，但不编造热量。
 */
export function todayBudget(
  pet: Pet | undefined,
  items: PantryItem[],
  skus: Sku[],
  feedings: FeedingLog[],
  today = todayIso(),
): TodayBudget | undefined {
  if (!pet || !Number.isFinite(pet.weightKg) || Number(pet.weightKg) <= 0) return undefined;
  const plan = energyPlan(pet, today);
  if (!plan) return undefined;
  const skuMap = new Map(skus.map((sku) => [sku.gtin, sku]));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const uncounted = new Set<string>();
  let consumed = 0;

  for (const feeding of feedings) {
    if (feeding.petId !== pet.id || feeding.date !== today) continue;
    const item = feeding.itemId ? itemMap.get(feeding.itemId) : undefined;
    const sku = item ? skuMap.get(item.gtin) : feeding.gtin ? skuMap.get(feeding.gtin) : undefined;
    const me = parseMetabolizableEnergy(sku?.nutrition?.metabolizableEnergy);
    if (!me) {
      uncounted.add(sku?.name || feeding.note || '未关联商品');
      continue;
    }
    consumed += (Math.max(0, feeding.grams) * me) / 1000;
  }

  const remaining = plan.mer - consumed;
  const budgetItems: BudgetFood[] = [];
  for (const item of items) {
    if (item.finishedAt) continue;
    if (item.petId && item.petId !== pet.id) continue;
    const sku = skuMap.get(item.gtin);
    if (!sku || !['dry', 'wet', 'freeze_dried', 'fresh_raw'].includes(categoryOf(sku))) continue;
    const me = parseMetabolizableEnergy(sku.nutrition?.metabolizableEnergy);
    if (!me) {
      uncounted.add(sku.name || '未命名食品');
      continue;
    }
    const gramsLeft = toGrams(item.quantity, item.unit);
    if (!gramsLeft || gramsLeft <= 0) continue;
    budgetItems.push({
      itemId: item.id,
      gtin: item.gtin,
      skuName: sku.name || '未命名食品',
      gramsLeft,
      meKcalPerKg: me,
      canEatGrams: Math.max(0, Math.round(((remaining / me) * 1000) * 10) / 10),
    });
  }
  budgetItems.sort((left, right) => left.gramsLeft - right.gramsLeft);

  const ratio = plan.mer > 0 ? remaining / plan.mer : 0;
  return {
    limit: Math.round(plan.mer * 10) / 10,
    consumed: Math.round(consumed * 10) / 10,
    remaining: Math.round(remaining * 10) / 10,
    ratio,
    state: remaining <= 0 ? 'over' : ratio < 0.7 ? 'low' : 'full',
    items: budgetItems,
    uncounted: [...uncounted],
  };
}

