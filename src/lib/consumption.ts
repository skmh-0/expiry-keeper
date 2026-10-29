import type { PantryItem } from '../types';
import { diffDays, isoFromTimestamp, isValidIso, todayIso } from './shelfLife';

export function laterIso(left: string, right: string): string {
  return left > right ? left : right;
}

export function earlierIso(left: string, right: string): string {
  return left < right ? left : right;
}

export type ConsumptionRow = {
  item: PantryItem;
  /** 开封日期（缺省时按入库日期推算） */
  start: string;
  /** 用完日期；还在用就是今天 */
  end: string;
  /** 开封到用完的总天数，用于算日均 */
  totalDays: number;
  /** 日均消耗，克/天 */
  rate: number;
  /** 落在筛选区间内的天数 */
  windowDays: number;
  /** 筛选区间内的消耗克数 */
  grams: number;
  /** 是否还在用中（数值为估算） */
  openEnded: boolean;
  /** 开封日期是否由入库日期推算而来 */
  assumedOpen: boolean;
};

/**
 * 把一段消耗（开封 → 用完）按天数摊到筛选区间里。
 * 例：9.5 开封、9.15 用完、共 100 克 → 10 天、10 克/天；
 * 查 9.10~9.15 落在区间内 5 天 → 约 50 克。
 */
export function computeConsumption(item: PantryItem, from: string, to: string): ConsumptionRow | undefined {
  // 按件/袋记录的商品换算不出克数，不参与克数统计，避免被当成 1 克
  const grams = toGrams(item.quantity, item.unit);
  if (!grams) return undefined;
  if (!isValidIso(from) || !isValidIso(to) || from > to) return undefined;

  const end = item.finishedAt && isValidIso(item.finishedAt) ? item.finishedAt : todayIso();
  const assumedOpen = !item.openedAt || !isValidIso(item.openedAt);
  // 既没开封、也没结案的商品不参与消耗：不知道从哪天开始吃，摊不出日均
  if (!item.finishedAt && assumedOpen) return undefined;
  const start = assumedOpen ? isoFromTimestamp(item.createdAt) : (item.openedAt as string);
  if (start > end) return undefined;

  const totalDays = Math.max(1, diffDays(start, end));
  const rate = grams / totalDays;
  const overlapStart = laterIso(start, from);
  const overlapEnd = earlierIso(end, to);
  let windowDays = Math.max(0, diffDays(overlapStart, overlapEnd));
  if (windowDays === 0) {
    const sameDay = diffDays(start, end) === 0;
    if (sameDay && item.finishedAt && from <= start && start <= to) {
      // 当天开封当天用完：整份算在那一天
      windowDays = 1;
    } else {
      // 今天刚开封还没得估，或者区间完全不相交
      return undefined;
    }
  }

  return {
    item,
    start,
    end,
    totalDays,
    rate,
    windowDays,
    grams: rate * windowDays,
    openEnded: !item.finishedAt,
    assumedOpen,
  };
}

export function formatGrams(value: number): string {
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return `${Math.round(value)}`;
  return `${Math.round(value * 10) / 10}`;
}

/** 把「数量 + 单位」换算成克；按件/袋这类换算不出来的返回 undefined。 */
export function toGrams(quantity: number | undefined, unit: string | undefined): number | undefined {
  const value = Number(quantity) || 0;
  if (value <= 0) return undefined;
  const text = (unit ?? '').trim().toLowerCase();
  if (!text || ['克', 'g', 'gram', 'grams'].includes(text)) return value;
  if (['千克', '公斤', 'kg'].includes(text)) return value * 1000;
  if (['毫升', 'ml'].includes(text)) return value;
  if (['升', 'l'].includes(text)) return value * 1000;
  return undefined;
}
