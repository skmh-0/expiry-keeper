import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Scale, Trash2, Utensils } from 'lucide-react';
import type { FeedingLog, Pet, WeightUnit } from '../types';
import { useStore } from '../lib/store';
import {
  CATEGORY_META,
  categoryOf,
  dailyGrams,
  energyPlan,
  formatWeight,
  mealEnergy,
  parseMetabolizableEnergy,
  petAgeMonths,
  petStage,
  WEIGHT_UNITS,
  weightFromKg,
  weightToKg,
} from '../lib/pets';
import { dailyIntake } from '../lib/intake';
import { todayBudget } from '../lib/feedingBudget';
import { todayIso } from '../lib/shelfLife';
import { PetSheet } from '../components/PetSheet';
import { CatMascot } from '../components/Cat';
import { Chip, EmptyState, Field, Notice, Segmented, Sheet, TextInput } from '../components/ui';
import { PetAvatar } from '../components/PetAvatar';
import { VaccineBook } from '../components/VaccineBook';
import { DewormCard } from '../components/DewormCard';

const SPECIES_LABEL: Record<Pet['species'], string> = { cat: '猫', dog: '狗', other: '其他' };

const speciesText = (pet: Pet) => `${SPECIES_LABEL[pet.species]}${pet.breed ? ` · ${pet.breed}` : ''}`;

const ageText = (pet: Pet) => {
  const months = petAgeMonths(pet);
  if (months === undefined) return '出生日期未填';
  if (months < 12) return `${months} 个月`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} 岁 ${rest} 个月` : `${years} 岁`;
};

const newPet = (): Pet => ({
  id: `pet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '',
  species: 'cat',
  gender: 'unknown',
  neutered: undefined,
  weightUnit: 'jin',
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function PetScreen() {
  const { pets, activePetId, setActivePet, savePet, removePet, items, skus, feedings, addFeeding, removeFeeding } = useStore();
  const [editing, setEditing] = useState<{ pet: Pet; isNew: boolean } | null>(null);
  const [feedingOpen, setFeedingOpen] = useState(false);
  const [mealItemId, setMealItemId] = useState('');
  const [mealGrams, setMealGrams] = useState('');
  const [mealDate, setMealDate] = useState(todayIso());
  const [mealNote, setMealNote] = useState('');
  const [meText, setMeText] = useState('4000');
  const [meTouched, setMeTouched] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('jin');
  const [weightText, setWeightText] = useState('');

  const pet = pets.find((candidate) => candidate.id === activePetId) ?? pets[0];
  const plan = useMemo(() => (pet ? energyPlan(pet) : undefined), [pet]);
  const parsedMe = Number(meText) || undefined;
  const recommended = dailyGrams(plan, parsedMe);

  // 切换宠物时，用一个合理的默认代谢能（有干粮标签就读标签，没有就 4000）
  useEffect(() => {
    setMeTouched(false);
  }, [pet?.id]);
  useEffect(() => {
    if (!pet || meTouched) return;
    const food = items
      .filter((item) => !item.finishedAt && (item.petId === pet.id || !item.petId))
      .map((item) => skus.find((sku) => sku.gtin === item.gtin))
      .find((sku) => sku && categoryOf(sku) === 'dry');
    const label = mealEnergy(food).fromLabel ? mealEnergy(food).me : 4000;
    setMeText(String(label));
  }, [pet, items, skus, meTouched]);

  const intake = useMemo(
    () => (pet ? dailyIntake(feedings, pet.id, recommended) : undefined),
    [feedings, pet, recommended],
  );
  const budget = useMemo(
    () => (pet ? todayBudget(pet, items, skus, feedings) : undefined),
    [feedings, items, pet, skus],
  );
  const weightValue = weightText.trim() === '' ? undefined : Number(weightText);
  const physicalWeightKg = weightToKg(weightValue ?? Number.NaN, weightUnit);
  const weightError =
    weightValue !== undefined && Number.isFinite(weightValue) && weightValue < 0
      ? '体重不能为负'
      : weightValue !== undefined && Number.isFinite(weightValue) && weightValue === 0
        ? '体重必须大于 0'
        : weightText.trim() && !Number.isFinite(weightValue)
          ? '请输入有效体重'
          : '';
  const overweightHint =
    physicalWeightKg !== undefined && physicalWeightKg > 100
      ? '体重超过 100kg，请确认单位是千克且没有多输一位'
      : '';

  const foodChoices = useMemo(() => {
    if (!pet) return [];
    return items.filter((item) => {
      if (item.finishedAt) return false;
      if (item.petId && item.petId !== pet.id) return false;
      const sku = skus.find((candidate) => candidate.gtin === item.gtin);
      return sku ? CATEGORY_META[categoryOf(sku)].food : false;
    });
  }, [items, pet, skus]);

  const petFeedings = useMemo(
    () => (pet ? feedings.filter((feeding) => feeding.petId === pet.id).slice(0, 8) : []),
    [feedings, pet],
  );

  const openFeeding = () => {
    setMealItemId(foodChoices[0]?.id ?? '');
    setMealGrams('');
    setMealDate(todayIso());
    setMealNote('');
    setFeedingOpen(true);
  };

  const submitFeeding = () => {
    if (!pet) return;
    const grams = Number(mealGrams);
    if (!Number.isFinite(grams) || grams <= 0) return;
    const item = items.find((candidate) => candidate.id === mealItemId);
    const log: FeedingLog = {
      id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      petId: pet.id,
      itemId: item?.id,
      gtin: item?.gtin,
      grams: Math.round(grams * 10) / 10,
      date: mealDate || todayIso(),
      note: mealNote.trim() || undefined,
      createdAt: Date.now(),
    };
    addFeeding(log);
    setFeedingOpen(false);
  };

  const openWeight = () => {
    if (!pet) return;
    const unit = pet.weightUnit ?? 'jin';
    setWeightUnit(unit);
    setWeightText(weightFromKg(pet.weightKg, unit)?.toString() ?? '');
    setWeightOpen(true);
  };

  const saveWeight = () => {
    if (!pet) return;
    const value = weightToKg(Number(weightText), weightUnit);
    if (value === undefined || value <= 0) return;
    savePet({ ...pet, weightKg: Math.round(value * 1000) / 1000, weightUnit });
    setWeightOpen(false);
  };

  const changeWeightUnit = (nextUnit: WeightUnit) => {
    const currentKg = weightToKg(Number(weightText), weightUnit);
    setWeightUnit(nextUnit);
    setWeightText(weightFromKg(currentKg, nextUnit)?.toString() ?? '');
  };

  if (!pets.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<CatMascot size={56} />}
          title="先建一只宠物档案"
          hint="填上体重和出生日期，就能算每天建议吃多少克，并按宠物管理库存"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ pet: newPet(), isNew: true })}>
              <Plus size={16} />
              添加宠物
            </button>
          }
        />
        {editing ? (
          <PetSheet
            pet={editing.pet}
            isNew={editing.isNew}
            onClose={() => setEditing(null)}
            onSave={(next) => {
              savePet(next);
              setEditing(null);
            }}
          />
        ) : null}
      </div>
    );
  }

  if (!pet) return null;

  const maxBar = Math.max(1, recommended ? recommended * 1.5 : 0, ...(intake?.days.map((day) => day.grams) ?? [0]));
  const stage = petStage(pet);
  const stageLabel = stage === 'young' ? '幼年' : stage === 'senior' ? '老年' : stage === 'adult' ? '成年' : '年龄未知';

  return (
    <div className="screen">
      <div className="pet-tabs">
        {pets.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`pet-tab ${candidate.id === pet.id ? 'on' : ''}`}
            onClick={() => setActivePet(candidate.id)}
          >
            <PetAvatar pet={candidate} size="sm" />
            {candidate.name}
          </button>
        ))}
        <button
          type="button"
          className="pet-tab pet-tab-add"
          aria-label="添加宠物"
          title="添加宠物"
          onClick={() => setEditing({ pet: newPet(), isNew: true })}
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="card pet-head">
        <PetAvatar pet={pet} size="lg" />
        <div className="pet-head-main">
          <div className="row-between pet-title-row">
            <p className="li-title">{pet.name}</p>
            <Chip tone={stage === 'young' ? 'info' : stage === 'senior' ? 'warn' : 'ok'}>
              {stageLabel} · {ageText(pet)}
            </Chip>
          </div>
          <p className="muted small">
            {speciesText(pet)}
          </p>
          <p className="muted tiny">
            {formatWeight(pet.weightKg, pet.weightUnit)} ·{' '}
            {pet.neutered === undefined ? '绝育未知' : pet.neutered ? '已绝育' : '未绝育'}
          </p>
        </div>
        <button type="button" className="btn-icon" aria-label="编辑宠物档案" title="编辑宠物档案" onClick={() => setEditing({ pet, isNew: false })}>
          <Pencil size={16} />
        </button>
      </div>

      <button type="button" className="btn btn-outline btn-block" onClick={openWeight}>
        <Scale size={16} />
        记录体重
        <span className="muted tiny">当前 {formatWeight(pet.weightKg, pet.weightUnit)}</span>
      </button>

      <VaccineBook pet={pet} />

      <h3 className="section-title">每日摄入目标</h3>
      <div className="card">
        {plan ? (
          <>
            <div className="stat-grid stat-grid-3">
              <div className="stat">
                <span className="stat-value">{Math.round(plan.rer)}</span>
                <span className="stat-label">RER（静息能量需求）</span>
              </div>
              <div className="stat">
                <span className="stat-value">{Math.round(plan.mer)}</span>
                <span className="stat-label">MER（每日维持需求）</span>
              </div>
              <div className="stat">
                <span className="stat-value stat-info">{recommended ?? '—'}</span>
                <span className="stat-label">克 / 天</span>
              </div>
            </div>
            <p className="muted tiny">
              RER 是静息能量需求，MER 是每日维持能量需求；已按当前体重、年龄和绝育状态计算。
              系数 {plan.factorLabel}；代谢能按 {parsedMe ?? '—'} kcal/kg 计算
              {recommended ? `，约 ${recommended} 克/天` : '，填代谢能后给出克数'}
            </p>
            <Field label="代谢能（kcal/kg）" hint={`没有标签时用分类均值：干粮 ${CATEGORY_META.dry.meKcalPerKg}`}>
              <TextInput
                value={meText}
                inputMode="decimal"
                placeholder="4000"
                onChange={(event) => {
                  setMeTouched(true);
                  setMeText(event.target.value.replace(/[^\d.]/g, ''));
                }}
              />
            </Field>
          </>
        ) : (
          <Notice level="warn">先填体重，才能计算 RER / MER。</Notice>
        )}
      </div>

      <h3 className="section-title">{pet.name} 的今日额度</h3>
      <div className={`card budget-card budget-${budget?.state ?? 'empty'}`}>
        {budget ? (
          <>
            <div className="row-between">
              <div>
                <p className="li-title">
                  {budget.state === 'over'
                    ? `今日额度已用完，超出 ${Math.abs(budget.remaining)} kcal`
                    : budget.state === 'low'
                      ? '额度不多啦'
                      : '今天还能吃'}
                </p>
                <p className="muted small">
                  每天可吃 {budget.limit} kcal（按当前体重、年龄、绝育状态计算）
                </p>
              </div>
              <Chip tone={budget.state === 'over' ? 'danger' : budget.state === 'low' ? 'warn' : 'ok'}>
                已吃 {budget.consumed} kcal
              </Chip>
            </div>
            <div className="stat-grid stat-grid-3">
              <div className="stat">
                <span className="stat-value">{budget.limit}</span>
                <span className="stat-label">今日额度 kcal</span>
              </div>
              <div className="stat">
                <span className="stat-value">{budget.consumed}</span>
                <span className="stat-label">已吃 kcal</span>
              </div>
              <div className={`stat ${budget.state === 'over' ? 'stat-danger' : budget.state === 'low' ? 'stat-warn' : 'stat-info'}`}>
                <span className="stat-value">{Math.max(0, budget.remaining)}</span>
                <span className="stat-label">还可吃 kcal</span>
              </div>
            </div>
            {budget.consumed === 0 ? (
              <p className="muted small">今天还没喂，全部 {budget.limit} kcal 都在等它。</p>
            ) : null}
            {budget.items.length ? (
              <div className="budget-foods">
                {budget.items.map((food) => (
                  <div className="budget-food" key={food.itemId}>
                    <span className="li-title">{food.skuName}</span>
                    <span className="amount">
                      {budget.remaining > 0 ? `还能吃约 ${food.canEatGrams}g` : '还能吃 0g'}
                    </span>
                    <span className="muted tiny">库存 {Math.round(food.gramsLeft * 10) / 10}g</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">当前没有带代谢能数据的食品库存，先补商品营养表。</p>
            )}
            {budget.uncounted.length ? (
              <Notice level="warn">
                {budget.uncounted.join('、')}未填营养成分，未计入今日额度
              </Notice>
            ) : null}
          </>
        ) : (
          <Notice level="warn">先填体重才能算每日额度。</Notice>
        )}
      </div>

      <h3 className="section-title">近 7 天投喂</h3>
      <div className="card">
        {intake ? (
          <>
            <div className="intake-bars">
              {intake.days.map((day) => (
                <div className="intake-bar" key={day.date}>
                  <span className="intake-bar-track">
                    <span
                      className={`intake-bar-fill ${day.logged ? '' : 'empty'}`}
                      style={{ height: `${Math.min(100, (day.grams / maxBar) * 100)}%` }}
                    />
                    {recommended ? (
                      <span
                        className="intake-bar-line"
                        style={{ bottom: `${Math.min(100, (recommended / maxBar) * 100)}%` }}
                      />
                    ) : null}
                  </span>
                  <span className="intake-bar-label">{day.date.slice(8)}</span>
                </div>
              ))}
            </div>
            <div className="row-between">
              <span className="small">合计 {intake.total} 克</span>
              <span className="muted small">日均 {intake.avg} 克</span>
            </div>
            {intake.warning ? (
              <Notice level="error">连续 7 天投喂超过推荐的 110%，注意控制体重。</Notice>
            ) : (
              <p className="muted tiny">
                连续 7 天超过推荐 110% 会预警（当前连续 {intake.overStreak} 天）。
              </p>
            )}
            <button type="button" className="btn btn-outline btn-block" onClick={openFeeding}>
              <Utensils size={16} />
              记录一次投喂
            </button>
          </>
        ) : null}
      </div>

      <DewormCard pet={pet} />

      <h3 className="section-title">最近投喂</h3>
      <div className="card">
        {petFeedings.length ? (
          <ul className="feed-list">
            {petFeedings.map((feeding) => {
              const item = feeding.itemId ? items.find((candidate) => candidate.id === feeding.itemId) : undefined;
              const sku = item ? skus.find((candidate) => candidate.gtin === item.gtin) : undefined;
              const me = parseMetabolizableEnergy(sku?.nutrition?.metabolizableEnergy);
              const kcal = me ? Math.round(((feeding.grams * me) / 1000) * 10) / 10 : undefined;
              return (
                <li key={feeding.id}>
                  <PetAvatar pet={pet} size="sm" />
                  <span className="li-title">{sku?.name || feeding.note || '未关联商品'}</span>
                  <span className="muted small">{feeding.date}</span>
                  <span className="amount">
                    {feeding.grams} 克{kcal !== undefined ? ` · ${kcal} kcal` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="删除投喂记录"
                    title="删除投喂记录"
                    onClick={() => removeFeeding(feeding.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">还没有投喂记录。记一笔后，库存会自动扣减，并用于消耗估算。</p>
        )}
      </div>

      {editing ? (
        <PetSheet
          pet={editing.pet}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            savePet(next);
            setEditing(null);
          }}
          onDelete={() => {
            if (!window.confirm(`删除 ${editing.pet.name}？库存会保留为家庭公共，投喂记录会一起删除。`)) return;
            removePet(editing.pet.id);
            setEditing(null);
          }}
        />
      ) : null}

      {feedingOpen ? (
        <Sheet
          title="记录投喂"
          subtitle={`${pet.name} · 记录后自动从库存扣克数`}
          onClose={() => setFeedingOpen(false)}
          footer={
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setFeedingOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" disabled={!(Number(mealGrams) > 0)} onClick={submitFeeding}>
                保存投喂
              </button>
            </div>
          }
        >
          <Field label="商品" hint="只列出这只宠物可吃的在库食品">
            <select className="input" value={mealItemId} onChange={(event) => setMealItemId(event.target.value)}>
              <option value="">不关联库存</option>
              {foodChoices.map((item) => {
                const sku = skus.find((candidate) => candidate.gtin === item.gtin);
                return (
                  <option key={item.id} value={item.id}>
                    {sku?.name || '未命名商品'} · 剩 {item.quantity}
                    {item.unit}
                  </option>
                );
              })}
            </select>
          </Field>
          <div className="field-row">
            <Field label="吃掉的克数" required>
              <TextInput
                value={mealGrams}
                inputMode="decimal"
                placeholder="例如 55"
                onChange={(event) => setMealGrams(event.target.value.replace(/[^\d.]/g, ''))}
              />
            </Field>
            <Field label="日期">
              <TextInput type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} />
            </Field>
          </div>
          <Field label="备注">
            <TextInput value={mealNote} placeholder="选填" onChange={(event) => setMealNote(event.target.value)} />
          </Field>
          <Notice level="warn">保存后会把对应库存扣掉相同克数；选「不关联库存」就只记投喂。</Notice>
        </Sheet>
      ) : null}

      {weightOpen ? (
        <Sheet
          title="记录体重"
          subtitle={`${pet.name} · 记录今天的最新体重`}
          onClose={() => setWeightOpen(false)}
          footer={
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setWeightOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" disabled={!(Number(weightText) > 0)} onClick={saveWeight}>
                保存体重
              </button>
            </div>
          }
        >
          <div className="field">
            <span className="field-label">
              当前体重
              <span className="flag flag-required">必填</span>
              {weightError ? <span className="flag">待核对</span> : null}
            </span>
            <div className="inline">
              <TextInput
                aria-label="当前体重"
                value={weightText}
                inputMode="decimal"
                placeholder={weightUnit === 'g' ? '例如 100' : weightUnit === 'jin' ? '例如 10' : '例如 5'}
                onChange={(event) => setWeightText(event.target.value.replace(/[^\d.-]/g, ''))}
              />
              <span className="weight-unit-label">
                {WEIGHT_UNITS.find((unit) => unit.value === weightUnit)?.label}
              </span>
            </div>
            <Segmented<WeightUnit>
              value={weightUnit}
              onChange={changeWeightUnit}
              options={WEIGHT_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
            />
            <span className="field-hint">阶段 1.5 只积累体重曲线，不会自动改动食量系数</span>
          </div>
          {weightError ? <Notice level="error">{weightError}</Notice> : null}
          {overweightHint ? <Notice level="warn">{overweightHint}</Notice> : null}
          {pet.weightHistory?.length ? (
            <div className="kv-grid">
              {pet.weightHistory.slice(0, 6).map((record) => (
                <div className="kv" key={`${record.date}-${record.createdAt}`}>
                  <span className="kv-key">{record.date}</span>
                  <span className="kv-val">{formatWeight(record.weightKg, weightUnit)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Notice level="warn">这是第一条体重记录。以后每次保存都会留在本机，供后续体重曲线功能使用。</Notice>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
