import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { CatMascot } from '../components/Cat';
import { BrandTile } from '../components/BrandTile';
import type { Sku } from '../types';
import { useStore } from '../lib/store';
import { completenessOf } from '../lib/parse';
import { Chip, EmptyState, Segmented, TextInput } from '../components/ui';

type Sort = 'completeness' | 'updated';

/** 点开档案时直接把这条记录交给上层：按条码反查会在重码 / 无码档案上串档。 */
export function LibraryScreen({ onOpenSku, onCreate }: { onOpenSku: (sku: Sku) => void; onCreate: () => void }) {
  const { skus, items } = useStore();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('completeness');
  /** 和库存页一样：输入、回车、失焦、点放大镜都会应用搜索词 */
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
    return skus
      .map((sku) => ({
        sku,
        completeness: completenessOf(sku),
        count: items.filter((item) => item.gtin === sku.gtin).length,
      }))
      .filter(({ sku }) => {
        if (!keyword) return true;
        return `${sku.name} ${sku.brand} ${sku.brandOwner} ${sku.manufacturer} ${sku.gtin}`
          .toLowerCase()
          .includes(keyword);
      })
      .sort((a, b) =>
        sort === 'completeness' ? b.completeness - a.completeness : b.sku.updatedAt - a.sku.updatedAt,
      );
  }, [skus, items, query, sort]);

  return (
    <div className="screen">
      <div className="row-between">
        <span className="muted small">
          {skus.length} 个商品档案 · {skus.filter((sku) => sku.source === 'manual').length} 个手工录入
        </span>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCreate}>
          <Plus size={15} />
          新增
        </button>
      </div>

      <div className="search-box">
        <button type="button" className="search-go" aria-label="搜索" title="搜索" onClick={applySearch}>
          <Search size={16} />
        </button>
        <TextInput
          ref={searchRef}
          defaultValue={query}
          placeholder="搜索品牌、厂家或条码"
          onChange={(event) => setQuery(event.target.value)}
          onInput={scheduleSearch}
          onBlur={applySearch}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applySearch();
          }}
        />
      </div>

      <Segmented<Sort>
        value={sort}
        onChange={setSort}
        options={[
          { value: 'completeness', label: '按完整度' },
          { value: 'updated', label: '按更新时间' },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState icon={<CatMascot size={56} />} title="还没有商品档案" hint="扫一次条码就会自动建档" />
      ) : (
        <ul className="list">
          {rows.map(({ sku, completeness, count }) => (
            <li key={sku.gtin || sku.name}>
              <button type="button" className="list-item" onClick={() => onOpenSku(sku)}>
                <BrandTile label={sku.iconLabel} brand={sku.brand} name={sku.name} />
                <span className="li-main">
                  <span className="li-title">{sku.name || '未命名商品'}</span>
                  <span className="muted small">
                    {sku.brand} · {[sku.brandOwner, sku.manufacturer].filter(Boolean).join(' / ')}
                  </span>
                  <span className="chips chips-tight">
                    <Chip tone={sku.source === 'api' ? 'ok' : 'neutral'}>
                      {sku.source === 'api' ? '视觉模型' : '手工录入'}
                    </Chip>
                    <Chip>v{sku.version}</Chip>
                    {sku.additives.length ? <Chip>添加剂 {sku.additives.length}</Chip> : null}
                    {sku.allergens.length ? <Chip tone="warn">致敏 {sku.allergens.length}</Chip> : null}
                    {count ? <Chip tone="ok">{count} 条库存</Chip> : null}
                  </span>
                  <span className="bar bar-tight">
                    <span className="bar-fill" style={{ width: `${completeness}%` }} />
                  </span>
                  <span className="muted tiny">档案完整度 {completeness}%</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
