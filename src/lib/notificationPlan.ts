import type { PantryItem } from '../types';

export type PlannedNotification = {
  id: number;
  title: string;
  body: string;
  /** 毫秒时间戳 */
  at: number;
  immediate: boolean;
};

export function notificationId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

function localToday(now: number): string {
  const date = new Date(now);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function daysLeft(expiryDate: string, now: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return undefined;
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return undefined;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

/**
 * 把库存转换成本地通知计划。
 * 重点：提醒时点已经过去（今天到期、或提前提醒日已过）时不能再直接跳过，
 * 否则用户永远收不到——改成 15 秒后补发；已经过期则在当天补发一次。
 */
export function planExpiryNotifications(
  items: PantryItem[],
  nameOf: (gtin: string) => string,
  remindDays: number,
  notified: Record<string, string> | undefined,
  now = Date.now(),
  enabledAt = 0,
): { notifications: PlannedNotification[]; immediate: boolean; notified: Record<string, string> } {
  const today = localToday(now);
  let immediate = false;
  const notifications: PlannedNotification[] = [];
  const nextNotified: Record<string, string> = { ...(notified ?? {}) };

  for (const item of items) {
    if (item.finishedAt || !item.expiryDate) continue;
    const left = daysLeft(item.expiryDate, now);
    if (left === undefined) continue;
    const name = nameOf(item.gtin) || '库存商品';
    let at: number;
    let title: string;
    let body: string;
    let isImmediate = false;
    const expiryAt = new Date(`${item.expiryDate}T09:00:00`).getTime();

    if (left < 0) {
      if (expiryAt < enabledAt) continue;
      if (notified?.[item.id] === today) continue;
      at = now + 5_000;
      title = `${name} 已过期`;
      body = `到期日 ${item.expiryDate}，已过期 ${Math.abs(left)} 天`;
      isImmediate = true;
    } else {
      const fireAt = new Date(`${item.expiryDate}T09:00:00`);
      fireAt.setDate(fireAt.getDate() - remindDays);
      if (fireAt.getTime() < enabledAt) continue;
      if (fireAt.getTime() <= now + 5_000) {
        if (notified?.[item.id] === today) continue;
        at = now + 15_000;
        title = `${name} 即将到期`;
        body = left === 0 ? '今天到期，记得安排喂食或处理' : `到期日 ${item.expiryDate}，只剩 ${left} 天`;
        isImmediate = true;
      } else {
        at = fireAt.getTime();
        title = `${name} 即将到期`;
        body = `到期日 ${item.expiryDate}，还剩 ${Math.max(left, 0)} 天`;
      }
    }

    if (isImmediate) immediate = true;
    if (isImmediate) nextNotified[item.id] = today;
    notifications.push({ id: notificationId(item.id), title, body, at, immediate: isImmediate });
  }

  return { notifications, immediate, notified: nextNotified };
}
