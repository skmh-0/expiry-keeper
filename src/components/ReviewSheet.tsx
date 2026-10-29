import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Info } from 'lucide-react';
import type { PantryItem, PetCategory, RecognizeOutcome, Sku } from '../types';
import { buildChecks, extractDateFromPhoto } from '../lib/engine';
import { describeScCode, isValidGtin, isValidScCode, licenseKind, normalizeGtin, normalizeScCode } from '../lib/gtin';
import { refreshSku } from '../lib/sku';
import { expiryFrom, formatCn, parseShelfLife } from '../lib/shelfLife';
import { downscale, readAsDataUrl } from '../lib/image';
import { captureNativePhoto, isNative } from '../lib/native';
import { useStore } from '../lib/store';
import { BrandTile } from './BrandTile';
import { Chip, Field, Notice, Segmented, Sheet, Stepper, TextInput, TextArea } from './ui';
import { ManufacturerField } from './ManufacturerPicker';
import { CATEGORY_META, FOOD_CATEGORIES, parsePackageGrams } from '../lib/pets';

const LOW = 0.75;

type Hint = { text: string; tone: 'ok' | 'warn' | 'error' };

export function ReviewSheet({
  outcome,
  photo,
  initialProduction,
  initialExpiry,
  onCancel,
  onConfirm,
}: {
  outcome: RecognizeOutcome;
  photo?: string;
  initialProduction?: string;
  initialExpiry?: string;
  onCancel: () => void;
  onConfirm: (payload: { sku: Sku; item: PantryItem }) => void;
}) {
  const { settings, pets, activePetId } = useStore();
  const [selectedPetId, setSelectedPetId] = useState(activePetId || '');
  // 没识别出分类时默认干粮（宠物粮最常见），用户可以改
  const [draft, setDraft] = useState<Sku>(() => ({
    ...outcome.sku,
    category: outcome.sku.category ?? 'dry',
  }));
  const [productionDate, setProductionDate] = useState(initialProduction ?? '');
  const [expiryDate, setExpiryDate] = useState(initialExpiry ?? '');
  // 模型直接读到「保质期至」时，不要再被推算值覆盖
  const [expiryTouched, setExpiryTouched] = useState(Boolean(initialExpiry));
  const [expiryHumanConfirmed, setExpiryHumanConfirmed] = useState(false);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('克');
  const [count, setCount] = useState(1);
  // 存放位置默认留空，由用户自己填
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [dateHint, setDateHint] = useState<Hint | null>(null);
  const [dateBusy, setDateBusy] = useState(false);
  /** 点确认时把「还差什么」说清楚，而不是把按钮静默禁用 */
  const [formError, setFormError] = useState<string[]>([]);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  /** 入库时按这张表单里的实际内容取值，不依赖 React state 是否同步 */
  const formRef = useRef<HTMLFormElement | null>(null);

  const life = useMemo(() => parseShelfLife(draft.shelfLifeText), [draft.shelfLifeText]);

  useEffect(() => {
    if (expiryTouched) return;
    const next = expiryFrom(productionDate, life);
    setExpiryDate(next ?? '');
  }, [productionDate, life, expiryTouched]);

  const liveSku = useMemo(() => refreshSku(draft), [draft]);
  const checks = useMemo(
    () => buildChecks(liveSku, { gtin: liveSku.gtin, productionDate, expiryDate }),
    [liveSku, productionDate, expiryDate],
  );

  const low = (key: string) => (draft.confidence?.[key] ?? 1) < LOW;
  const patch = (next: Partial<Sku>) => setDraft((current) => ({ ...current, ...next }));
  const grams = Number(amount);
  const amountOk = Number.isFinite(grams) && grams > 0;

  const applyDateReading = async (dataUrl: string) => {
    setDateBusy(true);
    setDateHint({ text: '正在读取喷码…', tone: 'warn' });
    try {
      const closeup = await downscale(dataUrl, 1600, 0.85);
      const reading = await extractDateFromPhoto(settings, closeup);
      if (!reading.productionDate && !reading.expiryDate) {
        setDateHint({
          text: `没读到清晰的日期${reading.raw ? `，模型看到的是「${reading.raw}」` : ''}，请按包装手动填写`,
          tone: 'warn',
        });
        return;
      }
      if (reading.productionDate) {
        setProductionDate(reading.productionDate);
        setExpiryTouched(false);
        setExpiryHumanConfirmed(false);
      }
      if (reading.expiryDate) {
        setExpiryTouched(true);
        setExpiryHumanConfirmed(false);
        setExpiryDate(reading.expiryDate);
      }
      setDateHint({
        text: `已识别：${[reading.productionDate && `生产日期 ${reading.productionDate}`, reading.expiryDate && `到期日 ${reading.expiryDate}`]
          .filter(Boolean)
          .join('，')}`,
        tone: 'ok',
      });
    } catch (error) {
      setDateHint({ text: error instanceof Error ? error.message : '识别喷码失败', tone: 'error' });
    } finally {
      setDateBusy(false);
    }
  };

  const captureDate = async () => {
    setDateHint(null);
    if (isNative()) {
      try {
        const native = await captureNativePhoto();
        if (native) await applyDateReading(native);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (/cancel/i.test(reason)) return;
        setDateHint({ text: '调用相机失败，可改用相册选择', tone: 'error' });
        return;
      }
    }
    dateInputRef.current?.click();
  };

  /**
   * 入库时以表单里的实际内容为准：安卓上有些输入法不触发 change 事件，
   * 只信 React state 会把用户改过的品牌名、名称又写回旧值。
   */
  const readForm = () => {
    const data = formRef.current ? new FormData(formRef.current) : undefined;
    return (key: string): string | undefined => {
      const value = data?.get(key);
      return typeof value === 'string' ? value : undefined;
    };
  };

  const confirm = () => {
    const read = readForm();
    const text = (key: string, fallback = '') => (read(key) ?? fallback).trim();
    // 页面上填的克数是「一件」的克数，入库总数要乘件数
    const perUnit = Math.max(0, Number(read('amount') ?? amount) || 0);
    const pieces = Math.max(1, Math.round(Number(read('count') ?? count) || count || 1));
    const production = (read('productionDate') ?? productionDate) || '';
    const expiry = (read('expiryDate') ?? expiryDate) || '';
    const nameValue = text('name', draft.name);

    // 硬校验：缺什么就说清楚，日期矛盾直接拦住
    const problems: string[] = [];
    if (!nameValue) problems.push('商品名称还没填');
    if (!perUnit) problems.push('「一件的重量」还没填（克）');
    if (production && expiry && expiry < production) {
      problems.push(`到期日（${expiry}）早于生产日期（${production}），请核对包装后再入库`);
    }
    if (problems.length) {
      setFormError(problems);
      window.requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    setFormError([]);

    const skuFields: Partial<Sku> = {
      iconLabel: text('iconLabel', draft.iconLabel ?? '') || undefined,
      gtin: normalizeGtin(read('gtin') ?? draft.gtin),
      name: nameValue,
      brand: text('brand', draft.brand),
      manufacturer: text('manufacturer', draft.manufacturer),
      scCode: normalizeScCode(read('scCode') ?? draft.scCode),
      standardCode: text('standardCode', draft.standardCode ?? ''),
      ingredientsRaw: read('ingredientsRaw') ?? draft.ingredientsRaw,
      storage: text('storage', draft.storage ?? ''),
      shelfLifeText: text('shelfLifeText', draft.shelfLifeText ?? ''),
      packageGrams: parsePackageGrams(read('packageGrams') ?? draft.packageGrams),
      nutrition: {
        metabolizableEnergy: text('nutrition.metabolizableEnergy', draft.nutrition?.metabolizableEnergy ?? ''),
        crudeProtein: text('nutrition.crudeProtein', draft.nutrition?.crudeProtein ?? ''),
        crudeFat: text('nutrition.crudeFat', draft.nutrition?.crudeFat ?? ''),
        crudeFiber: text('nutrition.crudeFiber', draft.nutrition?.crudeFiber ?? ''),
        crudeAsh: text('nutrition.crudeAsh', draft.nutrition?.crudeAsh ?? ''),
        moisture: text('nutrition.moisture', draft.nutrition?.moisture ?? ''),
        taurine: text('nutrition.taurine', draft.nutrition?.taurine ?? ''),
        calciumPhosphorus: text('nutrition.calciumPhosphorus', draft.nutrition?.calciumPhosphorus ?? ''),
      },
    };
    const category = skuFields.category ?? liveSku.category;
    const food = category ? FOOD_CATEGORIES.includes(category as PetCategory) : false;
    // 食品默认按「主食」保存，用户可以在上面的用途里改成零食
    const sku: Sku = refreshSku({
      ...liveSku,
      ...skuFields,
      kind: food ? liveSku.kind ?? 'staple' : undefined,
    });
    const item: PantryItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      gtin: sku.gtin,
      productionDate: production || undefined,
      expiryDate: expiry || undefined,
      expiryHumanConfirmed,
      quantity: Math.round(perUnit * pieces * 100) / 100,
      unit: (read('unit') ?? unit).trim() || '克',
      count: pieces,
      location: text('location', location),
      petId: selectedPetId || undefined,
      note: text('note', note) || undefined,
      photo,
      createdAt: Date.now(),
    };
    onConfirm({ sku, item });
  };

  const scHint = draft.scCode
    ? licenseKind(draft.scCode) === 'food'
      ? describeScCode(draft.scCode)
      : licenseKind(draft.scCode) === 'feed'
        ? '饲料生产许可证编号'
        : '格式未识别，请核对包装'
    : '包装上的生产许可证编号，建议补录';

  const category = draft.category && draft.category !== 'other' ? (draft.category as PetCategory) : undefined;
  const isFood = category ? FOOD_CATEGORIES.includes(category) : false;
  const foodRowValue = isFood ? category ?? '' : '';
  const nonFoodRowValue = category === 'medicine' || category === 'supplies' ? category : '';

  return (
    <Sheet
      title="确认识别结果"
      subtitle={
        outcome.engine === 'library'
          ? '来源：商品查询库 · 仍需按包装核对后入库'
          : outcome.engine === 'api'
          ? '来源：视觉模型 · 入库前请按包装核对带「待核对」的字段'
          : '来源：手工录入 · 请按包装填写商品信息'
      }
      onClose={onCancel}
      footer={
        <div>
          {formError.length ? (
            <div ref={errorRef}>
              <Notice level="error">{`还不能入库：${formError.join('；')}`}</Notice>
            </div>
          ) : null}
          <div className="foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm}>
              <Check size={16} />
              确认入库
            </button>
          </div>
        </div>
      }
    >
      <form ref={formRef} onSubmit={(event) => event.preventDefault()}>
      {outcome.notices.map((text) => (
        <Notice key={text} level="warn">
          {text}
        </Notice>
      ))}

      {outcome.verified ? (
        <Notice level={outcome.unclear?.length ? 'warn' : 'ok'}>
          {`已复验（放大重读）${outcome.corrected?.length ? ` · 修正了 ${outcome.corrected.join('、')}` : ' · 第一遍结果没被推翻'}`}
          {outcome.unclear?.length ? ` · 仍没读清：${outcome.unclear.join('、')}，请按包装核对或补拍` : ''}
        </Notice>
      ) : null}

      <div className="thumb-row">
        <BrandTile label={draft.iconLabel} brand={draft.brand} name={draft.name} size="lg" />
        <div className="thumb-text">
          <Field label="图标文字" hint="列表图标上显示的字，最多 4 个；留空就用品牌名">
            <TextInput
              name="iconLabel"
              value={draft.iconLabel ?? ''}
              placeholder="品牌缩写，最多 4 字"
              onChange={(event) => patch({ iconLabel: event.target.value.slice(0, 4) })}
            />
          </Field>
        </div>
      </div>

      {photo ? (
        <div className="photo-strip">
          <img src={photo} alt="背标原图" />
          <span className="muted small">标签原图随记录留档（不作为列表图标）</span>
        </div>
      ) : null}

      <h3 className="section-title">商品信息</h3>
      <Field
        label="商品条码（GTIN）"
        hint={
          !draft.gtin
            ? '扫到的条码，也可以按包装手工填写'
            : isValidGtin(draft.gtin)
              ? '条码校验位通过'
              : '条码校验位不通过，请核对这串数字（和日期、重量无关）'
        }
      >
        <TextInput
          name="gtin"
          value={draft.gtin}
          inputMode="numeric"
          placeholder="例如 6901234567892"
          onChange={(event) => patch({ gtin: normalizeGtin(event.target.value) })}
        />
      </Field>
      <div className="field-row">
        <Field label="商品名称" required flag={low('name')}>
          <TextInput name="name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="品牌" flag={low('brand')}>
          <TextInput name="brand" value={draft.brand} onChange={(event) => patch({ brand: event.target.value })} />
        </Field>
      </div>
      <ManufacturerField
        value={draft.manufacturer}
        flag={low('manufacturer')}
        hint="填真正生产的工厂；包装上的品牌方 / 委托方 / 经销商不算生产商"
        onChange={(next) => patch({ manufacturer: next })}
      />
      {pets.length ? (
        <div className="block">
          <p className="block-label">这只商品归谁</p>
          <Segmented<string>
            value={selectedPetId || 'shared'}
            onChange={(value) => setSelectedPetId(value === 'shared' ? '' : value)}
            options={[
              { value: 'shared', label: '家庭公共' },
              ...pets.map((pet) => ({ value: pet.id, label: pet.name })),
            ]}
          />
        </div>
      ) : null}
      <div className="block">
        <p className="block-label">分类 · 食品</p>
        <Segmented<string>
          value={foodRowValue}
          onChange={(value) => patch({ category: value as PetCategory, kind: draft.kind ?? 'staple' })}
          options={FOOD_CATEGORIES.map((value) => ({ value, label: CATEGORY_META[value].short }))}
        />
        <p className="block-label" style={{ marginTop: 8 }}>
          分类 · 非食品
        </p>
        <Segmented<string>
          value={nonFoodRowValue}
          onChange={(value) => patch({ category: value as PetCategory, kind: undefined })}
          options={[
            { value: 'medicine', label: CATEGORY_META.medicine.short },
            { value: 'supplies', label: CATEGORY_META.supplies.short },
          ]}
        />
      </div>
      {isFood ? (
        <div className="block">
          <p className="block-label">用途</p>
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
        <Field label="生产许可证编号" hint={scHint} flag={!isValidScCode(draft.scCode) && licenseKind(draft.scCode) !== 'feed'}>
          <TextInput
            name="scCode"
            value={draft.scCode ?? ''}
            placeholder="SC... 或 鲁饲证(2023)02713"
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
      <Field label="保质期" flag={low('shelfLifeText')} hint={life ? `约 ${life.days} 天` : '未识别出天数'}>
        <TextInput
          name="shelfLifeText"
          value={draft.shelfLifeText ?? ''}
          placeholder="例如 12个月"
          onChange={(event) => patch({ shelfLifeText: event.target.value })}
        />
      </Field>
      <Field
        label="净含量（克）"
        flag={low('packageGrams')}
        hint="包装上标注的单包净含量，例如 1500；500g×6包 填 500"
      >
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
      <Field label="贮存条件">
        <TextInput name="storage" value={draft.storage ?? ''} onChange={(event) => patch({ storage: event.target.value })} />
      </Field>

      <h3 className="section-title">配料表</h3>
      <Field label="配料表原文" flag={low('ingredientsRaw')} hint={`切分为 ${liveSku.ingredients.length} 项，按含量降序排列`}>
        <TextArea
          name="ingredientsRaw"
          rows={4}
          value={draft.ingredientsRaw}
          placeholder="水、白砂糖、食品添加剂（…）"
          onChange={(event) => patch({ ingredientsRaw: event.target.value })}
        />
      </Field>
      <div className="block">
        <p className="block-label">规则识别的添加剂（{liveSku.additives.length}）</p>
        <div className="chips">
          {liveSku.additives.length ? (
            liveSku.additives.map((item) => <Chip key={item}>{item}</Chip>)
          ) : (
            <span className="muted small">未匹配到常见添加剂名称</span>
          )}
        </div>
      </div>
      <div className="block">
        <p className="block-label">规则推测的致敏物质（{liveSku.allergens.length}）</p>
        <div className="chips">
          {liveSku.allergens.length ? (
            liveSku.allergens.map((item) => (
              <Chip key={item} tone="warn">
                {item}
              </Chip>
            ))
          ) : (
            <span className="muted small">未匹配到常见致敏物质</span>
          )}
        </div>
      </div>

      <h3 className="section-title">营养成分表</h3>
      <div className="nutrition-grid">
        {(
          [
            ['metabolizableEnergy', '代谢能'],
            ['crudeProtein', '粗蛋白'],
            ['crudeFat', '粗脂肪'],
            ['crudeFiber', '粗纤维'],
            ['crudeAsh', '粗灰分'],
            ['moisture', '水分'],
            ['taurine', '牛磺酸'],
            ['calciumPhosphorus', '钙磷比'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <TextInput
              name={`nutrition.${key}`}
              value={draft.nutrition?.[key] ?? ''}
              placeholder={
                key === 'metabolizableEnergy'
                  ? '例如 4000 kcal/kg'
                  : key === 'calciumPhosphorus'
                    ? '例如 1.2:1'
                    : '例如 ≥38%'
              }
              onChange={(event) => patch({ nutrition: { ...draft.nutrition, [key]: event.target.value } })}
            />
          </Field>
        ))}
      </div>

      <h3 className="section-title">入库信息</h3>
      <div className="field-row">
        <Field label="生产日期" flag={!productionDate}>
          <TextInput
            name="productionDate"
            type="date"
            value={productionDate}
            onChange={(event) => setProductionDate(event.target.value)}
          />
        </Field>
        <Field
          label="到期日"
          hint={
            initialExpiry && expiryDate === initialExpiry
              ? '识别自包装标注'
              : expiryTouched
                ? '已手动指定'
                : life
                  ? '按生产日期 + 保质期 − 1 天推算'
                  : '缺少保质期，无法推算'
          }
        >
          <TextInput
            name="expiryDate"
            type="date"
            value={expiryDate}
            onChange={(event) => {
              setExpiryTouched(true);
              setExpiryHumanConfirmed(true);
              setExpiryDate(event.target.value);
            }}
          />
        </Field>
      </div>
      <button type="button" className="btn btn-outline btn-block" disabled={dateBusy} onClick={() => void captureDate()}>
        <Camera size={16} />
        {dateBusy ? '正在读取喷码…' : '补拍喷码日期（单独拍一张，识别更准）'}
      </button>
      {dateHint ? <Notice level={dateHint.tone}>{dateHint.text}</Notice> : null}
      {!productionDate && !dateHint ? (
        <Notice level="warn">喷码日期还没确认：可以点上面按钮单独拍一张，也可以直接手填生产日期。</Notice>
      ) : null}

      <Field
        label="一件的重量"
        required
        flag={!amountOk}
        hint={
          amountOk && count > 1
            ? `填的是一件多少克：${count} 件共 ${Math.round(Number(amount) * count * 100) / 100} 克`
            : '填一件多少克，件数在下面选，单位默认克'
        }
      >
        <div className="inline">
          <TextInput
            name="amount"
            value={amount}
            inputMode="decimal"
            placeholder="例如 100"
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
          />
          <TextInput
            name="unit"
            className="input-narrow"
            value={unit}
            aria-label="单位"
            onChange={(event) => setUnit(event.target.value)}
          />
        </div>
      </Field>
      <div className="field-row">
        <Field label="件数" hint={amountOk ? `共 ${Math.round(Number(amount) * count * 100) / 100} ${unit}` : '一袋/一罐算一件'}>
          <Stepper value={count} onChange={setCount} min={1} max={99} suffix="件" />
          <input type="hidden" name="count" value={count} readOnly />
        </Field>
        <Field label="存放位置" hint="自己填，可以留空">
          <TextInput
            name="location"
            value={location}
            placeholder="例如 厨房吊柜"
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>
      </div>
      <Field label="备注">
        <TextInput name="note" value={note} placeholder="选填" onChange={(event) => setNote(event.target.value)} />
      </Field>

      <h3 className="section-title">规则校验</h3>
      <ul className="check-list">
        {checks.map((check) => (
          <li key={check.text} className={`check check-${check.level}`}>
            {check.text}
          </li>
        ))}
      </ul>
      <p className="disclaimer">
        <Info size={14} /> 识别结果仅供记录与提醒，最终以包装实物标注为准。到期日推算自 {formatCn(productionDate)}。
      </p>

      </form>

      <input
        ref={dateInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readAsDataUrl(file).then(applyDateReading);
        }}
      />
    </Sheet>
  );
}
