import { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Maker } from '../types';
import { Field, Notice, Sheet, TextInput } from './ui';

/** 常用厂家管理：用户可增可删，也能一键恢复默认名单。 */
export function MakerSheet({
  makers,
  onAdd,
  onRemove,
  onRestore,
  onClose,
}: {
  makers: Maker[];
  onAdd: (maker: Maker) => void;
  onRemove: (name: string) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [brands, setBrands] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed, city: city.trim() || undefined, brands: brands.trim() || undefined });
    setName('');
    setCity('');
    setBrands('');
  };

  return (
    <Sheet title="常用厂家" subtitle={`${makers.length} 家 · 识别后可从名单一键填入生产厂家`} onClose={onClose}>
      <Field label="厂家名称">
        <TextInput value={name} placeholder="例如 某某宠物食品有限公司" onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="field-row">
        <Field label="所在地（选填）">
          <TextInput value={city} placeholder="山东聊城" onChange={(event) => setCity(event.target.value)} />
        </Field>
        <Field label="代表品牌（选填）">
          <TextInput value={brands} placeholder="麦富迪" onChange={(event) => setBrands(event.target.value)} />
        </Field>
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={!name.trim()} onClick={submit}>
        <Plus size={16} />
        添加到名单
      </button>

      <h3 className="section-title">名单（{makers.length}）</h3>
      {makers.length ? (
        <ul className="maker-list maker-manage">
          {makers.map((maker) => (
            <li key={maker.name}>
              <div className="maker-text">
                <span className="li-title">{maker.name}</span>
                <span className="muted tiny">{[maker.city, maker.brands].filter(Boolean).join(' · ') || '—'}</span>
              </div>
              <button
                type="button"
                className="btn-icon"
                aria-label={`删除 ${maker.name}`}
                title="从名单删除"
                onClick={() => onRemove(maker.name)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Notice level="warn">名单为空，识别后需要手动输入厂家名称。</Notice>
      )}

      <button type="button" className="btn btn-ghost btn-block" onClick={onRestore}>
        <RotateCcw size={16} />
        恢复默认名单
      </button>
      <p className="disclaimer">名单只存在本机，随备份一起导出导入。</p>
    </Sheet>
  );
}
