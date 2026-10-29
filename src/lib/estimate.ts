import type { FeedingLog, PantryItem, Pet, Sku } from '../types';
import { toGrams } from './consumption';
import { CATEGORY_META, categoryOf, categoryLabel } from './pets';
import { diffDays, isValidIso, shiftDays, todayIso } from './shelfLife';

export type ItemEstimate = {
  item: PantryItem;
  sku?: Sku;
  grams: number;
  /** 7 天窗口内的日均消耗（克） */
  daily?: number;
  /** 当前库存还能吃多少天 */
  remainingDays?: number;
  /** 预警线：日均 × 7 天 */
  warningGrams?: number;
  windowDays: number;
  windowTotal: number;
};

/**
 * 日均消耗 =（窗口初库存 − 当前库存）÷ 窗口天数。
 * 窗口初库存 = 当前量 + 窗口内投喂总量；没有投喂记录时无法估算。
 */
export function estimateItem(
  item: PantryItem,
  sku: Sku | undefined,
  feedings: FeedingLog[],
  today = todayIso(),
  windowDays = 7,
): ItemEstimate | undefined {
  if (item.finishedAt) return undefined;
  const grams = toGrams(item.quantity, item.unit);
  if (!grams) return undefined;
  const start = shiftDays(today, -(windowDays - 1));
  const entries = feedings.filter(
    (feeding) =>
      feeding.itemId === item.id &&
      isValidIso(feeding.date) &&
      feeding.date >= start &&
      feeding.date <= today,
  );
  if (!entries.length) {
    return { item, sku, grams, windowDays, windowTotal: 0 };
  }
  const firstDate = entries.reduce((min, entry) => (entry.date < min ? entry.date : min), entries[0].date);
  const elapsed = Math.min(windowDays, Math.max(1, diffDays(firstDate, today) + 1));
  const windowTotal = Math.round(entries.reduce((sum, entry) => sum + Math.max(0, entry.grams), 0) * 10) / 10;
  const daily = Math.round((windowTotal / elapsed) * 10) / 10;
  return {
    item,
    sku,
    grams,
    daily,
    remainingDays: daily > 0 ? Math.round((grams / daily) * 10) / 10 : undefined,
    warningGrams: daily > 0 ? Math.round(daily * 7 * 10) / 10 : undefined,
    windowDays: elapsed,
    windowTotal,
  };
}

export type StockGroup = {
  key: string;
  label: string;
  totalGrams: number;
  daily?: number;
  remainingDays?: number;
  itemCount: number;
};

export type StockDimension = 'category' | 'pet' | 'household';

/** 三维统计：按分类 / 按宠物 / 全家庭，输出存量总额与可吃天数 */
export function summarizeStock(
  items: PantryItem[],
  skus: Sku[],
  feedings: FeedingLog[],
  pets: Pet[],
  dimension: StockDimension,
  today = todayIso(),
): StockGroup[] {
  const groups = new Map<string, { label: string; total: number; daily: number; count: number; hasDaily: boolean }>();
  for (const item of items) {
    if (item.finishedAt) continue;
    const sku = skus.find((candidate) => candidate.gtin === item.gtin);
    const estimate = estimateItem(item, sku, feedings, today);
    if (!estimate) continue;
    const key =
      dimension === 'household'
        ? 'household'
        : dimension === 'category'
          ? categoryOf(sku)
          : item.petId ?? 'shared';
    const label =
      dimension === 'household'
        ? '全家庭'
        : dimension === 'category'
          ? CATEGORY_META[categoryOf(sku)].label
          : item.petId
            ? pets.find((pet) => pet.id === item.petId)?.name ?? '未知宠物'
            : '家庭公共';
    const current = groups.get(key) ?? { label, total: 0, daily: 0, count: 0, hasDaily: false };
    current.total += estimate.grams;
    current.count += 1;
    if (estimate.daily) {
      current.daily += estimate.daily;
      current.hasDaily = true;
    }
    groups.set(key, current);
  }
  const order = new Map(pets.map((pet, index) => [pet.id, index]));
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      totalGrams: Math.round(group.total),
      daily: group.hasDaily ? Math.round(group.daily * 10) / 10 : undefined,
      remainingDays: group.hasDaily && group.daily > 0 ? Math.round((group.total / group.daily) * 10) / 10 : undefined,
      itemCount: group.count,
    }))
    .sort((left, right) => {
      if (dimension === 'pet') {
        const a = left.key === 'shared' ? 999 : order.get(left.key) ?? 500;
        const b = right.key === 'shared' ? 999 : order.get(right.key) ?? 500;
        return a - b;
      }
      return right.totalGrams - left.totalGrams;
    });
}

export function groupTitle(sku: Sku | undefined): string {
  return sku ? categoryLabel(sku) : '未分类';
}
