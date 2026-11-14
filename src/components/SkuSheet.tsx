import { useMemo, useRef, useState } from 'react';
import { Check, CopyPlus, Trash2 } from 'lucide-react';
import type { Sku } from '../types';
import { describeScCode, isValidGtin, isValidScCode, makeInternalGtin, normalizeGtin, normalizeScCode } from '../lib/gtin';
import { completenessOf } from '../lib/parse';
import { refreshSku } from '../lib/sku';
import { Chip, Field, Notice, Segmented, Sheet, TextArea, TextInput } from './ui';
import { ManufacturerField } from './ManufacturerPicker';
import { CATEGORY_META, CATEGORY_ORDER, FOOD_CATEGORIES, parsePackageGrams } from '../lib/pets';

export function SkuSheet({
  sku,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  sku: Sku;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: Sku) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Sku>(sku);
  const live = useMemo(() => refreshSku(draft), [draft]);
  const completeness = completenessOf(live);
  const patch = (next: Partial<Sku>) => setDraft((current) => ({ ...current, ...next }));
  /** 保存时以表单里的实际内容为准：安卓上有些输入法不触发 change 事件 */
  const formRef = useRef<HTMLFormElement | null>(null);
  /** 表单里的实际内容 + 派生字段，保存和「另存新版本」都用它 */
  const collect = (): Sku => {
    const data = formRef.current ? new FormData(formRef.current) : undefined;
    const read = (key: string): string | undefined => {
      const value = data?.get(key);
      return typeof value === 'string' ? value : undefined;
    };
    const text = (key: string, fallback = '') => (read(key) ?? fallback).trim();
    return refreshSku({
      ...live,
      gtin: normalizeGtin(read('gtin') ?? live.gtin),
      name: text('name', live.name),
      brand: text('brand', live.brand),
      brandOwner: text('brandOwner', live.brandOwner),
      iconLabel: text('iconLabel', live.iconLabel ?? '') || undefined,
      manufacturer: text('manufacturer', live.manufacturer),
      scCode: normalizeScCode(read('scCode') ?? live.scCode),
      standardCode: text('standardCode', live.standardCode ?? ''),
      storage: text('storage', live.storage ?? ''),
      ingredientsRaw: read('ingredientsRaw') ?? live.ingredientsRaw,
      packageGrams: parsePackageGrams(read('packageGrams') ?? live.packageGrams),
    });
  };

  /** 新增档案留空条码时补一个内部码：多条空条码档案会互相覆盖，改名字也会串档。 */
  const save = () => {
    const next = collect();
    onSave({ ...next, gtin: next.gtin.trim() || (isNew ? makeInternalGtin() : next.gtin) });
  };

  return (
    <Sheet
      title={isNew ? '新增商品档案' : '编辑商品档案'}
      subtitle={`版本 v${draft.version} · 完整度 ${completeness}%`}
      onClose={onClose}
      footer={
        <div className="foot-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            <Check size={16} />
            保存
          </button>
        </div>
      }
    >
      <form ref={formRef} onSubmit={(event) => event.preventDefault()}>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${completeness}%` }} />
      </div>

      {isNew ? (
        <Field
          label="商品条码（GTIN）"
          hint={
            draft.gtin
              ? isValidGtin(draft.gtin)
                ? '校验位通过，作为档案索引'
                : '校验位不通过'
              : '扫描得到的条码，用来在下次录入时匹配这份档案；留空会自动生成内部码，避免多条无码档案互相覆盖'
          }
        >
          <TextInput
            name="gtin"
            value={draft.gtin}
            inputMode="numeric"
            onChange={(event) => patch({ gtin: normalizeGtin(event.target.value) })}
          />
        </Field>
      ) : (
        <div className="kv">
          <span className="kv-key">条码（档案索引，不可修改）</span>
          <span className="kv-val mono">{draft.gtin || '无'}</span>
        </div>
      )}
      <Field label="商品名称">
        <TextInput name="name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>
      <Field label="品牌">
        <TextInput name="brand" value={draft.brand} onChange={(event) => patch({ brand: event.target.value })} />
      </Field>
      <Field label="品牌商 / 委托方" hint="品牌方、委托方、出品方或经销商；不是实际生产工厂">
        <TextInput
          name="brandOwner"
          value={draft.brandOwner}
          placeholder="例如 某某品牌管理有限公司"
          onChange={(event) => patch({ brandOwner: event.target.value })}
        />
      </Field>
      <Field label="图标文字" hint="列表图标上显示的字，最多 4 个；留空就用品牌名">
        <TextInput
          name="iconLabel"
          value={draft.iconLabel ?? ''}
          placeholder="品牌缩写，最多 4 字"
          onChange={(event) => patch({ iconLabel: event.target.value.slice(0, 4) })}
        />
      </Field>
      <ManufacturerField
        value={draft.manufacturer}
        hint="填真正生产的工厂；包装上的品牌方 / 委托方 / 经销商不算生产商"
        onChange={(next) => patch({ manufacturer: next })}
      />
      <div className="block">
        <p className="block-label">类型</p>
        <Segmented
          value={draft.category ?? 'other'}
          onChange={(value) => patch({ category: value })}
          options={CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_META[value].short }))}
        />
      </div>
      {draft.category && FOOD_CATEGORIES.includes(draft.category as never) ? (
        <div className="block">
          <p className="block-label">用途（主食 / 零食）</p>
          <Segmented
            value={draft.kind ?? 'staple'}
            onChange={(value) => patch({ kind: value })}
            options={[
              { value: 'staple', label: '主食' },
              { value: 'snack', label: '零食' },
            ]}
          />
        </div>
      ) : null}
      <div className="field-row">
        <Field label="SC 编号" hint={isValidScCode(draft.scCode) ? describeScCode(draft.scCode) : undefined}>
          <TextInput
            name="scCode"
            value={draft.scCode ?? ''}
            onChange={(event) => patch({ scCode: normalizeScCode(event.target.value) })}
          />
        </Field>
        <Field label="产品标准代号">
          <TextInput
            name="standardCode"
            value={draft.standardCode ?? ''}
            onChange={(event) => patch({ standardCode: event.target.value })}
          />
        </Field>
      </div>
      <Field label="贮存条件">
        <TextInput name="storage" value={draft.storage ?? ''} onChange={(event) => patch({ storage: event.target.value })} />
      </Field>
      <Field label="净含量（克）" hint="单包净含量；乘法规格只填单包克重">
        <TextInput
          name="packageGrams"
          value={draft.packageGrams ? String(draft.packageGrams) : ''}
          inputMode="decimal"
          placeholder="例如 1500"
          onChange={(event) =>
            patch({ packageGrams: parsePackageGrams(event.target.value.replace(/[^\d.]/g, '')) })
          }
        />
      </Field>
      <Field label="配料表原文" hint={`${live.ingredients.length} 项`}>
        <TextArea
          name="ingredientsRaw"
          rows={4}
          value={draft.ingredientsRaw}
          onChange={(event) => patch({ ingredientsRaw: event.target.value })}
        />
      </Field>

      <div className="block">
        <p className="block-label">添加剂（{live.additives.length}）</p>
        <div className="chips">
          {live.additives.length ? live.additives.map((item) => <Chip key={item}>{item}</Chip>) : <span className="muted small">无</span>}
        </div>
      </div>
      <div className="block">
        <p className="block-label">致敏物质（{live.allergens.length}）</p>
        <div className="chips">
          {live.allergens.length ? (
            live.allergens.map((item) => (
              <Chip key={item} tone="warn">
                {item}
              </Chip>
            ))
          ) : (
            <span className="muted small">无</span>
          )}
        </div>
      </div>

      {!isNew ? (
        <button
          type="button"
          className="btn btn-outline btn-block"
          onClick={() => onSave({ ...collect(), version: live.version + 1, updatedAt: Date.now() })}
        >
          <CopyPlus size={16} />
          配方变更，另存为 v{live.version + 1}
        </button>
      ) : (
        <Notice level="warn">新增档案请优先录入条码、厂名与配料表，其余字段可后补。</Notice>
      )}

      {!isNew && onDelete ? (
        <button type="button" className="btn btn-danger btn-block" onClick={onDelete}>
          <Trash2 size={16} />
          删除这个商品档案
        </button>
      ) : null}
      </form>
    </Sheet>
  );
}
