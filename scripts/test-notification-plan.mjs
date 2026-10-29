/**
 * 通知排程逻辑（不依赖真机）：
 *  1 今天到期、提醒时点已过 → 15 秒后补发
 *  2 已过期且今天没提醒 → 5 秒后补发
 *  3 已过期但今天提醒过 → 不再重复
 *  4 远期到期 → 按「到期日 09:00 − 提前天数」排未来
 *  5 已用完的商品不排
 *  6 今天到期但今天已提醒 → 不重复
 */
import { planExpiryNotifications } from '../src/lib/notificationPlan.ts';

const now = new Date('2026-10-29T12:00:00+08:00').getTime();
const iso = (offsetDays) => {
  const date = new Date(now);
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const item = (id, expiryDate, extra = {}) => ({
  id,
  gtin: `69000000000${id}`,
  quantity: 100,
  unit: '克',
  location: '',
  expiryDate,
  createdAt: now,
  ...extra,
});
const nameOf = () => '测试猫粮';
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

const today = planExpiryNotifications([item('1', iso(0))], nameOf, 7, undefined, now);
check('1 今天到期会立即补发', today.immediate && today.notifications.length === 1, JSON.stringify(today.notifications));
check('1 补发时间约 15 秒后', Math.abs(today.notifications[0].at - (now + 15_000)) < 10, `${today.notifications[0].at - now}ms`);

const expired = planExpiryNotifications([item('2', iso(-3))], nameOf, 7, undefined, now);
check('2 已过期会立即补发', expired.immediate && expired.notifications.length === 1);
check('2 补发时间约 5 秒后', Math.abs(expired.notifications[0].at - (now + 5_000)) < 10);

const todayText = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const expiredNotified = planExpiryNotifications([item('3', iso(-3))], nameOf, 7, { 3: todayText }, now);
check('3 今天提醒过就不再弹', !expiredNotified.immediate && expiredNotified.notifications.length === 0);

const future = planExpiryNotifications([item('4', iso(40))], nameOf, 7, undefined, now);
check('4 远期商品排在将来', !future.immediate && future.notifications.length === 1 && future.notifications[0].at > now);

const finished = planExpiryNotifications([item('5', iso(0), { finishedAt: iso(-1) })], nameOf, 7, undefined, now);
check('5 已用完的不排通知', finished.notifications.length === 0);

const todayNotified = planExpiryNotifications([item('6', iso(0))], nameOf, 7, { 6: todayText }, now);
check('6 今天到期但已提醒不重复', todayNotified.notifications.length === 0);

const perItem = planExpiryNotifications(
  [item('7', iso(0)), item('8', iso(0))],
  nameOf,
  7,
  { 7: todayText },
  now,
);
check(
  '7 一个商品今天提醒过，不影响另一个商品的首次提醒',
  perItem.notifications.length === 1 && perItem.notifications[0].id === planExpiryNotifications([item('8', iso(0))], nameOf, 7, undefined, now).notifications[0].id,
  JSON.stringify(perItem.notifications),
);

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
