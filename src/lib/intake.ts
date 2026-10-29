import type { FeedingLog } from '../types';
import { shiftDays, todayIso } from './shelfLife';

export type IntakeDay = {
  date: string;
  grams: number;
  logged: boolean;
  /** 占推荐量的比例 */
  ratio?: number;
};

export type IntakeSummary = {
  days: IntakeDay[];
  total: number;
  avg: number;
  recommended?: number;
  /** 连续超过推荐 110% 的天数（从今天往前数） */
  overStreak: number;
  warning: boolean;
};

export function dailyIntake(
  feedings: FeedingLog[],
  petId: string | undefined,
  recommendedGrams: number | undefined,
  windowDays = 7,
  today = todayIso(),
): IntakeSummary {
  const days: IntakeDay[] = [];
  let total = 0;
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = shiftDays(today, -offset);
    const entries = feedings.filter(
      (feeding) => feeding.date === date && (petId === undefined || feeding.petId === petId),
    );
    const grams = Math.round(entries.reduce((sum, feeding) => sum + feeding.grams, 0) * 10) / 10;
    total += grams;
    days.push({
      date,
      grams,
      logged: entries.length > 0,
      ratio: recommendedGrams ? grams / recommendedGrams : undefined,
    });
  }
  // 从今天往前数连续超 110% 的天数
  let overStreak = 0;
  if (recommendedGrams && recommendedGrams > 0) {
    for (let index = days.length - 1; index >= 0; index -= 1) {
      const day = days[index];
      if (day.logged && day.grams > recommendedGrams * 1.1) overStreak += 1;
      else break;
    }
  }
  return {
    days,
    total: Math.round(total * 10) / 10,
    avg: Math.round((total / windowDays) * 10) / 10,
    recommended: recommendedGrams,
    overStreak,
    warning: overStreak >= 7,
  };
}
