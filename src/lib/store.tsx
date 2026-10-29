import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DewormingPlan,
  FeedingLog,
  Maker,
  PantryItem,
  Pet,
  ReminderKind,
  ReminderSettings,
  Settings,
  Sku,
  Vaccination,
  WeightRecord,
} from '../types';
import { refreshSku } from './sku';
import { expiryFrom, isValidIso, parseShelfLife, shiftDays, todayIso } from './shelfLife';
import { DEFAULT_MAKERS } from './manufacturers';
import { makeInternalGtin } from './gtin';
import { clearSecureKey, readSecureKey, writeSecureKey } from './secureKey';
import {
  clearPhotos,
  clearState,
  deletePhoto,
  moveInlinePhotos,
  readMirror,
  readState,
  writeMirror,
  writeState,
} from './storage';

/**
 * 2：不再内置演示商品，读取旧数据时清掉早期写入的示例内容。
 * 3：到期日规则改为「生产日期 + 保质期 − 1 天」，把按旧规则算出来的到期日往前挪一天。
 */
const SCHEMA = 6;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  remindEnabled: true,
  remindDays: 7,
  // 默认按最高精度来：每次都跑复验。想省钱可以在设置里降到「按需复验」
  verifyMode: 'always',
  reminders: {
    expiryEnabled: true,
    vaccineEnabled: true,
    dewormEnabled: true,
    enabledAt: {},
  },
  productApiUrl: '',
};

export type Snapshot = {
  schema: number;
  skus: Sku[];
  items: PantryItem[];
  settings: Settings;
  makers: Maker[];
  pets: Pet[];
  feedings: FeedingLog[];
  vaccinations: Vaccination[];
  dewormings: DewormingPlan[];
  activePetId: string;
};

export function emptySnapshot(): Snapshot {
  const now = Date.now();
  return {
    schema: SCHEMA,
    skus: [],
    items: [],
    settings: {
      ...DEFAULT_SETTINGS,
      reminders: {
        ...DEFAULT_SETTINGS.reminders!,
        enabledAt: { expiry: now, vaccine: now, deworm: now },
      },
    },
    makers: [...DEFAULT_MAKERS],
    pets: [],
    feedings: [],
    vaccinations: [],
    dewormings: [],
    activePetId: '',
  };
}

/** 只取认识的字段，旧版本里已移除的配置项（例如 engine）会被丢掉。 */
function readSettings(raw: Partial<Settings> | undefined): Settings {
  const mode = raw?.verifyMode;
  const now = Date.now();
  const legacyExpiryEnabled = raw?.remindEnabled === undefined ? true : Boolean(raw.remindEnabled);
  const expiryEnabled = raw?.reminders?.expiryEnabled ?? legacyExpiryEnabled;
  const enabledAt: ReminderSettings['enabledAt'] = {};
  const kinds: ReminderKind[] = ['expiry', 'vaccine', 'deworm'];
  for (const kind of kinds) {
    const value = raw?.reminders?.enabledAt?.[kind];
    if (typeof value === 'number' && Number.isFinite(value)) enabledAt[kind] = value;
  }
  if (!enabledAt.expiry) enabledAt.expiry = expiryEnabled ? now : undefined;
  if (!enabledAt.vaccine) enabledAt.vaccine = raw?.reminders?.vaccineEnabled === false ? undefined : now;
  if (!enabledAt.deworm) enabledAt.deworm = raw?.reminders?.dewormEnabled === false ? undefined : now;
  const reminders: ReminderSettings = {
    expiryEnabled,
    vaccineEnabled: raw?.reminders?.vaccineEnabled ?? true,
    dewormEnabled: raw?.reminders?.dewormEnabled ?? true,
    enabledAt,
  };
  return {
    apiKey: raw?.apiKey ?? '',
    remindEnabled: reminders.expiryEnabled,
    remindDays:
      typeof raw?.remindDays === 'number' &&
      Number.isFinite(raw.remindDays) &&
      raw.remindDays > 0
        ? Math.min(365, Math.round(raw.remindDays))
        : DEFAULT_SETTINGS.remindDays,
    lastNotified: raw?.lastNotified,
    notified:
      raw?.notified && typeof raw.notified === 'object'
        ? Object.fromEntries(
            Object.entries(raw.notified).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined,
    verifyMode: mode === 'always' || mode === 'off' || mode === 'auto' ? mode : 'always',
    reminders,
    productApiUrl: typeof raw?.productApiUrl === 'string' ? raw.productApiUrl.trim().slice(0, 500) : '',
  };
}

/** 旧数据的清洗与迁移：清掉演示内容、给无码档案补内部码、把旧规则算出的到期日挪一天。 */
function normalizeSnapshot(parsed: Partial<Snapshot> | undefined): Snapshot {
  if (!parsed) return emptySnapshot();
  try {
    const now = Date.now();
    const recordOf = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const textOf = (value: unknown, fallback = '') =>
      typeof value === 'string' ? value : fallback;
    const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
    const positiveNumber = (value: unknown): number | undefined => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : undefined;
    };
    // 老数据里可能有没条码的档案，它们以前会互相覆盖，这里补一个内部码钉住身份
    let rescuedGtin = '';
    const skus = arrayOf(parsed.skus)
      .map(recordOf)
      .filter((sku) => sku.source !== 'demo')
      // 早期版本写入、现在已经不用的字段（联网商品图、净含量）顺手清掉，省本地空间
      .map((sku) => {
        const clean = { ...sku };
        delete clean.imageUrl;
        delete clean.netContent;
        if (!String(clean.gtin ?? '').trim()) {
          const gtin = makeInternalGtin();
          if (!rescuedGtin) rescuedGtin = gtin;
          clean.gtin = gtin;
        }
        const category =
          clean.category === 'other'
            ? 'supplies'
            : ['dry', 'wet', 'freeze_dried', 'fresh_raw', 'medicine', 'supplies'].includes(
                  String(clean.category ?? ''),
                )
              ? (clean.category as Sku['category'])
              : undefined;
        const kind =
          clean.kind === 'staple' || clean.kind === 'snack' ? clean.kind : undefined;
        const confidenceRaw = recordOf(clean.confidence);
        const confidence = Object.fromEntries(
          Object.entries(confidenceRaw)
            .map(([key, value]) => [key, Number(value)] as const)
            .filter(([, value]) => Number.isFinite(value)),
        );
        const nutritionRaw =
          clean.nutrition && typeof clean.nutrition === 'object'
            ? (clean.nutrition as Record<string, unknown>)
            : undefined;
        return refreshSku({
          ...(clean as unknown as Sku),
          gtin: textOf(clean.gtin),
          name: textOf(clean.name),
          brand: textOf(clean.brand),
          manufacturer: textOf(clean.manufacturer),
          scCode: textOf(clean.scCode) || undefined,
          standardCode: textOf(clean.standardCode) || undefined,
          ingredientsRaw: textOf(clean.ingredientsRaw),
          iconLabel: textOf(clean.iconLabel) || undefined,
          category,
          kind,
          ingredients: arrayOf(clean.ingredients).filter(
            (value): value is string => typeof value === 'string',
          ),
          additives: arrayOf(clean.additives).filter(
            (value): value is string => typeof value === 'string',
          ),
          allergens: arrayOf(clean.allergens).filter(
            (value): value is string => typeof value === 'string',
          ),
          storage: textOf(clean.storage) || undefined,
          shelfLifeText: textOf(clean.shelfLifeText) || undefined,
          shelfLifeDays: positiveNumber(clean.shelfLifeDays),
          shelfLifeMonths: positiveNumber(clean.shelfLifeMonths),
          packageGrams: positiveNumber(clean.packageGrams),
          nutrition: nutritionRaw
            ? {
                metabolizableEnergy: textOf(nutritionRaw.metabolizableEnergy) || undefined,
                crudeProtein: textOf(nutritionRaw.crudeProtein) || undefined,
                crudeFat: textOf(nutritionRaw.crudeFat) || undefined,
                crudeFiber: textOf(nutritionRaw.crudeFiber) || undefined,
                crudeAsh: textOf(nutritionRaw.crudeAsh) || undefined,
                moisture: textOf(nutritionRaw.moisture) || undefined,
                taurine: textOf(nutritionRaw.taurine) || undefined,
                calciumPhosphorus: textOf(nutritionRaw.calciumPhosphorus) || undefined,
                energy: textOf(nutritionRaw.energy) || undefined,
                protein: textOf(nutritionRaw.protein) || undefined,
                fat: textOf(nutritionRaw.fat) || undefined,
                carbohydrate: textOf(nutritionRaw.carbohydrate) || undefined,
                sodium: textOf(nutritionRaw.sodium) || undefined,
              }
            : undefined,
          source:
            clean.source === 'api' || clean.source === 'library'
              ? clean.source
              : 'manual',
          version: positiveNumber(clean.version) ?? 1,
          confidence,
          createdAt: positiveNumber(clean.createdAt) ?? now,
          updatedAt: positiveNumber(clean.updatedAt) ?? now,
          verified: Boolean(clean.verified),
        });
      });
    let items = arrayOf(parsed.items)
      .map(recordOf)
      .filter((item) => !item.seeded)
      .map((item) => {
        const quantity = Number(item.quantity);
        const count = Number(item.count);
        return {
          ...(item as unknown as PantryItem),
          gtin: textOf(item.gtin),
          productionDate: isValidIso(textOf(item.productionDate)) ? textOf(item.productionDate) : undefined,
          expiryDate: isValidIso(textOf(item.expiryDate)) ? textOf(item.expiryDate) : undefined,
          expiryHumanConfirmed: Boolean(item.expiryHumanConfirmed),
          openedAt: isValidIso(textOf(item.openedAt)) ? textOf(item.openedAt) : undefined,
          openedExpiryDate: isValidIso(textOf(item.openedExpiryDate))
            ? textOf(item.openedExpiryDate)
            : undefined,
          finishedAt: isValidIso(textOf(item.finishedAt)) ? textOf(item.finishedAt) : undefined,
          quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
          unit: textOf(item.unit, '克') || '克',
          count: Number.isFinite(count) && count > 0 ? Math.round(count) : 1,
          location: textOf(item.location),
          petId: textOf(item.petId) || undefined,
          note: textOf(item.note) || undefined,
          photoId: textOf(item.photoId) || undefined,
          photo: textOf(item.photo) || undefined,
          createdAt: positiveNumber(item.createdAt) ?? now,
        };
      });
    if (rescuedGtin) items = items.map((item) => (item.gtin ? item : { ...item, gtin: rescuedGtin }));
    // 只在旧规则（schema < 3）时回迁到期日；升级到 4 不能把用户手动填的日期再挪一次
    if ((parsed.schema ?? 0) < 3) {
      items = items.map((item) => {
        if (!item.productionDate || !item.expiryDate) return item;
        const sku = skus.find((candidate) => candidate.gtin === item.gtin);
        const next = expiryFrom(item.productionDate, parseShelfLife(sku?.shelfLifeText));
        // 旧值正好是新值 +1 天，说明它是按旧规则推算出来的，跟着改成新规则
        if (next && item.expiryDate === shiftDays(next, 1)) {
          return { ...item, expiryDate: next };
        }
        return item;
      });
    }
    // 分类重构：旧「其他」并入用品耗材；营养成分旧字段映射到新字段
    const migratedSkus = skus.map((sku) => {
      const nutrition = sku.nutrition ? { ...sku.nutrition } : undefined;
      if (nutrition) {
        if (!nutrition.crudeProtein && nutrition.protein) nutrition.crudeProtein = nutrition.protein;
        if (!nutrition.crudeFat && nutrition.fat) nutrition.crudeFat = nutrition.fat;
        if (!nutrition.metabolizableEnergy && nutrition.energy) nutrition.metabolizableEnergy = nutrition.energy;
      }
      return {
        ...sku,
        category: sku.category === 'other' ? 'supplies' : sku.category,
        nutrition,
      } as Sku;
    });
    const recoveredMakers = arrayOf(parsed.makers)
      .map(recordOf)
      .map((maker) => ({
        name: textOf(maker.name).trim(),
        city: textOf(maker.city).trim() || undefined,
        brands: textOf(maker.brands).trim() || undefined,
      }))
      .filter((maker) => maker.name);
    const makers = recoveredMakers.length ? recoveredMakers : [...DEFAULT_MAKERS];
    const pets = arrayOf(parsed.pets)
      .map(recordOf)
      .map((pet, index) => {
        const species =
          pet.species === 'cat' || pet.species === 'dog' || pet.species === 'other'
            ? pet.species
            : 'cat';
        const gender =
          pet.gender === 'male' || pet.gender === 'female' || pet.gender === 'unknown'
            ? pet.gender
            : 'unknown';
        return {
          ...(pet as unknown as Pet),
          id: textOf(pet.id) || `pet-recovered-${index}-${now}`,
          name: textOf(pet.name).trim() || '未命名宠物',
          species,
          breed: textOf(pet.breed) || undefined,
          weightKg: positiveNumber(pet.weightKg),
          weightUnit:
            pet.weightUnit === 'g' || pet.weightUnit === 'jin' || pet.weightUnit === 'kg'
              ? pet.weightUnit
              : 'jin',
          birthDate: isValidIso(textOf(pet.birthDate)) ? textOf(pet.birthDate) : undefined,
          gender,
          neutered: typeof pet.neutered === 'boolean' ? pet.neutered : undefined,
          avatar: textOf(pet.avatar) || undefined,
          avatarPhotoId: textOf(pet.avatarPhotoId) || undefined,
          weightHistory: arrayOf(pet.weightHistory)
            .map(recordOf)
            .map((record) => ({
              date: textOf(record.date),
              weightKg: Number(record.weightKg),
              createdAt: positiveNumber(record.createdAt) ?? now,
            }))
          .filter(
            (record): record is WeightRecord =>
              Boolean(
                record &&
                  isValidIso(record.date) &&
                  Number.isFinite(record.weightKg) &&
                  record.weightKg > 0,
              ),
          )
          .sort((left, right) => right.date.localeCompare(left.date)),
          createdAt: positiveNumber(pet.createdAt) ?? now,
          updatedAt: positiveNumber(pet.updatedAt) ?? now,
        } satisfies Pet;
      });
    const feedings = arrayOf(parsed.feedings)
      .map(recordOf)
      .map((feeding, index) => ({
        ...(feeding as unknown as FeedingLog),
        id: textOf(feeding.id) || `feeding-recovered-${index}-${now}`,
        petId: textOf(feeding.petId) || undefined,
        itemId: textOf(feeding.itemId) || undefined,
        gtin: textOf(feeding.gtin) || undefined,
        grams: Number(feeding.grams),
        date: isValidIso(textOf(feeding.date)) ? textOf(feeding.date) : todayIso(),
        note: textOf(feeding.note) || undefined,
        createdAt: positiveNumber(feeding.createdAt) ?? now,
      }))
      .filter((feeding) => Number.isFinite(feeding.grams) && feeding.grams > 0)
      .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt);
    const vaccinations = arrayOf(parsed.vaccinations)
      .map(recordOf)
      .map((record, index): Vaccination | undefined => {
        const petId = textOf(record.petId);
        const vaccineName = textOf(record.vaccineName);
        const doseDate = textOf(record.doseDate);
        if (!petId || !vaccineName || !isValidIso(doseDate)) return undefined;
        const vaccineKind: Vaccination['vaccineKind'] =
          record.vaccineKind === 'combo' ||
          record.vaccineKind === 'rabies' ||
          record.vaccineKind === 'other'
            ? record.vaccineKind
            : undefined;
        const source: Vaccination['source'] =
          record.source === 'photo' || record.source === 'auto' || record.source === 'manual'
            ? record.source
            : 'manual';
        return {
          ...(record as unknown as Vaccination),
          id: textOf(record.id) || `vaccine-recovered-${index}-${now}`,
          petId,
          vaccineName,
          vaccineKind,
          doseDate,
          confirmed: true,
          nextDate: isValidIso(textOf(record.nextDate)) ? textOf(record.nextDate) : undefined,
          clinic: textOf(record.clinic) || undefined,
          source,
          missCount: Math.min(4, Math.max(0, Number(record.missCount) || 0)),
          photoId: textOf(record.photoId) || undefined,
          createdAt: positiveNumber(record.createdAt) ?? now,
        };
      })
      .filter((record): record is Vaccination => Boolean(record));
    const dewormings = arrayOf(parsed.dewormings)
      .map(recordOf)
      .map((plan, index) => ({
        ...(plan as unknown as DewormingPlan),
        id: textOf(plan.id) || `deworm-recovered-${index}-${now}`,
        petId: textOf(plan.petId),
        type: plan.type === 'external' ? ('external' as const) : ('internal' as const),
        lastDate: textOf(plan.lastDate),
        nextDate: textOf(plan.nextDate),
        doneLog: arrayOf(plan.doneLog).filter(
          (value): value is string => typeof value === 'string' && isValidIso(value),
        ),
        missCount: Math.min(4, Math.max(0, Number(plan.missCount) || 0)),
        createdAt: positiveNumber(plan.createdAt) ?? now,
        updatedAt: positiveNumber(plan.updatedAt) ?? now,
      }))
      .filter(
        (plan): plan is DewormingPlan =>
          Boolean(plan.petId && isValidIso(plan.lastDate) && isValidIso(plan.nextDate)),
      );
    const activePetId =
      typeof parsed.activePetId === 'string' && pets.some((pet) => pet.id === parsed.activePetId)
        ? parsed.activePetId
        : pets[0]?.id ?? '';
    return {
      schema: SCHEMA,
      skus: migratedSkus,
      items,
      settings: readSettings(parsed.settings),
      makers,
      pets,
      feedings,
      vaccinations,
      dewormings,
      activePetId,
    };
  } catch {
    return emptySnapshot();
  }
}

/** 镜像里只有记录本身（不含照片本体），数据库读不到时先用它把界面撑起来 */
function loadMirrorSnapshot(): Snapshot {
  return normalizeSnapshot(readMirror<Partial<Snapshot>>());
}

/** 写镜像前把照片本体摘掉：localStorage 只有 5MB，照片留在数据库里 */
function mirrorCopy(snapshot: Snapshot): Snapshot {
  const withoutKey: Snapshot = { ...snapshot, settings: { ...snapshot.settings, apiKey: '' } };
  if (!withoutKey.items.some((item) => item.photo)) return withoutKey;
  return {
    ...withoutKey,
    items: withoutKey.items.map((item) => {
      if (!item.photo) return item;
      const copy = { ...item };
      delete copy.photo;
      return copy;
    }),
  };
}

/** 落盘版本绝不带 API Key：Key 只在内存和 Android Keystore 里 */
function withoutSecret(snapshot: Snapshot): Snapshot {
  return { ...snapshot, settings: { ...snapshot.settings, apiKey: '' } };
}

export type StoreValue = {
  skus: Sku[];
  items: PantryItem[];
  settings: Settings;
  makers: Maker[];
  pets: Pet[];
  feedings: FeedingLog[];
  vaccinations: Vaccination[];
  dewormings: DewormingPlan[];
  activePetId: string;
  /** 本地存储写满时置位：新记录可能没落盘 */
  storageFull: boolean;
  skuOf: (gtin: string) => Sku | undefined;
  saveSku: (sku: Sku) => void;
  removeSku: (gtin: string) => void;
  addItem: (item: PantryItem, options?: { merge?: boolean }) => void;
  updateItem: (id: string, patch: Partial<PantryItem>) => void;
  /** 一次改多条：迁移照片这种事要避免每条都重写一遍本地存储 */
  patchItems: (patches: Record<string, Partial<PantryItem>>) => void;
  removeItem: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  savePet: (pet: Pet) => void;
  removePet: (id: string) => void;
  setActivePet: (id: string) => void;
  addFeeding: (feeding: FeedingLog) => void;
  removeFeeding: (id: string) => void;
  addVaccinations: (records: Vaccination[]) => void;
  updateVaccination: (id: string, patch: Partial<Vaccination>) => void;
  removeVaccination: (id: string) => void;
  saveDeworming: (plan: DewormingPlan) => void;
  removeDeworming: (id: string) => void;
  addMaker: (maker: Maker) => void;
  removeMaker: (name: string) => void;
  restoreMakers: () => void;
  wipe: () => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => loadMirrorSnapshot());
  const [storageFull, setStorageFull] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  /**
   * 启动：以 IndexedDB 为准（额度跟着手机剩余空间走），读不到才用 localStorage 镜像。
   * 第一次升级时把镜像里的老数据（可能还带着内联照片）整体搬进数据库。
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await readState<Partial<Snapshot>>();
        const fromDb = stored ? normalizeSnapshot(stored) : undefined;
        const mirrored = loadMirrorSnapshot();
        // 镜像里的记录比数据库多，说明数据库落后了（老版本只写了 localStorage），以镜像为准
        const mirrorIsRicher = mirrored.items.length > (fromDb?.items.length ?? 0);
        // 老版本可能把明文 Key 只留在镜像里：这种也要优先用镜像，确保不漏迁移
        const mirrorHasLegacyKey = Boolean(mirrored.settings.apiKey.trim() && !fromDb?.settings.apiKey.trim());
        const source = mirrorIsRicher || mirrorHasLegacyKey || !fromDb ? mirrored : fromDb;
        const { snapshot: withPhotos, moved } = await moveInlinePhotos(source);
        if (cancelled) return;
        // 旧版本的明文 Key：先搬进 Keystore，再从持久化数据里清掉
        const legacyKey = withPhotos.settings.apiKey.trim();
        if (legacyKey) await writeSecureKey(legacyKey);
        const secureKey = await readSecureKey();
        const runtimeSnapshot: Snapshot = {
          ...withPhotos,
          settings: { ...withPhotos.settings, apiKey: secureKey || legacyKey },
        };
        setSnapshot(runtimeSnapshot);
        // 数据库里还没有、或者刚搬过照片，就把这一份写回去
        if (!fromDb || mirrorIsRicher || mirrorHasLegacyKey || moved || legacyKey) {
          void writeState(withoutSecret(runtimeSnapshot));
        }
      } catch {
        // 数据库读不出来就用镜像，界面照样能用
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 落盘：数据库 + 轻量镜像；两个都写不进去才提示存储问题 */
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const persisted = withoutSecret(snapshot);
        const okDb = await writeState(persisted);
        // 数据库写成功时，镜像只留记录本身；数据库不可用时镜像兜底存全套
        const okMirror = writeMirror(mirrorCopy(snapshot));
        setStorageFull(!okDb && !okMirror);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [snapshot, hydrated]);

  const skuOf = useCallback(
    (gtin: string) => snapshot.skus.find((sku) => sku.gtin === gtin),
    [snapshot.skus],
  );

  const saveSku = useCallback((sku: Sku) => {
    const next = refreshSku(sku);
    setSnapshot((current) => {
      const exists = current.skus.some((candidate) => candidate.gtin === next.gtin);
      const skus = exists
        ? current.skus.map((candidate) => (candidate.gtin === next.gtin ? next : candidate))
        : [...current.skus, next];
      return { ...current, skus };
    });
  }, []);

  const removeSku = useCallback((gtin: string) => {
    setSnapshot((current) => ({ ...current, skus: current.skus.filter((sku) => sku.gtin !== gtin) }));
  }, []);

  const addItem = useCallback((item: PantryItem, options?: { merge?: boolean }) => {
    setSnapshot((current) => {
      // 已结案的记录（用完归档）不与在用库存合并
      if (item.finishedAt || options?.merge === false) return { ...current, items: [...current.items, item] };
      const existing = current.items.find(
        (candidate) =>
          candidate.gtin === item.gtin &&
          candidate.expiryDate === item.expiryDate &&
          candidate.location === item.location &&
          !candidate.finishedAt,
      );
      if (existing) {
        return {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === existing.id
              ? {
                  ...candidate,
                  quantity: candidate.quantity + item.quantity,
                  count: (candidate.count ?? 1) + (item.count ?? 1),
                }
              : candidate,
          ),
        };
      }
      return { ...current, items: [...current.items, item] };
    });
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<PantryItem>) => {
    setSnapshot((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }, []);

  const patchItems = useCallback((patches: Record<string, Partial<PantryItem>>) => {
    setSnapshot((current) => ({
      ...current,
      items: current.items.map((item) => (patches[item.id] ? { ...item, ...patches[item.id] } : item)),
    }));
  }, []);

  const removeItem = useCallback((id: string) => {
    setSnapshot((current) => {
      const removed = current.items.find((item) => item.id === id);
      if (removed?.photoId) void deletePhoto(removed.photoId);
      return { ...current, items: current.items.filter((item) => item.id !== id) };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      void writeSecureKey(patch.apiKey ?? '');
    }
    setSnapshot((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  }, []);

  /** 新增或更新宠物档案；第一只宠物自动设为当前 */
  const savePet = useCallback((pet: Pet) => {
    setSnapshot((current) => {
      const exists = current.pets.some((item) => item.id === pet.id);
      const previous = current.pets.find((item) => item.id === pet.id);
      const today = todayIso();
      const weight = Number(pet.weightKg);
      const history = [...(pet.weightHistory ?? previous?.weightHistory ?? [])];
      if (Number.isFinite(weight) && weight > 0) {
        const existingIndex = history.findIndex((record) => record.date === today);
        const record: WeightRecord = {
          date: today,
          weightKg: Math.round(weight * 100) / 100,
          createdAt: existingIndex >= 0 ? history[existingIndex].createdAt : Date.now(),
        };
        if (existingIndex >= 0) history[existingIndex] = record;
        else history.unshift(record);
      }
      const next: Pet = {
        ...pet,
        weightHistory: history
          .filter((record) => isValidIso(record.date) && Number(record.weightKg) > 0)
          .sort((left, right) => right.date.localeCompare(left.date)),
        updatedAt: Date.now(),
      };
      return {
        ...current,
        pets: exists ? current.pets.map((item) => (item.id === pet.id ? next : item)) : [...current.pets, next],
        activePetId: current.activePetId || pet.id,
      };
    });
  }, []);

  /** 删除宠物：库存保留为家庭公共，投喂记录一并删除 */
  const removePet = useCallback((id: string) => {
    setSnapshot((current) => {
      const removed = current.pets.find((pet) => pet.id === id);
      if (removed?.avatarPhotoId) void deletePhoto(removed.avatarPhotoId);
      for (const record of current.vaccinations.filter((item) => item.petId === id)) {
        if (record.photoId) void deletePhoto(record.photoId);
      }
      const pets = current.pets.filter((pet) => pet.id !== id);
      return {
        ...current,
        pets,
        items: current.items.map((item) => (item.petId === id ? { ...item, petId: undefined } : item)),
        feedings: current.feedings.filter((feeding) => feeding.petId !== id),
        vaccinations: current.vaccinations.filter((record) => record.petId !== id),
        dewormings: current.dewormings.filter((plan) => plan.petId !== id),
        activePetId: current.activePetId === id ? pets[0]?.id ?? '' : current.activePetId,
      };
    });
  }, []);

  const setActivePet = useCallback((id: string) => {
    setSnapshot((current) => ({ ...current, activePetId: id }));
  }, []);

  /** 记录一次投喂；关联库存时同步扣减克数 */
  const addFeeding = useCallback((feeding: FeedingLog) => {
    setSnapshot((current) => {
      const grams = Math.max(0, Number(feeding.grams) || 0);
      const nextItems = current.items.map((item) => {
        if (!feeding.itemId || item.id !== feeding.itemId) return item;
        const unit = (item.unit ?? '').trim().toLowerCase();
        const factor = ['克', 'g', 'gram', 'grams'].includes(unit)
          ? 1
          : ['千克', '公斤', 'kg'].includes(unit)
            ? 1000
            : undefined;
        if (!factor) return item;
        return {
          ...item,
          quantity: Math.round(Math.max(0, item.quantity - grams / factor) * 100) / 100,
        };
      });
      return {
        ...current,
        items: nextItems,
        feedings: [{ ...feeding, grams }, ...current.feedings].sort(
          (left, right) => right.date.localeCompare(left.date) || right.createdAt - left.createdAt,
        ),
      };
    });
  }, []);

  const removeFeeding = useCallback((id: string) => {
    setSnapshot((current) => {
      const removed = current.feedings.find((feeding) => feeding.id === id);
      const items = removed?.itemId
        ? current.items.map((item) => {
            if (item.id !== removed.itemId) return item;
            const unit = (item.unit ?? '').trim().toLowerCase();
            const factor = ['克', 'g', 'gram', 'grams'].includes(unit)
              ? 1
              : ['千克', '公斤', 'kg'].includes(unit)
                ? 1000
                : undefined;
            if (!factor) return item;
            return { ...item, quantity: Math.round((item.quantity + removed.grams / factor) * 100) / 100 };
          })
        : current.items;
      return {
        ...current,
        items,
        feedings: current.feedings.filter((feeding) => feeding.id !== id),
      };
    });
  }, []);

  const addVaccinations = useCallback((records: Vaccination[]) => {
    const valid = records
      .filter(
        (record) =>
          record.confirmed &&
          record.petId &&
          record.vaccineName.trim() &&
          isValidIso(record.doseDate),
      )
      .map((record) => ({
        ...record,
        vaccineName: record.vaccineName.trim(),
        confirmed: true as const,
        missCount: Math.min(4, Math.max(0, Number(record.missCount) || 0)),
        createdAt: record.createdAt || Date.now(),
        updatedAt: Date.now(),
      }));
    if (!valid.length) return;
    setSnapshot((current) => ({
      ...current,
      vaccinations: [...valid, ...current.vaccinations],
    }));
  }, []);

  const updateVaccination = useCallback((id: string, patch: Partial<Vaccination>) => {
    setSnapshot((current) => ({
      ...current,
      vaccinations: current.vaccinations.map((record) =>
        record.id === id ? { ...record, ...patch, confirmed: true, updatedAt: Date.now() } : record,
      ),
    }));
  }, []);

  const removeVaccination = useCallback((id: string) => {
    setSnapshot((current) => {
      const record = current.vaccinations.find((item) => item.id === id);
      if (record?.photoId) void deletePhoto(record.photoId);
      return {
        ...current,
        vaccinations: current.vaccinations.filter((item) => item.id !== id),
      };
    });
  }, []);

  const saveDeworming = useCallback((plan: DewormingPlan) => {
    setSnapshot((current) => {
      const exists = current.dewormings.some((item) => item.id === plan.id);
      return {
        ...current,
        dewormings: exists
          ? current.dewormings.map((item) => (item.id === plan.id ? plan : item))
          : [...current.dewormings, plan],
      };
    });
  }, []);

  const removeDeworming = useCallback((id: string) => {
    setSnapshot((current) => ({
      ...current,
      dewormings: current.dewormings.filter((item) => item.id !== id),
    }));
  }, []);

  const addMaker = useCallback((maker: Maker) => {
    const name = maker.name.trim();
    if (!name) return;
    setSnapshot((current) => {
      if (current.makers.some((item) => item.name === name)) return current;
      return { ...current, makers: [{ ...maker, name }, ...current.makers] };
    });
  }, []);

  const removeMaker = useCallback((name: string) => {
    setSnapshot((current) => ({ ...current, makers: current.makers.filter((item) => item.name !== name) }));
  }, []);

  const restoreMakers = useCallback(() => {
    setSnapshot((current) => ({ ...current, makers: [...DEFAULT_MAKERS] }));
  }, []);

  const wipe = useCallback(() => {
    void clearState();
    void clearPhotos();
    void clearSecureKey();
    setSnapshot(emptySnapshot());
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      skus: snapshot.skus,
      items: snapshot.items,
      settings: snapshot.settings,
      makers: snapshot.makers,
      pets: snapshot.pets,
      feedings: snapshot.feedings,
      vaccinations: snapshot.vaccinations,
      dewormings: snapshot.dewormings,
      activePetId: snapshot.activePetId,
      storageFull,
      skuOf,
      saveSku,
      removeSku,
      addItem,
      updateItem,
      patchItems,
      removeItem,
      updateSettings,
      savePet,
      removePet,
      setActivePet,
      addFeeding,
      removeFeeding,
      addVaccinations,
      updateVaccination,
      removeVaccination,
      saveDeworming,
      removeDeworming,
      addMaker,
      removeMaker,
      restoreMakers,
      wipe,
    }),
    [
      snapshot,
      storageFull,
      skuOf,
      saveSku,
      removeSku,
      addItem,
      updateItem,
      patchItems,
      removeItem,
      updateSettings,
      savePet,
      removePet,
      setActivePet,
      addFeeding,
      removeFeeding,
      addVaccinations,
      updateVaccination,
      removeVaccination,
      saveDeworming,
      removeDeworming,
      addMaker,
      removeMaker,
      restoreMakers,
      wipe,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore 必须在 StoreProvider 内使用');
  return value;
}
