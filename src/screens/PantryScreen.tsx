import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PawPrint, Search } from 'lucide-react';
import type { ExpiryStatus } from '../types';
import { BrandTile } from '../components/BrandTile';
import { useStore } from '../lib/store';
import { diffDays, formatCn, remainingText, statusOf, statusThresholds, todayIso } from '../lib/shelfLife';
import {
  categoryLabel,
  categoryOf,
  effectiveExpiry,
  foodGroupOf,
  kindLabel,
} from '../lib/pets';
import { Chip, EmptyState, Segmented, StatusPill, TextInput } from '../components/ui';

type Filter = 'all' | 'soon' | 'watch' | 'expired' | 'ok' | 'opened';
type Kind = 'all' | 'staple' | 'snack';
type FoodGroup = 'all' | 'dry' | 'wet';

export function PantryScreen({ onOpenItem, onScan }: { onOpenItem: (id: string) => void; onScan: () => void }) {
  const { items, skuOf } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [foodGroup, setFoodGroup] = useState<FoodGroup>('all');
  const [byExpiry, setByExpiry] = useState(true);
  /** 搜索框同样不依赖输入法事件：输入、回车、失焦、点放大镜都会应用一次 */
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<number | null>(null);
  const applySearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setQuery(searchRef.current?.value ?? '');
  }, []);
  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    };
  }, []);
  const scheduleSearch = () => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(applySearch, 250);
  };

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items
      .filter((item) => !item.finishedAt)
      .map((item) => {
        const sku = skuOf(item.gtin);
        const expiry = effectiveExpiry(item);
        const { soonDays, watchDays } = statusThresholds(sku?.shelfLifeText);
        const status = statusOf(expiry, soonDays, watchDays);
        return { item, sku, status, expiry, foodGroup: foodGroupOf(sku) };
      })
      .filter(({ item, sku, status, foodGroup: group }) => {
        if (kind !== 'all' && sku?.kind !== kind) return false;
        if (foodGroup !== 'all' && group !== foodGroup) return false;
        if (filter === 'opened' && !item.openedAt) return false;
        if (filter === 'soon' && status !== 'soon') return false;
        if (filter === 'watch' && status !== 'watch') return false;
        if (filter === 'expired' && status !== 'expired') return false;
        if (filter === 'ok' && status !== 'ok' && status !== 'unknown') return false;
        if (!keyword) return true;
        const categoryText = `${categoryLabel(sku)} ${kindLabel(sku)}`.trim();
        const haystack =
          `${sku?.name ?? ''} ${sku?.brand ?? ''} ${sku?.brandOwner ?? ''} ${categoryText} ${item.gtin} ${item.location}`
            .toLowerCase();
        return haystack.includes(keyword);
      })
      .sort((a, b) => {
        if (!byExpiry) return b.item.createdAt - a.item.createdAt;
        const left = a.expiry ?? '9999-99-99';
        const right = b.expiry ?? '9999-99-99';
        return left.localeCompare(right);
      });
  }, [items, skuOf, query, filter, kind, foodGroup, byExpiry]);

  const stats = useMemo(() => {
    const active = items.filter((item) => !item.finishedAt);
    const counted = active.map((item) => {
      const sku = skuOf(item.gtin);
      const { soonDays, watchDays } = statusThresholds(sku?.shelfLifeText);
      return statusOf(effectiveExpiry(item), soonDays, watchDays);
    });
    return {
      expired: counted.filter((status: ExpiryStatus) => status === 'expired').length,
      soon: counted.filter((status: ExpiryStatus) => status === 'soon').length,
      watch: counted.filter((status: ExpiryStatus) => status === 'watch').length,
      opened: active.filter((item) => item.openedAt).length,
      dry: active.filter((item) => categoryOf(skuOf(item.gtin)) === 'dry').length,
      wet: active.filter((item) => categoryOf(skuOf(item.gtin)) === 'wet').length,
      total: counted.length,
    };
  }, [items, skuOf]);

  const openedDays = (iso: string) => Math.max(0, diffDays(iso, todayIso()));

  return (
    <div className="screen">
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-split">
            <span className="stat-part">
              <em>{stats.dry}</em>
              <span>干粮</span>
            </span>
            <span className="stat-divider" />
            <span className="stat-part">
              <em>{stats.wet}</em>
              <span>湿粮</span>
            </span>
          </span>
          <span className="stat-label">干湿库存</span>
        </div>
        <div className="stat stat-warn">
          <span className="stat-value">{stats.soon}</span>
          <span className="stat-label">临期</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.watch}</span>
          <span className="stat-label">保质期过半</span>
        </div>
        <button
          type="button"
          className={`stat ${filter === 'opened' ? 'stat-on' : ''}`}
          onClick={() => setFilter(filter === 'opened' ? 'all' : 'opened')}
        >
          <span className="stat-value stat-info">{stats.opened}</span>
          <span className="stat-label">已开封</span>
        </button>
      </div>

      <div className="search-box">
        <button type="button" className="search-go" aria-label="搜索" title="搜索" onClick={applySearch}>
          <Search size={16} />
        </button>
        <TextInput
          ref={searchRef}
          defaultValue={query}
          placeholder="搜索商品、品牌或条码"
          onChange={(event) => setQuery(event.target.value)}
          onInput={scheduleSearch}
          onBlur={applySearch}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applySearch();
          }}
        />
      </div>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: '全部' },
          { value: 'soon', label: '临期' },
          { value: 'watch', label: '过半' },
          { value: 'expired', label: '过期' },
          { value: 'ok', label: '充足' },
          { value: 'opened', label: '已开封' },
        ]}
      />

      <Segmented<FoodGroup>
        value={foodGroup}
        onChange={setFoodGroup}
        options={[
          { value: 'all', label: '全部干湿' },
          { value: 'dry', label: '干粮' },
          { value: 'wet', label: '湿粮' },
        ]}
      />

      <Segmented<Kind>
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: '全部' },
          { value: 'staple', label: '主食' },
          { value: 'snack', label: '零食' },
        ]}
      />

      <div className="row-between">
        <span className="muted small">共 {rows.length} 条</span>
        <button type="button" className="link-btn" onClick={() => setByExpiry((current) => !current)}>
          按{byExpiry ? '到期日' : '添加时间'}排序
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<PawPrint size={56} strokeWidth={1.5} />}
          title="这里还没有记录"
          hint="扫一次条码，或者拍一张背标，剩下的交给它"
          action={
            <button type="button" className="btn btn-primary" onClick={onScan}>
              去扫码
            </button>
          }
        />
      ) : (
        <ul className="list">
          {rows.map(({ item, sku, status, expiry }) => (
            <li key={item.id}>
              <button type="button" className="list-item" onClick={() => onOpenItem(item.id)}>
                <BrandTile label={sku?.iconLabel} brand={sku?.brand} name={sku?.name} />
                <span className="li-main">
                  <span className="li-title">{sku?.name || '未命名商品'}</span>
                  <span className="li-sub">
                    <span className="amount">
                      <PawPrint size={11} />
                      {item.count && item.count > 1 ? `共 ${item.quantity}${item.unit}` : `${item.quantity}${item.unit}`}
                    </span>
                    {item.count && item.count > 1 ? (
                      <Chip tone="ok">{`${Math.round((item.quantity / item.count) * 100) / 100}${item.unit}/件`}</Chip>
                    ) : null}
                    {item.count && item.count > 1 ? <Chip>{item.count} 件</Chip> : null}
                    {item.openedAt ? (
                      <Chip tone="info">
                        已开封 {openedDays(item.openedAt)} 天
                      </Chip>
                    ) : null}
                    {item.openedExpiryDate && item.openedExpiryDate < (item.expiryDate ?? '9999-99-99') ? (
                      <Chip tone="warn">开封效期 {formatCn(item.openedExpiryDate)}</Chip>
                    ) : null}
                    {categoryLabel(sku) || kindLabel(sku) ? (
                      <Chip tone={categoryOf(sku) === 'wet' ? 'info' : 'neutral'}>
                        {[categoryLabel(sku), kindLabel(sku)].filter(Boolean).join('·')}
                      </Chip>
                    ) : null}
                    {sku?.brand ? <span className="muted small">{sku.brand}</span> : null}
                    {item.location ? <span className="muted small">{item.location}</span> : null}
                  </span>
                  <span className="mono tiny">{item.gtin || '无条码'}</span>
                </span>
                <span className="li-side">
                  <StatusPill status={status} />
                  <span className="mono small">{formatCn(expiry)}</span>
                  <span className={`small ${status === 'expired' ? 'text-danger' : status === 'soon' ? 'text-warn' : 'muted'}`}>
                    {remainingText(expiry)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
