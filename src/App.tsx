import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Package, PawPrint, ScanLine, Settings as SettingsIcon, Utensils } from 'lucide-react';
import type { PantryItem, RecognizeOutcome, Sku } from './types';
import { StoreProvider, useStore } from './lib/store';
import { makeInternalGtin } from './lib/gtin';
import { bindBackButton, confirmBoot, initNativeShell, isNative, syncAllNotifications } from './lib/native';
import { useUpdater } from './lib/useUpdater';
import { daysUntil, isoFromTimestamp, statusOf, statusThresholds, todayIso } from './lib/shelfLife';
import { createEmptySku, refreshSku } from './lib/sku';
import { openedExpirySuggestion } from './lib/pets';
import { vaccineSchedule, weeklyMissCount } from './lib/care';
import { putPhoto } from './lib/storage';
import { contributeProduct } from './lib/productApi';
import { ScanScreen } from './screens/ScanScreen';
import { PantryScreen } from './screens/PantryScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { ConsumptionScreen } from './screens/ConsumptionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { PetScreen } from './screens/PetScreen';
import { Sheet } from './components/ui';
import { ReviewSheet } from './components/ReviewSheet';
import { ItemSheet } from './components/ItemSheet';
import { SkuSheet } from './components/SkuSheet';

type TabKey = 'scan' | 'pantry' | 'pets' | 'consume' | 'settings';

const TABS: { key: TabKey; label: string; icon: typeof ScanLine }[] = [
  { key: 'scan', label: '扫码', icon: ScanLine },
  { key: 'pantry', label: '库存', icon: Package },
  { key: 'pets', label: '宠物', icon: PawPrint },
  { key: 'consume', label: '消耗', icon: Utensils },
  { key: 'settings', label: '设置', icon: SettingsIcon },
];

const SUBTITLES: Record<TabKey, string> = {
  scan: '扫条码或拍背标，一次录全商品信息',
  pantry: '按到期日排序的在库记录',
  pets: '宠物档案、每日喂食量与投喂记录',
  consume: '按时间段看吃完用掉多少',
  settings: '识别引擎、提醒与本地数据',
};

type Toast = { text: string; tone: 'ok' | 'warn' | 'error' };

/**
 * 同款商品第二次录入：字段以已有档案为准（用户确认过的名字、厂家不能被模型重新覆盖），
 * 模型这次读到的内容只用来补档案里还空着的字段。
 */
function mergeWithArchive(fresh: Sku, archived: Sku): Sku {
  const keys = [
    'name',
    'brand',
    'manufacturer',
    'scCode',
    'standardCode',
    'storage',
    'shelfLifeText',
    'ingredientsRaw',
  ] as const;
  const fromArchive = (key: (typeof keys)[number]) => {
    const kept = (archived[key] ?? '').trim();
    return kept || fresh[key] || '';
  };
  // 值取自档案的字段不再挂「待核对」：那是用户已经确认过的内容
  const confidence = { ...fresh.confidence };
  for (const key of keys) {
    if (!(fresh[key] ?? '').trim() && (archived[key] ?? '').trim()) confidence[key] = 1;
  }
  return refreshSku({
    ...archived,
    ...fresh,
    name: fromArchive('name'),
    brand: fromArchive('brand'),
    iconLabel: fresh.iconLabel || archived.iconLabel,
    // 模型答「其他」时信息量不如档案里的干湿分类，这种情况仍用档案
    category: fresh.category && fresh.category !== 'other' ? fresh.category : archived.category ?? fresh.category,
    kind: fresh.kind ?? archived.kind,
    manufacturer: fromArchive('manufacturer'),
    scCode: fromArchive('scCode'),
    standardCode: fromArchive('standardCode'),
    ingredientsRaw: fromArchive('ingredientsRaw'),
    storage: fromArchive('storage'),
    shelfLifeText: fromArchive('shelfLifeText'),
    packageGrams: fresh.packageGrams ?? archived.packageGrams,
    nutrition: Object.values(fresh.nutrition ?? {}).some(Boolean) ? fresh.nutrition : archived.nutrition,
    confidence,
    createdAt: archived.createdAt,
    version: archived.version,
  });
}

function AppShell() {
  const {
    items,
    settings,
    storageFull,
    skuOf,
    saveSku,
    removeSku,
    addItem,
    updateItem,
    removeItem,
    updateSettings,
    pets,
    vaccinations,
    dewormings,
    updateVaccination,
    saveDeworming,
  } = useStore();
  const updater = useUpdater();
  const [tab, setTab] = useState<TabKey>('scan');
  const [review, setReview] = useState<{ outcome: RecognizeOutcome; photo?: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ sku: Sku; isNew: boolean } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const notifiedRef = useRef('');
  const itemNotifiedRef = useRef(settings.notified);
  itemNotifiedRef.current = settings.notified;

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'ok') => setToast({ text, tone }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const dueCount = useMemo(
    () =>
      items.filter((item) => {
        if (item.finishedAt) return false;
        const { soonDays, watchDays } = statusThresholds(skuOf(item.gtin)?.shelfLifeText);
        const status = statusOf(item.expiryDate, soonDays, watchDays);
        return status === 'expired' || status === 'soon';
      }).length,
    [items, skuOf],
  );

  useEffect(() => {
    void initNativeShell();
    void confirmBoot();
  }, []);

  useEffect(() => {
    const recordMap = new Map(vaccinations.map((record) => [record.id, record]));
    for (const schedule of vaccineSchedule(vaccinations)) {
      if (!schedule.recordId) continue;
      const record = recordMap.get(schedule.recordId);
      if (!record) continue;
      const missCount = weeklyMissCount(schedule.dueDate);
      if (missCount !== (record.missCount ?? 0)) {
        updateVaccination(record.id, { missCount });
      }
    }
    for (const plan of dewormings) {
      const missCount = weeklyMissCount(plan.nextDate);
      if (missCount !== plan.missCount) {
        saveDeworming({ ...plan, missCount, updatedAt: Date.now() });
      }
    }
  }, [dewormings, saveDeworming, updateVaccination, vaccinations]);

  useEffect(() => {
    let cancelled = false;
    void syncAllNotifications({
      items,
      nameOf: (gtin) => skuOf(gtin)?.name ?? '',
      pets,
      vaccinations,
      dewormings,
      settings: { ...settings, notified: itemNotifiedRef.current },
    }).then((result) => {
      // 排好就按商品记「今天已提醒」；不要用延时更新，否则下一次重排会取消还没弹的通知
      if (!cancelled && result?.immediate) {
        updateSettings({ notified: { ...(itemNotifiedRef.current ?? {}), ...result.notified } });
      }
    }).catch(() => {
      // 通知排程失败不影响应用主流程；下次启动会重新尝试
    });
    return () => {
      cancelled = true;
    };
    // settings.notified 故意不放进依赖：更新它不应触发整批通知重排
  }, [
    dewormings,
    items,
    pets,
    settings.remindDays,
    settings.reminders,
    skuOf,
    updateSettings,
    vaccinations,
  ]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void bindBackButton(() => {
      if (review) {
        setReview(null);
        return true;
      }
      // 编辑层在最上面，先关它
      if (editing) {
        setEditing(null);
        return true;
      }
      if (detailId) {
        setDetailId(null);
        return true;
      }
      if (tab !== 'scan') {
        setTab('scan');
        return true;
      }
      return false;
    }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [detailId, editing, review, tab]);

  const autoCheckedRef = useRef(false);
  useEffect(() => {
    if (!updater.ready || !updater.native || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void updater.check(false);
  }, [updater]);

  useEffect(() => {
    if (!(settings.reminders?.expiryEnabled ?? settings.remindEnabled)) return;
    // Android 里用系统级本地通知；WebView 的 Notification 会和它重复
    if (isNative()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const today = todayIso();
    if (settings.lastNotified === today || notifiedRef.current === today) return;
    const due = items.filter((item) => !item.finishedAt).filter((item) => {
      const left = daysUntil(item.expiryDate);
      return left !== undefined && left <= settings.remindDays;
    });
    if (!due.length) return;
    notifiedRef.current = today;
    const expired = due.filter((item) => (daysUntil(item.expiryDate) ?? 0) < 0).length;
    new Notification('效期管家', {
      body: `${due.length} 件商品需要处理${expired ? `，其中 ${expired} 件已过期` : ''}`,
    });
    updateSettings({ lastNotified: today });
  }, [items, settings.lastNotified, settings.remindDays, settings.remindEnabled, settings.reminders, updateSettings]);

  const openReview = useCallback((payload: { outcome: RecognizeOutcome; photo?: string }) => {
    const incoming = payload.outcome.sku;
    const gtin = incoming.gtin || makeInternalGtin();
    const archived = skuOf(gtin);
    setReview({
      outcome: {
        ...payload.outcome,
        sku: archived ? mergeWithArchive({ ...incoming, gtin }, archived) : { ...incoming, gtin },
        // 去重：同样的提示只留一条，避免列表里出现重复行
        notices: [
          ...new Set(
            archived
              ? ['已按条码匹配到商品档案：内容以档案为准，这次新读到的信息只用来补空字段，入库前再核对一遍', ...payload.outcome.notices]
              : payload.outcome.notices,
          ),
        ],
      },
      photo: payload.photo,
    });
  }, [skuOf]);

  const confirmReview = useCallback(
    async ({ sku, item }: { sku: Sku; item: PantryItem }) => {
      // 背标照片挪进 IndexedDB：localStorage 只有 5MB，照片留在里面会把记录挤爆
      let nextItem = item;
      if (item.photo) {
        const photoId = `photo-${item.id}`;
        if (await putPhoto(photoId, item.photo)) {
          const copy = { ...item, photoId };
          delete copy.photo;
          nextItem = copy;
        }
      }
      const existing = skuOf(sku.gtin);
      // 空档案不落库，也不要用空字段覆盖已有档案
      const hasContent = Boolean(sku.name.trim() || sku.manufacturer.trim() || sku.ingredientsRaw.trim());
      if (hasContent) {
        const next: Sku = existing
          ? {
              ...sku,
              createdAt: existing.createdAt,
              version: existing.ingredientsRaw === sku.ingredientsRaw ? existing.version : existing.version + 1,
            }
          : sku;
        saveSku(next);
      }
      addItem(nextItem);
      if (sku.name.trim()) {
        // 静默回流纯文本商品级字段；照片和 API Key 都不在 payload 中。
        void contributeProduct(settings, sku, nextItem);
      }
      setReview(null);
      setTab('pantry');
      showToast(hasContent ? (existing ? '已入库，商品信息已同步到同款记录' : '已建档并入库') : '已入库，商品信息待补全');
    },
    [addItem, saveSku, settings, showToast, skuOf],
  );

  const detailItem = detailId ? items.find((item) => item.id === detailId) : undefined;

  /** 记录还没有条码时（老数据）先补一个内部码，档案和记录才对得上 */
  const ensureGtin = useCallback(
    (item: PantryItem) => {
      if (item.gtin) return item.gtin;
      const gtin = makeInternalGtin();
      updateItem(item.id, { gtin });
      return gtin;
    },
    [updateItem],
  );

  /** 开封/用完默认只动 1 件：件数大于 1 时拆出一条，剩下的留在库存。 */
  const splitOne = useCallback(
    (item: PantryItem, mode: 'open' | 'finish') => {
      const count = item.count ?? 1;
      const today = todayIso();
      const openedAt = mode === 'open' ? today : (item.openedAt ?? isoFromTimestamp(item.createdAt));
      const openedExpiryDate =
        item.openedExpiryDate ?? openedExpirySuggestion(skuOf(item.gtin), openedAt);
      if (count <= 1) {
        if (mode === 'open') updateItem(item.id, { openedAt: today, openedExpiryDate });
        else updateItem(item.id, { openedAt, finishedAt: today, openedExpiryDate });
        return;
      }
      const perUnit = Math.round((item.quantity / count) * 100) / 100;
      addItem(
        {
          ...item,
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          quantity: perUnit,
          count: 1,
          openedAt,
          openedExpiryDate,
          finishedAt: mode === 'finish' ? today : undefined,
          photoId: item.photoId,
          seeded: undefined,
          createdAt: Date.now(),
        },
        { merge: false },
      );
      updateItem(item.id, { quantity: Math.round((item.quantity - perUnit) * 100) / 100, count: count - 1 });
    },
    [addItem, skuOf, updateItem],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <img src="/icon-round.png" alt="" />
          </span>
          <div>
            <h1>效期管家</h1>
            <p className="muted tiny">{SUBTITLES[tab]}</p>
          </div>
        </div>
        {dueCount > 0 ? (
          <button type="button" className="header-badge" onClick={() => setTab('pantry')}>
            {dueCount} 件待处理
          </button>
        ) : null}
      </header>

      {updater.outdated ? (
        <div className="update-banner">
          <div>
            <p className="update-title">发现新版本 {updater.manifest?.version}</p>
            <p className="muted tiny">{updater.manifest?.notes || '更新只替换界面资源，App 无需重装'}</p>
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={updater.busy} onClick={() => void updater.install()}>
            立即更新
          </button>
        </div>
      ) : null}

      {storageFull ? (
        <div className="warn-banner">
          <div>
            <p className="update-title">本地存储已满</p>
            <p className="muted tiny">新记录可能没写进去，照片也可能没保存，先到「设置 → 数据」导出备份</p>
          </div>
        </div>
      ) : null}

      <main className="app-main">
        {tab === 'scan' ? <ScanScreen onScanned={openReview} onOpenSettings={() => setTab('settings')} /> : null}
        {tab === 'pantry' ? <PantryScreen onOpenItem={setDetailId} onScan={() => setTab('scan')} /> : null}
        {tab === 'pets' ? <PetScreen /> : null}
        {tab === 'consume' ? <ConsumptionScreen onScan={() => setTab('scan')} /> : null}
        {tab === 'settings' ? <SettingsScreen updater={updater} onOpenLibrary={() => setLibraryOpen(true)} /> : null}
      </main>

      <nav className="tabbar" aria-label="主导航">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`tab ${key === tab ? 'on' : ''}`}
            aria-current={key === tab ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>

      {review ? (
        <ReviewSheet
          outcome={review.outcome}
          photo={review.photo}
          initialProduction={review.outcome.productionDate}
          initialExpiry={review.outcome.expiryDate}
          onCancel={() => setReview(null)}
          onConfirm={confirmReview}
        />
      ) : null}

      {detailItem ? (
        <ItemSheet
          item={detailItem}
          sku={skuOf(detailItem.gtin)}
          onClose={() => setDetailId(null)}
          onPatch={(patch) => updateItem(detailItem.id, patch)}
          onRemove={() => {
            removeItem(detailItem.id);
            setDetailId(null);
            showToast('记录已删除', 'warn');
          }}
          onEditSku={() => {
            const found = skuOf(detailItem.gtin);
            // 先收起详情，避免两层抽屉叠在一起（Esc / 返回键会一次关掉两层）
            setDetailId(null);
            // 没有档案的记录（档案被删过）直接进新增，别再点了没反应
            setEditing(found ? { sku: found, isNew: false } : { sku: createEmptySku(ensureGtin(detailItem)), isNew: true });
          }}
          onRenameSku={(name) => {
            // 清空输入框不算改名，避免边删边写把档案名抹掉
            if (!name) return;
            const found = skuOf(detailItem.gtin);
            if (found) {
              if (found.name === name) return;
              saveSku({ ...found, name });
              return;
            }
            saveSku({ ...createEmptySku(ensureGtin(detailItem)), name });
            showToast('已按这条记录建好商品档案');
          }}
          onOpenOne={() => {
            const many = (detailItem.count ?? 1) > 1;
            splitOne(detailItem, 'open');
            showToast(many ? '已开封 1 件，其余仍在库存' : '已记录开封');
          }}
          onFinishOne={() => {
            const many = (detailItem.count ?? 1) > 1;
            splitOne(detailItem, 'finish');
            setDetailId(null);
            showToast(many ? '已用完 1 件，其余仍在库存' : '已归档到消耗记录', 'warn');
          }}
        />
      ) : null}

      {editing ? (
        <SkuSheet
          sku={editing.sku}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            // 新增档案时如果条码已经存在，就并到那条档案上，别让两份档案抢同一个索引
            const existing = editing.isNew ? skuOf(next.gtin) : editing.sku;
            const merged: Sku = existing
              ? {
                  ...next,
                  createdAt: existing.createdAt,
                  version:
                    existing.ingredientsRaw === next.ingredientsRaw
                      ? Math.max(existing.version, next.version)
                      : Math.max(existing.version, next.version) + 1,
                }
              : next;
            saveSku(merged);
            setEditing(null);
            showToast(existing && editing.isNew ? '同条码已有档案，已合并更新' : '商品档案已保存', existing && editing.isNew ? 'warn' : 'ok');
          }}
          onDelete={() => {
            const linked = items.filter((item) => item.gtin === editing.sku.gtin).length;
            const message = linked
              ? `有 ${linked} 条库存或消耗记录在用这个档案。删除后它们会显示成「未命名商品」，记录本身不会丢。确定删除？`
              : '确定删除这个商品档案吗？';
            if (!window.confirm(message)) return;
            removeSku(editing.sku.gtin);
            setEditing(null);
            showToast('商品档案已删除', 'warn');
          }}
        />
      ) : null}

      {libraryOpen && !editing ? (
        <Sheet title="商品档案库" subtitle="按条码复用，同款商品第二次录入会自动带出" onClose={() => setLibraryOpen(false)}>
          <LibraryScreen
            onCreate={() => setEditing({ sku: createEmptySku(), isNew: true })}
            onOpenSku={(sku) => setEditing({ sku, isNew: false })}
          />
        </Sheet>
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status">
          <Check size={14} />
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}
