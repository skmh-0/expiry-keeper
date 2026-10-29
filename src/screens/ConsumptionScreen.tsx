import { useMemo, useState } from 'react';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import type { PantryItem } from '../types';
import { computeConsumption, earlierIso, formatGrams, laterIso } from '../lib/consumption';
import { diffDays, formatCn, shiftDays, todayIso } from '../lib/shelfLife';
import { summarizeStock, type StockDimension } from '../lib/estimate';
import { CatMascot } from '../components/Cat';
import { BrandTile } from '../components/BrandTile';
import { PetAvatar } from '../components/PetAvatar';
import { EmptyState, Field, Notice, Segmented, TextInput } from '../components/ui';
import { foodGroupOf } from '../lib/pets';

/** custom：用户手改过日期，四个快捷档位都不再高亮 */
type Range = '7' | '30' | 'month' | 'all' | 'custom';
type FoodConsumptionFilter = 'all' | 'dry' | 'wet';

export function ConsumptionScreen({ onScan }: { onScan: () => void }) {
  const { items, skuOf, updateItem, removeItem, skus, feedings, pets } = useStore();
  const today = todayIso();
  const [range, setRange] = useState<Range>('30');
  const [from, setFrom] = useState(shiftDays(today, -30));
  const [to, setTo] = useState(today);
  // 手改开封 / 用完日期
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState('');
  const [draftFinish, setDraftFinish] = useState('');
  const [editError, setEditError] = useState('');
  const [dimension, setDimension] = useState<StockDimension>('category');
  const [foodFilter, setFoodFilter] = useState<FoodConsumptionFilter>('all');

  const stockGroups = useMemo(
    () => summarizeStock(items, skus, feedings, pets, dimension),
    [items, skus, feedings, pets, dimension],
  );

  const startEdit = (row: (typeof rows)[number]) => {
    setEditingId(row.item.id);
    setDraftOpen(row.start);
    setDraftFinish(row.item.finishedAt ?? row.end);
    setEditError('');
  };

  const saveEdit = (row: (typeof rows)[number]) => {
    const open = draftOpen || row.start;
    const finish = row.openEnded ? row.item.finishedAt : draftFinish;
    if (finish && finish < open) {
      setEditError('用完日期不能早于开封日期');
      return;
    }
    const patch: Partial<PantryItem> = { openedAt: open };
    if (!row.openEnded && finish) patch.finishedAt = finish;
    updateItem(row.item.id, patch);
    setEditingId(null);
    setEditError('');
  };

  const applyRange = (next: Range) => {
    setRange(next);
    if (next === '7') {
      setFrom(shiftDays(today, -7));
      setTo(today);
    } else if (next === '30') {
      setFrom(shiftDays(today, -30));
      setTo(today);
    } else if (next === 'month') {
      setFrom(`${today.slice(0, 7)}-01`);
      setTo(today);
    } else {
      setFrom('2000-01-01');
      setTo(today);
    }
  };

  const allRows = useMemo(
    () =>
      items
        .map((item) => computeConsumption(item, from, to))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.end.localeCompare(a.end)),
    [items, from, to],
  );
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        if (foodFilter === 'all') return true;
        return foodGroupOf(skuOf(row.item.gtin)) === foodFilter;
      }),
    [allRows, foodFilter, skuOf],
  );

  const finished = rows.filter((row) => !row.openEnded);
  const running = rows.filter((row) => row.openEnded);
  const finishedGrams = finished.reduce((sum, row) => sum + row.grams, 0);
  const runningGrams = running.reduce((sum, row) => sum + row.grams, 0);
  const foodConsumption = useMemo(() => {
    let dry = 0;
    let wet = 0;
    for (const row of allRows) {
      const group = foodGroupOf(skuOf(row.item.gtin));
      if (group === 'dry') dry += row.grams;
      else if (group === 'wet') wet += row.grams;
    }
    return {
      dry: Math.round(dry * 10) / 10,
      wet: Math.round(wet * 10) / 10,
      total: Math.round((dry + wet) * 10) / 10,
    };
  }, [allRows, skuOf]);
  // 日均按「区间和实际消耗区间的交集」算，否则选「全部」时会被上百天的空档稀释成 0
  const coveredFrom = rows.length ? laterIso(from, rows.reduce((min, row) => earlierIso(min, row.start), rows[0].start)) : from;
  const coveredTo = rows.length ? earlierIso(to, rows.reduce((max, row) => laterIso(max, row.end), rows[0].end)) : to;
  const spanDays = Math.max(1, diffDays(coveredFrom, coveredTo));

  const rowBody = (row: (typeof rows)[number]) => {
    const sku = skuOf(row.item.gtin);
    const unit = row.item.unit || '克';
    return (
      <li key={row.item.id}>
        <div className="consume-row">
          <BrandTile brand={sku?.brand} name={sku?.name} />
          <div className="consume-main">
            <p className="li-title">{sku?.name || '未命名商品'}</p>
            <p className="muted small">
              {formatCn(row.start)} 开封 → {formatCn(row.end)} {row.openEnded ? '至今' : '用完'} · {row.totalDays} 天 · 共{' '}
              {formatGrams(row.item.quantity)}
              {unit}
              {row.assumedOpen ? '（开封日按入库日推算）' : ''}
            </p>
            <p className="consume-amount">
              期间约 {formatGrams(row.grams)}
              {unit}
              <span className="muted tiny">
                {' '}
                · 日均 {formatGrams(row.rate)}
                {unit}/天
              </span>
            </p>
            {editingId === row.item.id ? (
              <div className="consume-edit">
                <div className="field-row">
                  <Field label="开封日">
                    <TextInput
                      type="date"
                      value={draftOpen}
                      onChange={(event) => setDraftOpen(event.target.value)}
                    />
                  </Field>
                  <Field label="用完日" hint={row.openEnded ? '还在用中，先记「已用完」再改' : '摊算天数按这两个日期算'}>
                    <TextInput
                      type="date"
                      value={draftFinish}
                      disabled={row.openEnded}
                      onChange={(event) => setDraftFinish(event.target.value)}
                    />
                  </Field>
                </div>
                {editError ? <Notice level="error">{editError}</Notice> : null}
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditingId(null);
                      setEditError('');
                    }}
                  >
                    取消
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => saveEdit(row)}>
                    保存日期
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="consume-actions">
            <button
              type="button"
              className="btn-icon"
              title="改开封 / 用完日期"
              aria-label="改开封 / 用完日期"
              onClick={() => startEdit(row)}
            >
              <Pencil size={15} />
            </button>
            {row.openEnded ? null : (
              <button
                type="button"
                className="btn-icon"
                title="放回库存"
                aria-label="放回库存"
                onClick={() => updateItem(row.item.id, { finishedAt: undefined })}
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              type="button"
              className="btn-icon"
              title="删除记录"
              aria-label="删除记录"
              onClick={() => removeItem(row.item.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="screen">
      <Segmented<Range>
        value={range}
        onChange={applyRange}
        options={[
          { value: '7', label: '近 7 天' },
          { value: '30', label: '近 30 天' },
          { value: 'month', label: '本月' },
          { value: 'all', label: '全部' },
        ]}
      />

      <div className="field-row">
        <Field label="开始日期">
          <TextInput
            type="date"
            value={from}
            onChange={(event) => {
              setRange('custom');
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field label="结束日期">
          <TextInput
            type="date"
            value={to}
            onChange={(event) => {
              setRange('custom');
              setTo(event.target.value);
            }}
          />
        </Field>
      </div>

      <Segmented<FoodConsumptionFilter>
        value={foodFilter}
        onChange={setFoodFilter}
        options={[
          { value: 'all', label: '全部消耗' },
          { value: 'dry', label: '只看干粮' },
          { value: 'wet', label: '只看湿粮' },
        ]}
      />

      <h3 className="section-title">干湿粮消耗</h3>
      <div className="stat-grid stat-grid-3">
        <div className="stat">
          <span className="stat-value">{formatGrams(foodConsumption.dry)}</span>
          <span className="stat-label">干粮(克)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatGrams(foodConsumption.wet)}</span>
          <span className="stat-label">湿粮(克)</span>
        </div>
        <div className="stat">
          <span className="stat-value stat-info">{formatGrams(foodConsumption.total)}</span>
          <span className="stat-label">合计(克)</span>
        </div>
      </div>

      <h3 className="section-title">存量与可吃天数</h3>
      <Segmented<StockDimension>
        value={dimension}
        onChange={setDimension}
        options={[
          { value: 'category', label: '按分类' },
          { value: 'pet', label: '按宠物' },
          { value: 'household', label: '全家庭' },
        ]}
      />
      <div className="card">
        {stockGroups.length ? (
          stockGroups.map((group) => (
            <div className="row-between" key={group.key}>
              <span className="small inline">
                {dimension === 'pet' && group.key !== 'shared'
                  ? (() => {
                      const groupPet = pets.find((pet) => pet.id === group.key);
                      return groupPet ? <PetAvatar pet={groupPet} size="xs" /> : null;
                    })()
                  : null}
                {group.label}
              </span>
              <span className="muted small">
                {formatGrams(group.totalGrams)} 克 ·{' '}
                {group.remainingDays !== undefined ? `约 ${formatGrams(group.remainingDays)} 天` : '记录投喂后可估算'}
              </span>
            </div>
          ))
        ) : (
          <p className="muted small">还没有在库商品。</p>
        )}
        <Notice level="warn">可吃天数按最近 7 天的日均消耗估算；还没有投喂记录的库存只显示存量。</Notice>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{formatGrams(finishedGrams)}</span>
          <span className="stat-label">期间吃掉(克)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatGrams(finishedGrams / spanDays)}</span>
          <span className="stat-label">日均(克/天)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{finished.length}</span>
          <span className="stat-label">用完件数</span>
        </div>
        <div className="stat">
          <span className="stat-value">{running.length}</span>
          <span className="stat-label">在用中</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<CatMascot size={56} />}
          title={items.length ? '这段时间没有消耗记录' : '还没有商品记录'}
          hint={
            items.length
              ? '点开库存里的商品记一下开封日，用完点「已用完」，就会按天数摊算'
              : '先扫一个商品条码建档，之后吃完就能看到消耗'
          }
          action={
            <button type="button" className="btn btn-primary" onClick={onScan}>
              去扫码
            </button>
          }
        />
      ) : null}

      {finished.length ? (
        <>
          <h3 className="section-title">已用完（按区间摊算）</h3>
          <ul className="list">{finished.map(rowBody)}</ul>
        </>
      ) : null}

      {running.length ? (
        <>
          <h3 className="section-title">已开封在用（估算）</h3>
          <ul className="list">{running.map(rowBody)}</ul>
          <Notice level="warn">
            在用中的按「开封到今天」的日均估算，区间内合计约 {formatGrams(runningGrams)} 克；点商品里的「已用完」会用真实天数重算。
          </Notice>
        </>
      ) : null}
    </div>
  );
}
