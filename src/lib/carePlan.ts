import type { DewormingPlan, Pet, Settings, Vaccination } from '../types';
import { dewormLabel, vaccineKindLabel, vaccineReminderSlots, vaccineSchedule } from './care';
import { notificationId, type PlannedNotification } from './notificationPlan';

function localToday(now: number): string {
  const date = new Date(now);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function atNine(date: string): number {
  return new Date(`${date}T09:00:00`).getTime();
}

export type CareNotificationPlan = {
  notifications: PlannedNotification[];
  notified: Record<string, string>;
};

/**
 * 疫苗和驱虫共用同一套排程：到期日 09:00 以及之后第 8/15/22 天补提醒。
 * due 早于该提醒开关的 enabledAt 时整条日程静默，只由档案页显示逾期。
 */
export function planCareNotifications(
  pets: Pet[],
  vaccinations: Vaccination[],
  dewormings: DewormingPlan[],
  settings: Settings,
  notified: Record<string, string> | undefined,
  now = Date.now(),
): CareNotificationPlan {
  const reminders = settings.reminders;
  if (!reminders) return { notifications: [], notified: { ...(notified ?? {}) } };
  const today = localToday(now);
  const output: PlannedNotification[] = [];
  const nextNotified = { ...(notified ?? {}) };
  const petMap = new Map(pets.map((pet) => [pet.id, pet]));

  const pushSlot = (params: {
    seed: string;
    title: string;
    body: string;
    date: string;
    enabledAt: number;
  }) => {
    const plannedAt = atNine(params.date);
    if (!Number.isFinite(plannedAt) || plannedAt < params.enabledAt) return;
    const isToday = params.date === today;
    const immediate = plannedAt <= now + 5_000;
    if (immediate && (!isToday || nextNotified[params.seed] === today)) return;
    if (immediate && !isToday) return;
    const at = immediate ? now + 15_000 : plannedAt;
    if (immediate) nextNotified[params.seed] = today;
    output.push({
      id: notificationId(params.seed),
      title: params.title,
      body: params.body,
      at,
      immediate,
    });
  };

  if (reminders.vaccineEnabled) {
    const enabledAt = reminders.enabledAt.vaccine ?? 0;
    for (const pet of pets) {
      const records = vaccinations.filter((record) => record.petId === pet.id && record.confirmed);
      for (const schedule of vaccineSchedule(records)) {
        const dueAt = atNine(schedule.dueDate);
        if (dueAt < enabledAt) continue;
        for (const slot of vaccineReminderSlots(schedule)) {
          const seed = `vaccine:${pet.id}:${schedule.kind}:${slot.role}:${slot.missIndex ?? 0}`;
          const label = vaccineKindLabel(schedule.kind);
          const title = `${pet.name} 的${label}提醒`;
          const body =
            slot.role === 'before'
              ? `${schedule.dueDate} 该打年度加强针，提早约医院`
              : slot.role === 'due'
                ? `今天该打年度加强针（${schedule.dueDate}），约医院吧`
                : `年度加强针已逾期，这是本周补提醒（${slot.label}）`;
          pushSlot({ seed, title, body, date: slot.date, enabledAt });
        }
      }
    }
  }

  if (reminders.dewormEnabled) {
    const enabledAt = reminders.enabledAt.deworm ?? 0;
    for (const plan of dewormings) {
      const pet = petMap.get(plan.petId);
      if (!pet) continue;
      const dueAt = atNine(plan.nextDate);
      if (dueAt < enabledAt) continue;
      const label = dewormLabel(plan.type);
      const dates = [plan.nextDate];
      for (let index = 1; index <= 3; index += 1) {
        const date = new Date(`${plan.nextDate}T00:00:00`);
        date.setDate(date.getDate() + index * 7);
        dates.push(date.toISOString().slice(0, 10));
      }
      dates.forEach((date, index) => {
        const seed = `deworm:${pet.id}:${plan.type}:${index}`;
        pushSlot({
          seed,
          title: `${pet.name} 该做${label}驱虫啦`,
          body:
            index === 0
              ? `计划日期 ${plan.nextDate}，完成后记得在驱虫日历里点「已完成」`
              : `驱虫已逾期，这是第 ${index + 1} 次周提醒`,
          date,
          enabledAt,
        });
      });
    }
  }

  return { notifications: output, notified: nextNotified };
}

