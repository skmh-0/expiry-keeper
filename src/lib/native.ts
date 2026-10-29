import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DewormingPlan, PantryItem, Pet, Settings, Vaccination } from '../types';
import { planCareNotifications } from './carePlan';
import { notificationId, planExpiryNotifications } from './notificationPlan';

export type UpdateManifest = {
  version: string;
  url: string;
  sha256: string;
  notes?: string;
  size?: number;
};

type BundleInfo = {
  activeVersion: string;
  previousVersion: string;
  sourceUrl: string;
  bundledVersion: string;
};

interface WebBundleUpdaterPlugin {
  getInfo(): Promise<BundleInfo>;
  setSource(options: { url: string }): Promise<void>;
  checkSource(options: { url: string }): Promise<UpdateManifest>;
  download(options: { url: string; version: string; sha256: string }): Promise<{ version: string; path: string }>;
  apply(options: { version: string }): Promise<{ version: string }>;
  confirmBoot(): Promise<void>;
  reset(): Promise<void>;
}

const WebBundleUpdater = registerPlugin<WebBundleUpdaterPlugin>('WebBundleUpdater');

type NotificationSupportPlugin = {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ opened: boolean }>;
  canScheduleExactAlarms(): Promise<{ allowed: boolean }>;
  openExactAlarmSettings(): Promise<{ opened: boolean }>;
  openNotificationSettings(): Promise<{ opened: boolean }>;
  openAppSettings(): Promise<{ opened: boolean }>;
};

const NotificationSupport = registerPlugin<NotificationSupportPlugin>('NotificationSupport');

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platformName = (): string => Capacitor.getPlatform();

export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#fbf8f2' });
  } catch {
    // 状态栏样式失败不影响主流程
  }
}

export type NativePhotoSource = 'camera' | 'photos';

export async function captureNativePhoto(source: NativePhotoSource = 'camera'): Promise<string | undefined> {
  if (!isNative()) return undefined;
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    resultType: CameraResultType.DataUrl,
    source: source === 'photos' ? CameraSource.Photos : CameraSource.Camera,
    quality: 72,
    width: 1600,
    correctOrientation: true,
    promptLabelHeader: source === 'photos' ? '从相册选择图片' : '拍摄图片',
    promptLabelPhoto: '从相册选择',
    promptLabelPicture: '拍照',
  });
  return photo.dataUrl ?? undefined;
}

/** Android 返回键：先关抽屉，再回扫码页，最后才退出应用。 */
export async function bindBackButton(handler: () => boolean): Promise<() => void> {
  if (!isNative()) return () => {};
  const { App } = await import('@capacitor/app');
  const listener = await App.addListener('backButton', () => {
    if (!handler()) void App.exitApp();
  });
  return () => void listener.remove();
}

export type NotificationSyncResult = {
  scheduled: number;
  /** 这次排了「现在就该提醒」的通知，调用方可以记下今天已提醒，避免重复 */
  immediate: boolean;
  /** 更新后的「商品 → 最后提醒日期」 */
  notified: Record<string, string>;
  permission: 'granted' | 'denied';
};

export type NotificationBundleSyncResult = NotificationSyncResult & {
  scheduledVaccine: number;
  scheduledDeworm: number;
};

async function ensureNotificationPermission(): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display === 'granted') return true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

/** 用系统级本地通知重排全部到期提醒：每条记录在「到期日 - 提前天数」的 09:00 触发。 */
export async function syncExpiryNotifications(
  items: PantryItem[],
  nameOf: (gtin: string) => string,
  remindDays: number,
  enabled: boolean,
  notified?: Record<string, string>,
): Promise<NotificationSyncResult> {
  if (!isNative()) return { scheduled: 0, immediate: false, notified: notified ?? {}, permission: 'granted' };
  const { LocalNotifications } = await import('@capacitor/local-notifications');

  const pending = await LocalNotifications.getPending();
  if (!enabled) {
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((item) => ({ id: item.id })) });
    }
    return { scheduled: 0, immediate: false, notified: notified ?? {}, permission: 'granted' };
  }

  if (!(await ensureNotificationPermission())) {
    return { scheduled: 0, immediate: false, notified: notified ?? {}, permission: 'denied' };
  }

  try {
    await LocalNotifications.createChannel({
      id: 'expiry',
      name: '到期提醒',
      description: '临期与过期提醒',
      importance: 4,
      visibility: 1,
    });
  } catch {
    // 渠道已存在时忽略
  }

  const plan = planExpiryNotifications(items, nameOf, remindDays, notified);
  // 只清掉已经不在库存里的商品，别把「刚排好、还没弹」的通知一起取消
  const liveIds = new Set(items.map((item) => notificationId(item.id)));
  const stale = pending.notifications.filter((entry) => !liveIds.has(entry.id));
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map((item) => ({ id: item.id })) });
  }
  const notifications = plan.notifications.map((entry) => ({
    id: entry.id,
    title: entry.title,
    body: entry.body,
    channelId: 'expiry',
    smallIcon: 'ic_stat_expiry',
    iconColor: '#1f6b4c',
    schedule: { at: new Date(entry.at), allowWhileIdle: true },
  }));

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
  return {
    scheduled: notifications.length,
    immediate: plan.immediate,
    notified: plan.notified,
    permission: 'granted',
  };
}

/**
 * 三类提醒统一重排。每次先取系统里本应用的 pending，再以当前数据重算，
 * 所以关闭某类开关会立即撤销该类待发通知，也不会在重开后补推关闭期间的历史。
 */
export async function syncAllNotifications(input: {
  items: PantryItem[];
  nameOf: (gtin: string) => string;
  pets: Pet[];
  vaccinations: Vaccination[];
  dewormings: DewormingPlan[];
  settings: Settings;
}): Promise<NotificationBundleSyncResult> {
  const notified = input.settings.notified ?? {};
  const reminders = input.settings.reminders;
  if (!isNative()) {
    return {
      scheduled: 0,
      scheduledVaccine: 0,
      scheduledDeworm: 0,
      immediate: false,
      notified,
      permission: 'granted',
    };
  }
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await LocalNotifications.getPending();
  const anyEnabled = Boolean(
    reminders?.expiryEnabled || reminders?.vaccineEnabled || reminders?.dewormEnabled,
  );
  if (!anyEnabled) {
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((item) => ({ id: item.id })),
      });
    }
    return {
      scheduled: 0,
      scheduledVaccine: 0,
      scheduledDeworm: 0,
      immediate: false,
      notified,
      permission: 'granted',
    };
  }
  if (!(await ensureNotificationPermission())) {
    return {
      scheduled: 0,
      scheduledVaccine: 0,
      scheduledDeworm: 0,
      immediate: false,
      notified,
      permission: 'denied',
    };
  }

  for (const channel of [
    { id: 'expiry', name: '到期提醒', description: '临期与过期提醒' },
    { id: 'vaccine', name: '疫苗提醒', description: '疫苗加强针提醒' },
    { id: 'deworm', name: '驱虫提醒', description: '体内外驱虫提醒' },
  ]) {
    await LocalNotifications.createChannel({
      ...channel,
      importance: 4,
      visibility: 1,
    }).catch(() => undefined);
  }

  const expiryPlan = reminders?.expiryEnabled
    ? planExpiryNotifications(
        input.items,
        input.nameOf,
        input.settings.remindDays,
        notified,
        Date.now(),
        reminders.enabledAt.expiry ?? 0,
      )
    : { notifications: [], immediate: false, notified };
  const carePlan = planCareNotifications(
    input.pets,
    input.vaccinations,
    input.dewormings,
    input.settings,
    expiryPlan.notified,
  );
  const all = [...expiryPlan.notifications, ...carePlan.notifications];
  if (pending.notifications.length) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((item) => ({ id: item.id })),
    });
  }
  if (all.length) {
    await LocalNotifications.schedule({
      notifications: all.map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: entry.body,
        channelId: entry.title.includes('驱虫')
          ? 'deworm'
          : entry.title.includes('疫苗') || entry.title.includes('加强') || entry.title.includes('联苗')
            ? 'vaccine'
            : 'expiry',
        smallIcon: 'ic_stat_expiry',
        iconColor: '#1f6b4c',
        schedule: { at: new Date(entry.at), allowWhileIdle: true },
      })),
    });
  }
  return {
    scheduled: expiryPlan.notifications.length,
    scheduledVaccine: carePlan.notifications.filter((entry) => !entry.title.includes('驱虫')).length,
    scheduledDeworm: carePlan.notifications.filter((entry) => entry.title.includes('驱虫')).length,
    immediate: expiryPlan.immediate || carePlan.notifications.some((entry) => entry.immediate),
    notified: carePlan.notified,
    permission: 'granted',
  };
}

export async function notificationPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!isNative()) return 'unknown';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display === 'granted') return 'granted';
    return permission.display === 'prompt' ? 'prompt' : 'denied';
  } catch {
    return 'unknown';
  }
}

export async function sendTestNotification(): Promise<void> {
  if (!isNative()) throw new Error('测试通知只在 Android 应用里可用');
  if (!(await ensureNotificationPermission())) throw new Error('通知权限没开，请到系统设置里允许通知');
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.createChannel({
    id: 'expiry',
    name: '到期提醒',
    description: '临期与过期提醒',
    importance: 4,
  }).catch(() => undefined);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 900001,
        title: '效期管家通知测试',
        body: '如果你在锁屏看到这条，到期提醒的通道是通的',
        channelId: 'expiry',
        smallIcon: 'ic_stat_expiry',
        iconColor: '#1f6b4c',
        schedule: { at: new Date(Date.now() + 5_000), allowWhileIdle: true },
      },
    ],
  });
}

export async function batteryOptimizationStatus(): Promise<boolean | undefined> {
  if (!isNative()) return undefined;
  try {
    const result = await NotificationSupport.isIgnoringBatteryOptimizations();
    return result.ignoring;
  } catch {
    return undefined;
  }
}

export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (!isNative()) return;
  await NotificationSupport.requestIgnoreBatteryOptimizations();
}

export async function exactAlarmStatus(): Promise<boolean | undefined> {
  if (!isNative()) return undefined;
  try {
    const result = await NotificationSupport.canScheduleExactAlarms();
    return result.allowed;
  } catch {
    return undefined;
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!isNative()) return;
  await NotificationSupport.openExactAlarmSettings();
}

export async function openNotificationSettings(): Promise<void> {
  if (!isNative()) return;
  await NotificationSupport.openNotificationSettings();
}

export async function openAppSettings(): Promise<void> {
  if (!isNative()) return;
  await NotificationSupport.openAppSettings();
}

export async function updaterInfo(): Promise<BundleInfo | undefined> {
  if (!isNative()) return undefined;
  return WebBundleUpdater.getInfo();
}

export async function updaterSetSource(url: string): Promise<void> {
  if (!isNative()) return;
  await WebBundleUpdater.setSource({ url });
}

export async function updaterCheck(url: string): Promise<UpdateManifest | undefined> {
  if (!isNative()) return undefined;
  return WebBundleUpdater.checkSource({ url });
}

export async function updaterDownload(manifest: UpdateManifest): Promise<{ version: string; path: string } | undefined> {
  if (!isNative()) return undefined;
  return WebBundleUpdater.download({ url: manifest.url, version: manifest.version, sha256: manifest.sha256 });
}

export async function updaterApply(version: string): Promise<void> {
  if (!isNative()) return;
  await WebBundleUpdater.apply({ version });
}

export async function updaterReset(): Promise<void> {
  if (!isNative()) return;
  await WebBundleUpdater.reset();
}

/** 启动成功后上报，让原生侧清掉待确认标记（否则下次启动会自动回滚）。 */
export async function confirmBoot(): Promise<void> {
  if (!isNative()) return;
  try {
    await WebBundleUpdater.confirmBoot();
  } catch (error) {
    // 上报失败会导致下次启动回滚一次，所以在控制台留痕便于排查
    console.warn('[updater] confirmBoot failed', error);
  }
}

export function compareVersion(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
