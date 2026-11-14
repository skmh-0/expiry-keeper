import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Building2,
  Cloud,
  Download,
  Code2,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { useStore } from '../lib/store';
import type { Updater } from '../lib/useUpdater';
import { isEngineConfigured, verifyApiKey } from '../lib/engine';
import {
  batteryOptimizationStatus,
  exactAlarmStatus,
  isNative,
  notificationPermissionState,
  openExactAlarmSettings,
  openNotificationSettings,
  requestBatteryOptimizationExemption,
  sendTestNotification,
} from '../lib/native';
import { APP_VERSION } from '../version';
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_VISION_MODEL,
  DEFAULT_PRODUCT_API_URL,
  DEFAULT_UPDATE_SOURCE,
} from '../lib/config';
import { Chip, Field, Notice, Segmented, Stepper, TextInput, Toggle } from '../components/ui';
import type { ReminderKind, ReminderSettings, VerifyMode } from '../types';
import { MakerSheet } from '../components/MakerSheet';
import { clearState, writeMirror, writeState } from '../lib/storage';
import { writeSecureKey } from '../lib/secureKey';

export function SettingsScreen({ updater, onOpenLibrary }: { updater: Updater; onOpenLibrary: () => void }) {
  const {
    settings,
    updateSettings,
    skus,
    items,
    makers,
    addMaker,
    removeMaker,
    restoreMakers,
    wipe,
    pets,
    feedings,
    vaccinations,
    dewormings,
    activePetId,
  } = useStore();
  const importRef = useRef<HTMLInputElement | null>(null);
  const keyRef = useRef<HTMLInputElement | null>(null);
  const configured = isEngineConfigured(settings);
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [verify, setVerify] = useState<{ busy: boolean; message?: { text: string; tone: 'ok' | 'warn' | 'error' } }>({
    busy: false,
  });
  const [makerOpen, setMakerOpen] = useState(false);
  const [notify, setNotify] = useState<{
    permission: 'granted' | 'denied' | 'prompt' | 'unknown';
    exact?: boolean;
    battery?: boolean;
    busy?: boolean;
    message?: { text: string; tone: 'ok' | 'warn' | 'error' };
  }>({ permission: 'unknown' });
  const hasKey = Boolean(draftKey.trim()) || configured;
  const reminders: ReminderSettings = settings.reminders ?? {
    expiryEnabled: settings.remindEnabled,
    vaccineEnabled: false,
    dewormEnabled: false,
    enabledAt: {},
  };
  /** 记下最新的设置值，卸载时保存 Key 用 */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const keySaveTimer = useRef<number | null>(null);

  const setReminder = (kind: ReminderKind, enabled: boolean) => {
    const key =
      kind === 'expiry' ? 'expiryEnabled' : kind === 'vaccine' ? 'vaccineEnabled' : 'dewormEnabled';
    const enabledAt = { ...reminders.enabledAt };
    if (enabled) enabledAt[kind] = Date.now();
    else delete enabledAt[kind];
    updateSettings({
      reminders: { ...reminders, [key]: enabled, enabledAt },
      ...(kind === 'expiry' ? { remindEnabled: enabled } : {}),
    });
  };

  /** 直接以输入框里的实际内容为准：部分输入法粘贴时不会触发 React 的 change 事件。 */
  const syncKey = (value: string) => {
    setDraftKey(value);
    if (value !== settings.apiKey) updateSettings({ apiKey: value });
  };

  /** 以输入框里的实际内容为准存 Key：粘贴、失焦、离开设置页都会保存，不用二次输入。 */
  const persistKey = () => {
    if (keySaveTimer.current !== null) {
      window.clearTimeout(keySaveTimer.current);
      keySaveTimer.current = null;
    }
    const value = (keyRef.current?.value ?? '').trim();
    if (value && value !== settingsRef.current.apiKey) {
      setDraftKey(value);
      updateSettings({ apiKey: value });
    }
  };

  useEffect(() => {
    // 离开设置页（切到扫码/库存等）时再兜一次，避免粘贴完没失焦就切走了
    return () => {
      const value = (keyRef.current?.value ?? '').trim();
      if (value && value !== settingsRef.current.apiKey) updateSettings({ apiKey: value });
    };
  }, [updateSettings]);

  /** 刷新通知权限、精确闹钟、电池优化三个状态 */
  const refreshNotifyStatus = async () => {
    if (!isNative()) return;
    const [permission, exact, battery] = await Promise.all([
      notificationPermissionState(),
      exactAlarmStatus(),
      batteryOptimizationStatus(),
    ]);
    setNotify((current) => ({ ...current, permission, exact, battery }));
  };

  useEffect(() => {
    void refreshNotifyStatus();
  }, []);

  const runNotificationTest = async () => {
    setNotify((current) => ({ ...current, busy: true, message: undefined }));
    try {
      await sendTestNotification();
      setNotify((current) => ({
        ...current,
        busy: false,
        permission: 'granted',
        message: { text: '测试通知已排好，5 秒后锁屏查看', tone: 'ok' },
      }));
    } catch (error) {
      setNotify((current) => ({
        ...current,
        busy: false,
        message: { text: error instanceof Error ? error.message : '测试通知失败', tone: 'error' },
      }));
      await refreshNotifyStatus();
    }
  };

  const runVerify = async () => {
    const key = (keyRef.current?.value ?? draftKey).trim();
    if (!key) {
      setVerify({ busy: false, message: { text: '请先粘贴 DeepSeek API Key', tone: 'warn' } });
      return;
    }
    syncKey(key);
    setVerify({ busy: true });
    try {
      const echo = await verifyApiKey(key);
      setVerify({ busy: false, message: { text: `连接正常，模型回包：${echo}`, tone: 'ok' } });
    } catch (error) {
      setVerify({
        busy: false,
        message: { text: error instanceof Error ? error.message : '验证失败', tone: 'error' },
      });
    }
  };

  const exportJson = () => {
    // 导出文件里绝不能带 API Key；所有照片 ID 也剥掉，备份不包含头像和疫苗本图片
    const exportedPets = pets.map((pet) => {
      const copy = { ...pet };
      delete copy.avatarPhotoId;
      return copy;
    });
    const exportedVaccinations = vaccinations.map((record) => {
      const copy = { ...record };
      delete copy.photoId;
      return copy;
    });
    const exportedItems = items.map((item) => {
      const copy = { ...item };
      delete copy.photo;
      delete copy.photoId;
      return copy;
    });
    const payload = JSON.stringify(
      {
        schema: 6,
        skus,
        items: exportedItems,
        settings: { ...settings, apiKey: '', productApiSecret: '' },
        makers,
        pets: exportedPets,
        feedings,
        vaccinations: exportedVaccinations,
        dewormings,
        activePetId,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `expiry-keeper-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as {
        skus?: unknown;
        items?: unknown;
        settings?: { apiKey?: string; productApiSecret?: string } & Record<string, unknown>;
        makers?: unknown;
        pets?: unknown;
        feedings?: unknown;
        vaccinations?: unknown;
        dewormings?: unknown;
      };
      const legacyKey = typeof parsed.settings?.apiKey === 'string' ? parsed.settings.apiKey.trim() : '';
      const legacyProductSecret =
        typeof parsed.settings?.productApiSecret === 'string'
          ? parsed.settings.productApiSecret.trim()
          : '';
      if (legacyKey) await writeSecureKey(legacyKey, 'apiKey');
      if (legacyProductSecret) await writeSecureKey(legacyProductSecret, 'productHmac');
      if (parsed.settings) {
        parsed.settings = { ...parsed.settings, apiKey: '', productApiSecret: '' };
      }
      // 数据以 IndexedDB 为准：备份直接写进数据库，再重启界面
      const ok = await writeState(parsed);
      if (!ok) {
        // 数据库写不进去就退回镜像：先清空数据库里的旧数据，免得启动时它又盖回来
        await clearState();
        writeMirror(parsed);
      }
      window.location.reload();
    } catch {
      window.alert('导入失败：不是有效的备份文件');
    }
  };

  const storageKb = Math.round(
    new Blob([JSON.stringify({ skus, items, pets, feedings, vaccinations, dewormings })]).size / 1024,
  );

  // 手机给应用多少空间、已经用掉多少（照片是大头）
  const [capacity, setCapacity] = useState<{ usage: number; quota: number }>();
  useEffect(() => {
    const estimate = navigator.storage?.estimate;
    if (typeof estimate !== 'function') return;
    let cancelled = false;
    void navigator.storage.estimate().then((result) => {
      if (cancelled) return;
      setCapacity({ usage: Number(result.usage ?? 0), quota: Number(result.quota ?? 0) });
    });
    return () => {
      cancelled = true;
    };
  }, [items.length, skus.length]);

  return (
    <div className="screen">
      <h3 className="section-title">识别引擎</h3>
      <div className="card">
        <div className="row-between">
          <span className="small">DeepSeek 视觉识别</span>
          <Chip tone={hasKey ? 'ok' : 'warn'}>{hasKey ? '已配置' : '未配置'}</Chip>
        </div>
        <div className="row-between">
          <span className="muted small">接口地址</span>
          <span className="muted small">{DEEPSEEK_BASE_URL}</span>
        </div>
        <div className="row-between">
          <span className="muted small">识别模型</span>
          <span className="muted small">{DEEPSEEK_VISION_MODEL}</span>
        </div>
        <Field label="API Key" hint="只保存在本机，背标照片由手机直接发往 DeepSeek">
          <TextInput
            ref={keyRef}
            type="password"
            // 绑上已保存的 Key：应用启动时数据是异步读出来的，输入框要跟着回填，
            // 否则看起来像「没保存、要重新输入」
            value={settings.apiKey}
            placeholder="粘贴 DeepSeek API Key"
            onChange={(event) => syncKey(event.target.value)}
            // 粘贴后即使输入法不触发 change，输入事件和离开页面也会把 Key 存下来
            onInput={() => {
              if (keySaveTimer.current !== null) window.clearTimeout(keySaveTimer.current);
              keySaveTimer.current = window.setTimeout(persistKey, 400);
            }}
            onBlur={persistKey}
          />
        </Field>
        <button type="button" className="btn btn-outline btn-block" disabled={verify.busy} onClick={() => void runVerify()}>
          <RefreshCw size={16} />
          {verify.busy ? '正在验证…' : '验证 API Key'}
        </button>
        {verify.message ? <Notice level={verify.message.tone}>{verify.message.text}</Notice> : null}
        {hasKey ? (
          <Notice level="warn">背标照片会上传到 DeepSeek 解析，不经过其它服务。</Notice>
        ) : (
          <Notice level="warn">未填写 Key 时不会生成任何商品信息，扫码只记录条码，其余字段需要手工填写。</Notice>
        )}
      </div>

      <h3 className="section-title">商品查询库</h3>
      <div className="card">
        <div className="row-between">
          <span className="small inline">
            <Cloud size={15} />
            扫码优先查库
          </span>
          <Chip tone={settings.productApiUrl?.trim() && settings.productApiSecret.trim() ? 'ok' : 'warn'}>
            {settings.productApiUrl?.trim() && settings.productApiSecret.trim() ? '已配置' : '未配置'}
          </Chip>
        </div>
        <Field
          label="查询库地址"
          hint="填写你部署的商品查询库地址；留空或未配置签名密钥时跳过查库。"
        >
          <TextInput
            value={settings.productApiUrl ?? ''}
            placeholder={DEFAULT_PRODUCT_API_URL || 'http://服务器地址:5280'}
            inputMode="url"
            onChange={(event) => updateSettings({ productApiUrl: event.target.value.trim() })}
            onBlur={(event) => updateSettings({ productApiUrl: event.currentTarget.value.trim() })}
          />
        </Field>
        <Field
          label="签名密钥"
          hint="必须与服务端 HMAC_SECRET 一致；只保存在本机 Keystore，不进入 APK、快照或备份。"
        >
          <TextInput
            type="password"
            value={settings.productApiSecret}
            placeholder="输入 64 位 HMAC 密钥"
            autoComplete="off"
            onChange={(event) => updateSettings({ productApiSecret: event.target.value.trim() })}
            onBlur={(event) => updateSettings({ productApiSecret: event.currentTarget.value.trim() })}
          />
        </Field>
        <Notice level="warn">
          请求使用 HMAC 签名和每分钟 60 次限流。后台只接收纯文本商品字段，不接收照片、DeepSeek API Key 或签名密钥。
        </Notice>
      </div>

      <h3 className="section-title">识别精度</h3>
      <div className="card">
        <p className="block-label">复验档位</p>
        <Segmented<VerifyMode>
          value={settings.verifyMode ?? 'always'}
          onChange={(verifyMode) => updateSettings({ verifyMode })}
          options={[
            { value: 'always', label: '每次都复验' },
            { value: 'auto', label: '按需复验' },
            { value: 'off', label: '不复验' },
          ]}
        />
        <Notice level="warn">
          每次都复验（默认，精度最高）：第一遍读完，再拿放大后的局部图把关键字重读一遍，两次对不上的地方按「有原文依据」为准。每次录入两次调用，等待也会长一点。
        </Notice>
        <Notice level="warn">
          按需复验：只在有字段把握不足、或者日期和保质期对不上时才发第二次请求，大多数正常照片只调用一次，省钱但偶尔会漏掉「看起来很有把握其实读错了」的字段。
        </Notice>
        <Notice level="warn">
          不复验：只跑第一遍，最省但最容易读错小字和喷码。
        </Notice>
        <Notice level="warn">
          复验只认「有原文依据」的修改：模型说不出这行字是从图上哪儿抄来的，这一项就不会被改，只会标成待核对。
        </Notice>
      </div>

      <h3 className="section-title">提醒中心</h3>
      <div className="card">
        <Toggle
          label="过期与临期"
          hint="商品到期、临期和保质期过半提醒"
          checked={reminders.expiryEnabled}
          onChange={async (next) => {
            if (next && 'Notification' in window && Notification.permission === 'default') {
              await Notification.requestPermission();
            }
            setReminder('expiry', next);
          }}
        />
        <Toggle
          label="疫苗提醒"
          hint="联苗提前 7 天、狂犬提前 14 天，当天再提醒一次"
          checked={reminders.vaccineEnabled}
          onChange={(next) => setReminder('vaccine', next)}
        />
        <Toggle
          label="驱虫提醒"
          hint="体内外驱虫到点提醒，错过时每周补一次，最多 4 次"
          checked={reminders.dewormEnabled}
          onChange={(next) => setReminder('deworm', next)}
        />
        <Notice level="warn">
          关闭期间错过的日程不会补提醒，只会在对应档案里静默显示逾期；重新打开后只安排未来日程。
        </Notice>
        <div className="row-between">
          <span className="small">提前提醒天数</span>
          <Stepper value={settings.remindDays} min={1} max={90} suffix="天" onChange={(remindDays) => updateSettings({ remindDays })} />
        </div>
        {isNative() ? (
          <>
            <div className="row-between">
              <span className="small">通知权限</span>
              <span className="muted small">
                {notify.permission === 'granted'
                  ? '已允许'
                  : notify.permission === 'denied'
                    ? '被系统关闭'
                    : notify.permission === 'prompt'
                      ? '尚未询问'
                      : '未知'}
              </span>
            </div>
            <div className="row-between">
              <span className="small">精确闹钟</span>
              <span className="muted small">
                {notify.exact === undefined ? '未知' : notify.exact ? '已允许' : '未允许（会延迟）'}
              </span>
            </div>
            <div className="row-between">
              <span className="small">电池优化白名单</span>
              <span className="muted small">
                {notify.battery === undefined ? '未知' : notify.battery ? '已加入' : '未加入（iQOO 可能收不到）'}
              </span>
            </div>
            <div className="action-row">
              <button type="button" className="btn btn-outline btn-sm" disabled={notify.busy} onClick={() => void runNotificationTest()}>
                {notify.busy ? '正在发送…' : '测试通知（5 秒后）'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  void openNotificationSettings();
                }}
              >
                通知设置
              </button>
            </div>
            {!notify.battery ? (
              <button
                type="button"
                className="btn btn-ghost btn-block btn-sm"
                onClick={() => {
                  void requestBatteryOptimizationExemption();
                }}
              >
                允许后台运行（关闭电池优化）
              </button>
            ) : null}
            {notify.exact === false ? (
              <button
                type="button"
                className="btn btn-ghost btn-block btn-sm"
                onClick={() => {
                  void openExactAlarmSettings();
                }}
              >
                允许精确闹钟（Android 12+）
              </button>
            ) : null}
            {notify.message ? <Notice level={notify.message.tone}>{notify.message.text}</Notice> : null}
            <Notice level="warn">
              iQOO / OriginOS 还需要：①「通知设置 → 提醒方式 → 锁屏通知」勾选；②「i管家 → 应用管理 → 自启动」允许本应用；③电池设置为「不优化」。这三步系统不允许应用代劳。
            </Notice>
          </>
        ) : null}
      </div>

      <h3 className="section-title">应用更新</h3>
      <div className="card">
        <div className="row-between">
          <span className="small">当前版本</span>
          <span className="muted small">
            {updater.currentVersion}
            {updater.activeVersion ? ' · 已热更新' : ' · 内置资源'}
          </span>
        </div>
        <div className="row-between">
          <span className="small">运行环境</span>
          <span className="muted small">{updater.native ? 'Android 应用' : '浏览器'}</span>
        </div>
        <Field
          label="更新源"
          hint={
            DEFAULT_UPDATE_SOURCE
              ? `内置默认地址是 ${DEFAULT_UPDATE_SOURCE}；服务器地址变了就点「用默认」换回来`
              : '留空 = 自动扫描同一局域网里 5276 端口的更新服务；也可以手动填电脑地址'
          }
        >
          <div className="inline">
            <TextInput
              value={updater.source}
              placeholder={DEFAULT_UPDATE_SOURCE}
              onChange={(event) => updater.setSource(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                updater.setSource(DEFAULT_UPDATE_SOURCE);
                void updater.check(true);
              }}
            >
              {DEFAULT_UPDATE_SOURCE ? '用默认' : '自动发现'}
            </button>
          </div>
        </Field>
        <div className="action-row">
          <button type="button" className="btn btn-outline" disabled={updater.busy} onClick={() => void updater.check(true)}>
            <RefreshCw size={16} />
            检查更新
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!updater.outdated || updater.busy}
            onClick={() => void updater.install()}
          >
            <Download size={16} />
            安装 {updater.outdated ? updater.manifest?.version : ''}
          </button>
        </div>
        {updater.message ? <Notice level={updater.message.tone}>{updater.message.text}</Notice> : null}
        {updater.activeVersion ? (
          <button type="button" className="btn btn-ghost btn-block" disabled={updater.busy} onClick={() => void updater.rollback()}>
            <RotateCcw size={16} />
            回滚到内置版本
          </button>
        ) : null}
        {!updater.native ? <Notice level="warn">热更新只在 Android 应用内生效，浏览器里直接刷新页面即可。</Notice> : null}
      </div>

      <h3 className="section-title">商品档案库</h3>
      <div className="card">
        <div className="row-between">
          <span className="small">已建档商品</span>
          <span className="muted small">{skus.length} 个</span>
        </div>
        <button type="button" className="btn btn-outline btn-block" onClick={onOpenLibrary}>
          <BookOpen size={16} />
          打开商品档案库
        </button>
        <Notice level="warn">档案按条码复用：同款商品第二次录入会自动带出品牌、厂家、配料与保质期。</Notice>
      </div>

      <h3 className="section-title">常用厂家</h3>
      <div className="card">
        <div className="row-between">
          <span className="small">名单里的厂家</span>
          <span className="muted small">{makers.length} 家</span>
        </div>
        <button type="button" className="btn btn-outline btn-block" onClick={() => setMakerOpen(true)}>
          <Building2 size={16} />
          管理常用厂家
        </button>
        <Notice level="warn">识别后可从名单一键填入生产厂家，也可以自己增删。</Notice>
      </div>

      <h3 className="section-title">数据</h3>
      <div className="card">
        <div className="row-between">
          <span className="small">本地记录</span>
          <span className="muted small">
            {skus.length} 个档案 · {items.length} 条库存 · 约 {storageKb} KB
          </span>
        </div>
        {capacity?.quota ? (
          <>
            <div className="row-between">
              <span className="small">可用空间</span>
              <span className="muted small">
                {(capacity.usage / 1024 / 1024).toFixed(1)} MB / {(capacity.quota / 1024 / 1024).toFixed(0)} MB
              </span>
            </div>
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${Math.min(100, Math.max(0.5, (capacity.usage / capacity.quota) * 100))}%` }}
              />
            </div>
            <p className="muted tiny">
              记录和背标照片都算在这里，照片是大头（一条带照片约 0.3MB）。这份额度跟着手机剩余空间走，用满了再加照片会写不进去。
            </p>
          </>
        ) : null}
        <div className="action-row">
          <button type="button" className="btn btn-outline" onClick={exportJson}>
            <Download size={16} />
            导出备份
          </button>
          <button type="button" className="btn btn-outline" onClick={() => importRef.current?.click()}>
            <Upload size={16} />
            导入备份
          </button>
        </div>
        <button type="button" className="btn btn-danger btn-block" onClick={wipe}>
          清空全部数据
        </button>
        <Notice level="warn">
          背标照片存在本机浏览器数据库里，不占记录的空间，导出备份里也只有记录、不含照片；清空浏览器数据或卸载应用会一起丢失。
        </Notice>
      </div>

      <h3 className="section-title">关于</h3>
      <div className="card">
        <div className="thumb-row">
          <img className="thumb" src="/icon-round.png" alt="效期管家应用图标" />
          <div className="thumb-text">
            <p className="block-label">效期管家</p>
            <p className="muted tiny">给猫猫囤粮的人做的保质期台账</p>
          </div>
        </div>
        <div className="row-between">
          <span className="small">版本</span>
          <span className="muted small">{APP_VERSION}</span>
        </div>
        <div className="row-between">
          <span className="small">数据存储</span>
          <span className="muted small">本机保存 · 不上传开发者服务器</span>
        </div>
        <div className="action-row about-links">
          <a
            className="btn btn-outline"
            href="https://github.com/skmh-0/expiry-keeper"
            rel="noreferrer"
            target="_blank"
          >
            <Code2 size={16} />
            开源地址
          </a>
          <a
            className="btn btn-outline"
            href="https://github.com/skmh-0/expiry-keeper/issues/new"
            rel="noreferrer"
            target="_blank"
          >
            <MessageCircle size={16} />
            问题反馈
          </a>
        </div>
        <p className="disclaimer">
          照片保存在本机；启用 AI 识别时，照片由手机直接发送到用户自行配置的 DeepSeek API。开发者的商品库服务只接收文本字段，不接收照片或 API Key。所有识别结果仅供记录与提醒，商品信息以包装实物标注为准。
        </p>
      </div>

      {makerOpen ? (
        <MakerSheet
          makers={makers}
          onAdd={addMaker}
          onRemove={removeMaker}
          onRestore={restoreMakers}
          onClose={() => setMakerOpen(false)}
        />
      ) : null}
    </div>
  );
}
