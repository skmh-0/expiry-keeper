import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { Field, TextInput } from './ui';

/** 生产厂家输入框 + 常见厂家快选（展开式列表，避免抽屉叠层）。 */
export function ManufacturerField({
  value,
  onChange,
  flag,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  flag?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const { makers } = useStore();
  return (
    <>
      <Field label="生产厂家" flag={flag} hint={hint}>
        <TextInput
          name="manufacturer"
          value={value}
          placeholder="包装上的生产者名称"
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((current) => !current)}>
        <Building2 size={14} />
        {open ? '收起常见厂家' : `从常见厂家里选（${makers.length} 家）`}
      </button>
      {open ? (
        makers.length ? (
          <ul className="maker-list">
            {makers.map((maker) => (
              <li key={maker.name}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(maker.name);
                    setOpen(false);
                  }}
                >
                  <span className="li-title">{maker.name}</span>
                  <span className="muted tiny">
                    {[maker.city, maker.brands].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">名单是空的，去「设置 → 常用厂家」里加。</p>
        )
      ) : null}
    </>
  );
}
