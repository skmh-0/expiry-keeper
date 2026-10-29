import type {
  DewormingPlan,
  DewormingType,
  Pet,
  ReminderSettings,
  Settings,
  Vaccination,
  VaccineKind,
} from '../types';
import { diffDays, isValidIso, shiftDays, shiftMonths, todayIso } from './shelfLife';
import { petAgeMonths } from './pets';

export const REMINDER_DEFAULTS: ReminderSettings = {
  expiryEnabled: true,
  vaccineEnabled: true,
  dewormEnabled: true,
  enabledAt: {},
};

export function reminderSettings(settings: Settings, now = Date.now()): ReminderSettings {
  if (settings.reminders) return settings.reminders;
  return {
    expiryEnabled: settings.remindEnabled,
    vaccineEnabled: false,
    dewormEnabled: false,
    enabledAt: {
      expiry: settings.remindEnabled ? now : undefined,
      vaccine: now,
      deworm: now,
    },
  };
}

export function vaccineKindOf(name: string): VaccineKind {
  if (/狂犬/.test(name)) return 'rabies';
  if (/三联|四联|五联|六联|七联|八联|妙三多|卫佳|联苗/.test(name)) return 'combo';
  return 'other';
}

export function vaccineKindLabel(kind: VaccineKind | undefined): string {
  if (kind === 'rabies') return '狂犬';
  if (kind === 'combo') return '联苗';
  return '疫苗';
}

export type VaccineScheduleItem = {
  kind: VaccineKind;
  name: string;
  dueDate: string;
  recordId?: string;
  source: 'record' | 'first';
};

function recordDueDate(record: Vaccination): string | undefined {
  if (isValidIso(record.nextDate)) return record.nextDate;
  if (!isValidIso(record.doseDate)) return undefined;
  return shiftMonths(record.doseDate, 12);
}

/** 每种疫苗只取最后一针，生成下一次年度加强日期。 */
export function vaccineSchedule(records: Vaccination[]): VaccineScheduleItem[] {
  const latest = new Map<VaccineKind, Vaccination>();
  for (const record of records) {
    if (!record.confirmed || !isValidIso(record.doseDate)) continue;
    const kind = record.vaccineKind ?? vaccineKindOf(record.vaccineName);
    if (kind === 'other') continue;
    const previous = latest.get(kind);
    if (!previous || record.doseDate > previous.doseDate) latest.set(kind, record);
  }
  const output: VaccineScheduleItem[] = [];
  for (const [kind, record] of latest) {
    const dueDate = recordDueDate(record);
    if (!dueDate) continue;
    output.push({
      kind,
      name: record.vaccineName,
      dueDate,
      recordId: record.id,
      source: 'record',
    });
  }
  return output.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

/** 没有任何接种记录时，仅展示首免建议，不进入通知。 */
export function firstVaccineSchedule(pet: Pet): { label: string; date: string }[] {
  if (!isValidIso(pet.birthDate)) return [];
  const first = shiftDays(pet.birthDate, pet.species === 'dog' ? 42 : 49);
  const second = shiftDays(first, 21);
  const third = shiftDays(second, 21);
  // 狂犬首免按第三针联苗完成后再间隔一个月，而不是直接按出生满三月计算。
  const rabies = shiftMonths(third, 1);
  return [
    { label: '首针联苗', date: first },
    { label: '第二针联苗', date: second },
    { label: '第三针联苗', date: third },
    { label: '狂犬疫苗', date: rabies },
  ];
}

export type VaccineBadge = {
  state: 'none' | 'upcoming' | 'overdue';
  text: string;
  dueDate?: string;
  days?: number;
};

export function vaccineBadge(records: Vaccination[], today = todayIso()): VaccineBadge {
  const schedule = vaccineSchedule(records);
  if (!schedule.length) return { state: 'none', text: '无记录' };
  const next = schedule[0];
  const days = diffDays(today, next.dueDate);
  if (days < 0) return { state: 'overdue', text: '已逾期', dueDate: next.dueDate, days };
  return {
    state: 'upcoming',
    text: days === 0 ? '今天加强' : `下次加强 ${days} 天后`,
    dueDate: next.dueDate,
    days,
  };
}

export type VaccineReminderSlot = {
  label: string;
  date: string;
  role: 'before' | 'due' | 'miss';
  missIndex?: number;
};

/** 联苗提前 7 天、狂犬提前 14 天；当天一次；错过后的第 8/15/22 天各补一次。 */
export function vaccineReminderSlots(item: VaccineScheduleItem): VaccineReminderSlot[] {
  const beforeDays = item.kind === 'rabies' ? 14 : 7;
  const slots: VaccineReminderSlot[] = [
    { label: `提前 ${beforeDays} 天`, date: shiftDays(item.dueDate, -beforeDays), role: 'before' },
    { label: '当天', date: item.dueDate, role: 'due' },
  ];
  for (let index = 1; index <= 3; index += 1) {
    slots.push({
      label: `第 ${index * 7 + 1} 天补提醒`,
      date: shiftDays(item.dueDate, index * 7),
      role: 'miss',
      missIndex: index,
    });
  }
  return slots;
}

export function weeklyMissCount(dueDate: string, today = todayIso()): number {
  if (!isValidIso(dueDate)) return 0;
  const elapsed = diffDays(dueDate, today);
  if (elapsed < 0) return 0;
  return Math.min(4, Math.floor(elapsed / 7) + 1);
}

/** 体内：6 月龄以下 30 天、成年 90 天；体外固定 30 天。 */
export function dewormIntervalDays(
  pet: Pet,
  type: DewormingType,
  onDate = todayIso(),
): number {
  if (type === 'external') return 30;
  const months = petAgeMonths(pet, onDate);
  return months !== undefined && months < 6 ? 30 : 90;
}

export function dewormNextDate(
  pet: Pet,
  type: DewormingType,
  lastDate: string,
): string {
  return shiftDays(lastDate, dewormIntervalDays(pet, type, lastDate));
}

export function dewormLabel(type: DewormingType): string {
  return type === 'internal' ? '体内' : '体外';
}

export function dewormingBadge(plan: DewormingPlan | undefined, today = todayIso()): string {
  if (!plan) return '无记录';
  const days = diffDays(today, plan.nextDate);
  if (days < 0) return '已逾期';
  return days === 0 ? '今天驱虫' : `${days} 天后`;
}

