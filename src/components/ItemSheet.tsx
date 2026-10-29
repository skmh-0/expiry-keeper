import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { PantryItem, Sku } from '../types';
import {
  daysUntil,
  expiryFrom,
  formatCn,
  parseShelfLife,
  remainingText,
  statusOf,
  statusThresholds,
  todayIso,
} from '../lib/shelfLife';
import { Chip, Field, Sheet, StatusPill, Stepper, TextArea, TextInput } from './ui';
import { BrandTile } from './BrandTile';
import { getPhoto } from '../lib/storage';
import { CATEGORY_META, categoryOf, openedExpirySuggestion, pkgStats } from '../lib/pets';
import { useStore } from '../lib/store';

export function ItemSheet({
  item,
  sku,
  onClose,
  onPatch,
  onRemove,
  onEditSku,
  onRenameSku,
  onOpenOne,
  onFinishOne,
}: {
  item: PantryItem;
  sku?: Sku;
  onClose: () => void;
  onPatch: (patch: Partial<PantryItem>) => void;
  onRemove: () => void;
  onEditSku: () => void;
  onRenameSku: (name: string) => void;
  onOpenOne: () => void;
  onFinishOne: () => void;
}) {
  const { pets } = useStore();
  const [note, setNote] = useState(item.note ?? '');
  const [photo, setPhoto] = useState<string | undefined>(item.photo);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  /** 一件的重量：库存里存的是总克数，这里按件数还原成单件显示 */
  const pieces = Math.max(1, item.count ?? 1);
  const perUnit = Math.round((item.quantity / pieces) * 100) / 100;
  const openedSuggestion = openedExpirySuggestion(sku, item.openedAt || todayIso());
  /**
   * 名称用非受控输入 + ref：部分安卓输入法不会触发 React 的 change 事件，
   * 提交时一律以输入框里的实际内容为准，失焦、回车、点保存都能落盘。
   */
  const nameRef = useRef<HTMLInputElement | null>(null);
  const commitName = () => {
    const value = (nameRef.current?.value ?? '').trim();
    if (!value) return;
    onRenameSku(value);
  };
  // 背标照片存在 IndexedDB，按 id 取；老数据里内联的直接用
  useEffect(() => {
    let cancelled = false;
    if (item.photo) {
      setPhoto(item.photo);
    } else if (item.photoId) {
      setPhoto(undefined);
      void getPhoto(item.photoId).then((data) => {
        if (!cancelled) setPhoto(data);
      });
    } else {
      setPhoto(undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [item.photo, item.photoId]);
  const { soonDays, watchDays } = statusThresholds(sku?.shelfLifeText);
  const status = statusOf(item.expiryDate, soonDays, watchDays);
  const left = daysUntil(item.expiryDate);
  const feedingPet = item.petId ? pets.find((pet) => pet.id === item.petId) : pets[0];
  const packagePlan = feedingPet ? pkgStats(sku, feedingPet) : undefined;

  return (
    <Sheet
      title={sku?.name || '未命名商品'}
      subtitle={sku ? `${sku.brand} · ${sku.manufacturer}` : `${item.gtin || '无条码'} · 还没有商品档案`}
      onClose={onClose}
      footer={
        <div className="foot-actions">
          <button type="button" className="btn btn-ghost" onClick={onOpenOne}>
            {item.count && item.count > 1 ? '开封扣 1 件' : item.openedAt ? '更新开封日' : '记录开封'}
          </button>
          <button type="button" className="btn btn-primary" onClick={onFinishOne}>
            <Check size={16} />
            {item.count && item.count > 1 ? '用完扣 1 件' : '已用完'}
          </button>
        </div>
      }
    >
      <div className="detail-head">
        <div className="thumb-row">
          <BrandTile label={sku?.iconLabel} brand={sku?.brand} name={sku?.name} />
          <span className="mono muted small">{item.gtin || '无条码'}</span>
        </div>
        <StatusPill status={status} />
      </div>

      {photo ? (
        <div className="photo-strip">
          <img src={photo} alt="背标原图" />
          <span className="muted small">背标原图</span>
        </div>
      ) : null}

      <Field
        label="商品名称"
        hint={sku ? '改的是商品档案，同款商品的记录一起更新' : '这条记录还没有商品档案，改名会顺手建一个'}
      >
        <div className="inline">
          <TextInput
            ref={nameRef}
            defaultValue={sku?.name ?? ''}
            placeholder="例如 麦富迪 全价冻干双拼猫粮"
            // 边打边存（输入法正常触发时），另外失焦 / 回车 / 点按钮都会按输入框里的内容存一次
            onChange={(event) => onRenameSku(event.target.value.trim())}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
            }}
          />
          <button type="button" className="btn btn-outline btn-sm" onClick={commitName}>
            保存名称
          </button>
        </div>
      </Field>

      <div className="kv-grid">
        <div className="kv">
          <span className="kv-key">生产日期</span>
          <span className="kv-val">{formatCn(item.productionDate)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">到期日</span>
          <span className="kv-val">{formatCn(item.expiryDate)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">剩余</span>
          <span className="kv-val">{remainingText(item.expiryDate)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">保质期</span>
          <span className="kv-val">{sku?.shelfLifeText || '未记录'}</span>
        </div>
        <div className="kv">
          <span className="kv-key">开封日</span>
          <span className="kv-val">{formatCn(item.openedAt)}</span>
        </div>
        <div className="kv">
          <span className="kv-key">添加日期</span>
          <span className="kv-val">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>

      <div className="field-row">
        <Field label="一件的重量" hint={pieces > 1 ? `${pieces} 件共 ${item.quantity}${item.unit}` : '列表里按总克数显示'}>
          <div className="inline">
            <TextInput
              value={perUnit ? String(perUnit) : ''}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => {
                const each = Math.max(0, Number(event.target.value.replace(/[^\d.]/g, '')) || 0);
                onPatch({ quantity: Math.round(each * pieces * 100) / 100 });
              }}
            />
            <TextInput
              className="input-narrow"
              value={item.unit}
              aria-label="单位"
              onChange={(event) => onPatch({ unit: event.target.value })}
            />
          </div>
        </Field>
        <Field label="件数" hint="一袋/一罐算一件">
          <Stepper
            value={item.count ?? 1}
            onChange={(next) => {
              // 改件数时按单件克数同步总克数，避免单件克数被悄悄改掉
              const current = item.count ?? 1;
              const perUnit = current > 0 ? item.quantity / current : item.quantity;
              onPatch({ count: next, quantity: Math.round(perUnit * next * 100) / 100 });
            }}
            min={1}
            max={99}
            suffix="件"
          />
        </Field>
      </div>
      <Field label="存放位置">
        <TextInput value={item.location} onChange={(event) => onPatch({ location: event.target.value })} />
      </Field>

      {packagePlan && feedingPet ? (
        <div className="kv">
          <span className="kv-key">喂养计划</span>
          <span className="kv-val">
            按 {feedingPet.name} 的食量（约 {packagePlan.dailyGrams}g/天），这一包{packagePlan.displayDays}
          </span>
          <span className="muted tiny">
            整包 {packagePlan.packageGrams}g · {packagePlan.totalKcal} kcal
          </span>
        </div>
      ) : null}

      {pets.length ? (
        <Field label="归属宠物" hint="家庭公共 = 所有宠物共用">
          <select
            className="input"
            value={item.petId ?? ''}
            onChange={(event) => onPatch({ petId: event.target.value || undefined })}
          >
            <option value="">家庭公共</option>
            {pets.map((pet) => (
              <option key={pet.id} value={pet.id}>
                {pet.avatar || '🐱'} {pet.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="field-row">
        <Field label="生产日期">
          <TextInput
            type="date"
            value={item.productionDate ?? ''}
            onChange={(event) => {
              const productionDate = event.target.value;
              const life = parseShelfLife(
                sku?.shelfLifeMonths ? `${sku.shelfLifeMonths}个月` : sku?.shelfLifeText,
              );
              const calculated = !item.expiryHumanConfirmed
                ? expiryFrom(productionDate, life)
                : undefined;
              onPatch({
                productionDate,
                ...(calculated ? { expiryDate: calculated } : {}),
              });
            }}
          />
        </Field>
        <Field label="到期日">
          <TextInput
            type="date"
            value={item.expiryDate ?? ''}
            onChange={(event) =>
              onPatch({
                expiryDate: event.target.value,
                expiryHumanConfirmed: true,
              })
            }
          />
        </Field>
      </div>
      <Field label="开封日" hint="点「记录开封」会填今天，也可以直接选">
        <TextInput
          type="date"
          value={item.openedAt ?? ''}
          onChange={(event) => onPatch({ openedAt: event.target.value })}
        />
      </Field>
      {sku ? (
        <Field
          label="开封后到期日"
          hint={
            CATEGORY_META[categoryOf(sku)].openedDays
              ? `${CATEGORY_META[categoryOf(sku)].label}预设开封效期 ${CATEGORY_META[categoryOf(sku)].openedDays} 天，可以改`
              : '该分类不按开封效期管理'
          }
        >
          <TextInput
            type="date"
            value={item.openedExpiryDate ?? ''}
            onChange={(event) => onPatch({ openedExpiryDate: event.target.value })}
          />
        </Field>
      ) : null}
      {item.openedAt && !item.openedExpiryDate && openedSuggestion ? (
        <button
          type="button"
          className="btn btn-ghost btn-block btn-sm"
          onClick={() => onPatch({ openedExpiryDate: openedSuggestion })}
        >
          按分类填入开封效期 {openedSuggestion}
        </button>
      ) : null}
      {left !== undefined && left < 0 ? <p className="notice notice-error">该记录已过期 {Math.abs(left)} 天，建议核对实物。</p> : null}
      {item.productionDate && item.expiryDate && item.expiryDate < item.productionDate ? (
        <p className="notice notice-error">
          到期日（{formatCn(item.expiryDate)}）早于生产日期（{formatCn(item.productionDate)}），这两项至少有一个填错了。
        </p>
      ) : null}

      <Field label="备注">
        <TextArea
          ref={noteRef}
          rows={2}
          value={note}
          placeholder="选填"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => onPatch({ note: noteRef.current?.value ?? note })}
        />
      </Field>

      <div className="block">
        <p className="block-label">标签要点</p>
        <div className="chips">
          {sku?.category === 'dry' ? <Chip>干粮</Chip> : null}
          {sku?.category === 'wet' ? <Chip tone="info">湿粮</Chip> : null}
          {sku?.storage ? <Chip tone="neutral">{sku.storage}</Chip> : null}
          {sku?.standardCode ? <Chip tone="neutral">{sku.standardCode}</Chip> : null}
          {sku?.allergens.map((item2) => (
            <Chip key={item2} tone="warn">
              {item2}
            </Chip>
          ))}
        </div>
      </div>

      <button type="button" className="btn btn-outline btn-block" onClick={onEditSku}>
        <Pencil size={16} />
        编辑商品档案
      </button>
      <button type="button" className="btn btn-danger btn-block" onClick={onRemove}>
        <Trash2 size={16} />
        删除这条记录
      </button>
      <p className="disclaimer">
        件数大于 1 时，开封/用完每次只扣 1 件，剩下的继续留在库存；用完的那件按开封到用完的天数归档到消耗页。
      </p>
      <p className="disclaimer">
        <Check size={14} /> 商品级字段（品牌、厂家、配料表）在商品库中按条码复用，修改后所有同款商品记录同步更新。
      </p>
    </Sheet>
  );
}
