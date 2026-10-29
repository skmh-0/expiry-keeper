import type { ExpiryStatus } from '../types';

export type ShelfLife = {
  value: number;
  unit: 'day' | 'week' | 'month' | 'year';
  days: number;
  text: string;
};

const UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(个月|月|年|周|星期|天|日)/;

/** 解析「保质期 12 个月 / 45天 / 1年」这类标签文本。 */
export function parseShelfLife(text: string | undefined): ShelfLife | undefined {
  if (!text) return undefined;
  const matched = text.replace(/\s+/g, '').match(UNIT_PATTERN);
  if (!matched) return undefined;
  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const raw = matched[2];
  let unit: ShelfLife['unit'];
  if (raw === '个月' || raw === '月') unit = 'month';
  else if (raw === '年') unit = 'year';
  else if (raw === '周' || raw === '星期') unit = 'week';
  else unit = 'day';
  const days = Math.round(
    unit === 'day' ? value : unit === 'week' ? value * 7 : unit === 'month' ? value * 30 : value * 365,
  );
  return { value, unit, days, text: `${value}${raw}` };
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** 时间戳转成本地日期（用于把入库时间当作开封日期）。 */
export function isoFromTimestamp(ms: number): string {
  const date = new Date(ms);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/**
 * 到期日 = 生产日期 + 保质期 − 1 天。
 * 例：生产 2025-05-01、保质期 18 个月 → 保质期至 2026-10-31（不是 11-01）。
 */
export function expiryFrom(productionDate: string, life: ShelfLife | undefined): string | undefined {
  if (!productionDate || !life) return undefined;
  const added = (() => {
    switch (life.unit) {
      case 'day':
        return shiftDays(productionDate, life.value);
      case 'week':
        return shiftDays(productionDate, life.value * 7);
      case 'month':
        return shiftMonths(productionDate, Math.round(life.value));
      case 'year':
        return shiftMonths(productionDate, Math.round(life.value * 12));
      default:
        return undefined;
    }
  })();
  return added ? shiftDays(added, -1) : undefined;
}

/**
 * 临期阈值固定 3 个月；「注意」阈值取保质期的一半（保质期过半）。
 * 短保商品（一半不足 3 个月）只会进入临期，长保商品会先经过「过半」再到临期。
 */
export function statusThresholds(shelfLifeText?: string): { soonDays: number; watchDays: number } {
  const life = parseShelfLife(shelfLifeText);
  const half = life ? Math.max(1, Math.round(life.days / 2)) : 90;
  return {
    soonDays: 90,
    watchDays: Math.max(90, half),
  };
}

export function isValidIso(iso: string | undefined): iso is string {
  return !!iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime());
}

export function daysUntil(iso: string | undefined): number | undefined {
  if (!isValidIso(iso)) return undefined;
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const now = new Date(`${todayIso()}T00:00:00Z`).getTime();
  return Math.round((target - now) / 86_400_000);
}

/** 两个日期之间相差的天数（不含结束日，9.5→9.15 记 10 天）。 */
export function diffDays(from: string, to: string): number {
  if (!isValidIso(from) || !isValidIso(to)) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function statusOf(expiryDate: string | undefined, soonDays = 7, watchDays = 30): ExpiryStatus {
  const left = daysUntil(expiryDate);
  if (left === undefined) return 'unknown';
  if (left < 0) return 'expired';
  if (left <= soonDays) return 'soon';
  if (left <= watchDays) return 'watch';
  return 'ok';
}

export const STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: '已过期',
  soon: '临期',
  watch: '过半',
  ok: '充足',
  unknown: '无日期',
};

export function formatCn(iso: string | undefined): string {
  if (!isValidIso(iso)) return '未填写';
  const [y, m, d] = (iso as string).split('-');
  return `${y}-${m}-${d}`;
}

export function remainingText(iso: string | undefined): string {
  const left = daysUntil(iso);
  if (left === undefined) return '未推算';
  if (left < 0) return `已过期 ${Math.abs(left)} 天`;
  if (left === 0) return '今天到期';
  return `剩 ${left} 天`;
}
