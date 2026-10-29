import { useState } from 'react';
import { Bug, Check, Pencil, Trash2 } from 'lucide-react';
import type { DewormingPlan, DewormingType, Pet } from '../types';
import {
  dewormIntervalDays,
  dewormLabel,
  dewormNextDate,
  dewormingBadge,
} from '../lib/care';
import { todayIso } from '../lib/shelfLife';
import { useStore } from '../lib/store';
import { Field, Notice, Sheet, TextInput } from './ui';

const TYPES: { value: DewormingType; label: string }[] = [
  { value: 'internal', label: '体内' },
  { value: 'external', label: '体外' },
];

const newId = () => `deworm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function DewormCard({ pet }: { pet: Pet }) {
  const { dewormings, saveDeworming, removeDeworming } = useStore();
  const plans = dewormings.filter((plan) => plan.petId === pet.id);
  const [editing, setEditing] = useState<{ type: DewormingType; lastDate: string } | null>(null);
  const [message, setMessage] = useState('');

  const open = (type: DewormingType) => {
    const existing = plans.find((plan) => plan.type === type);
    setEditing({ type, lastDate: existing?.lastDate ?? todayIso() });
    setMessage('');
  };

  const save = () => {
    if (!editing) return;
    const existing = plans.find((plan) => plan.type === editing.type);
    const now = Date.now();
    const plan: DewormingPlan = {
      id: existing?.id ?? newId(),
      petId: pet.id,
      type: editing.type,
      lastDate: editing.lastDate,
      nextDate: dewormNextDate(pet, editing.type, editing.lastDate),
      doneLog: existing?.doneLog ?? [],
      missCount: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveDeworming(plan);
    setEditing(null);
    setMessage(`${dewormLabel(plan.type)}驱虫下一次安排在 ${plan.nextDate}`);
  };

  const complete = (plan: DewormingPlan) => {
    const date = todayIso();
    const interval = dewormIntervalDays(pet, plan.type, date);
    const nextDate = dewormNextDate(pet, plan.type, date);
    saveDeworming({
      ...plan,
      lastDate: date,
      nextDate,
      doneLog: [...plan.doneLog, date],
      missCount: 0,
      updatedAt: Date.now(),
    });
    setMessage(`已完成${dewormLabel(plan.type)}驱虫，下一次 ${nextDate}（${interval} 天周期）`);
  };

  return (
    <div className="card care-deworm">
      <div className="row-between">
        <p className="block-label">驱虫日历</p>
        <Bug size={16} className="muted" />
      </div>
      {message ? <Notice level="ok">{message}</Notice> : null}
      {TYPES.map(({ value, label }) => {
        const plan = plans.find((item) => item.type === value);
        const interval = dewormIntervalDays(pet, value);
        return (
          <div className="deworm-row" key={value}>
            <div className="deworm-main">
              <p className="li-title">{label}驱虫</p>
              <p className="muted small">
                {plan ? `上次 ${plan.lastDate} · 下次 ${plan.nextDate}` : `还没有记录 · 建议每 ${interval} 天`}
              </p>
              <p className={`care-status care-status-${plan && dewormingBadge(plan) === '已逾期' ? 'overdue' : 'normal'}`}>
                {plan ? dewormingBadge(plan) : '无记录'}
              </p>
            </div>
            <div className="care-actions">
              {plan ? (
                <>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => complete(plan)}>
                    <Check size={14} />
                    已完成
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`修改${label}驱虫`}
                    title={`修改${label}驱虫`}
                    onClick={() => open(value)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`删除${label}驱虫`}
                    title={`删除${label}驱虫`}
                    onClick={() => removeDeworming(plan.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => open(value)}>
                  记录上次日期
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="disclaimer">
        体内驱虫在 6 月龄前按 30 天、成年后按 90 天；体外固定 30 天。仅供参考，有皮肤病或生肉饮食请遵医嘱加频。
      </p>

      {editing ? (
        <Sheet
          title={`记录${dewormLabel(editing.type)}驱虫`}
          subtitle={`${pet.name} · 会按当前月龄自动选择下一次周期`}
          onClose={() => setEditing(null)}
          footer={
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                <Check size={16} />
                保存
              </button>
            </div>
          }
        >
          <Notice level="warn">
            本次只记录{dewormLabel(editing.type)}驱虫；体内和体外需要分别录入。
          </Notice>
          <Field label="上次驱虫日期" required>
            <TextInput
              type="date"
              value={editing.lastDate}
              onChange={(event) =>
                setEditing((current) => (current ? { ...current, lastDate: event.target.value } : current))
              }
            />
          </Field>
          <Notice level="warn">
            下一次日期：{editing.lastDate ? dewormNextDate(pet, editing.type, editing.lastDate) : '先选日期'}。
            错过提醒每周补一次，最多 4 次。
          </Notice>
        </Sheet>
      ) : null}
    </div>
  );
}

