import { useMemo, useRef, useState } from 'react';
import { BookOpen, Camera, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Pet, Vaccination } from '../types';
import { extractVaccinationsFromPhoto, type VaccinationDraft } from '../lib/engine';
import { captureNativePhoto, isNative } from '../lib/native';
import { downscale, readAsDataUrl } from '../lib/image';
import { putPhoto } from '../lib/storage';
import { useStore } from '../lib/store';
import {
  firstVaccineSchedule,
  vaccineBadge,
  vaccineKindLabel,
  vaccineKindOf,
  vaccineSchedule,
} from '../lib/care';
import { shiftMonths, todayIso } from '../lib/shelfLife';
import { Field, Notice, Sheet, TextInput } from './ui';

type DraftRow = VaccinationDraft & {
  id: string;
  source: 'photo' | 'manual';
};

const newId = () => `vacc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function VaccineBook({ pet }: { pet: Pet }) {
  const { settings, vaccinations, addVaccinations, updateVaccination, removeVaccination } = useStore();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [sourcePhoto, setSourcePhoto] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Vaccination | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' }>();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const records = useMemo(
    () =>
      vaccinations
        .filter((record) => record.petId === pet.id && record.confirmed)
        .sort((left, right) => right.doseDate.localeCompare(left.doseDate)),
    [pet.id, vaccinations],
  );
  const badge = vaccineBadge(records);
  const schedules = vaccineSchedule(records);
  const firstSchedule = records.length ? [] : firstVaccineSchedule(pet);

  const duplicateKeys = useMemo(() => {
    if (!drafts) return new Set<string>();
    const counts = new Map<string, number>();
    const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
    for (const record of records) {
      const key = `${normalize(record.vaccineName)}:${record.doseDate}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const record of drafts) {
      const key = `${normalize(record.vaccineName)}:${record.doseDate}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    );
  }, [drafts, records]);

  const openManual = () => {
    setSourcePhoto(undefined);
    setDrafts([
      {
        id: newId(),
        vaccineName: pet.species === 'dog' ? '犬联苗' : '妙三多',
        doseDate: todayIso(),
        nextDate: undefined,
        clinic: '',
        source: 'manual',
      },
    ]);
  };

  const readPhoto = async (dataUrl: string) => {
    setBusy(true);
    setMessage({ text: '正在识别疫苗本，请核对后再写入…', tone: 'warn' });
    try {
      const compact = await downscale(dataUrl, 1800, 0.84);
      const result = await extractVaccinationsFromPhoto(settings, compact);
      if (!result.records.length) {
        setMessage({ text: result.notice ?? '没认出接种记录，试试手动添加', tone: 'warn' });
        return;
      }
      setSourcePhoto(compact);
      setDrafts(
        result.records.map((record) => ({
          ...record,
          id: newId(),
          source: 'photo',
        })),
      );
      setMessage(undefined);
    } catch (error) {
      setMessage({
        text: `${error instanceof Error ? error.message : '识别失败'}。可以直接手动添加`,
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const openPhoto = async () => {
    setMessage(undefined);
    if (isNative()) {
      try {
        const photo = await captureNativePhoto();
        if (photo) await readPhoto(photo);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!/cancel/i.test(reason)) setMessage({ text: '相机不可用，可以先手动添加', tone: 'warn' });
      }
      return;
    }
    photoInputRef.current?.click();
  };

  const patchDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((current) =>
      current ? current.map((record) => (record.id === id ? { ...record, ...patch } : record)) : current,
    );
  };

  const confirmDrafts = async () => {
    if (!drafts?.length) return;
    const valid = drafts.filter((record) => record.vaccineName.trim() && record.doseDate);
    if (!valid.length) {
      setMessage({ text: '至少保留一条有疫苗名称和接种日期的记录', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      const saved: Vaccination[] = [];
      for (const draft of valid) {
        const id = draft.id;
        let photoId: string | undefined;
        if (sourcePhoto) {
          photoId = `vacc_${id}`;
          if (!(await putPhoto(photoId, sourcePhoto))) photoId = undefined;
        }
        saved.push({
          id,
          petId: pet.id,
          vaccineName: draft.vaccineName.trim(),
          vaccineKind: vaccineKindOf(draft.vaccineName),
          doseDate: draft.doseDate,
          nextDate: draft.nextDate || undefined,
          clinic: draft.clinic?.trim() || undefined,
          source: draft.source,
          confirmed: true,
          photoId,
          createdAt: Date.now(),
        });
      }
      addVaccinations(saved);
      setDrafts(null);
      setSourcePhoto(undefined);
      setMessage({ text: '疫苗记录已写入，年度加强日程已更新', tone: 'ok' });
    } finally {
      setBusy(false);
    }
  };

  const completeSchedule = (kind: 'combo' | 'rabies', dueDate: string) => {
    const name =
      kind === 'rabies'
        ? '狂犬疫苗'
        : pet.species === 'dog'
          ? '犬联苗'
          : '猫三联';
    addVaccinations([
      {
        id: newId(),
        petId: pet.id,
        vaccineName: name,
        vaccineKind: kind,
        doseDate: dueDate,
        nextDate: shiftMonths(dueDate, 12),
        source: 'auto',
        confirmed: true,
        createdAt: Date.now(),
      },
    ]);
    setMessage({ text: `已记录本次${kind === 'rabies' ? '狂犬' : '联苗'}加强，下一次日程已顺延一年`, tone: 'ok' });
  };

  return (
    <div className="care-book">
      <button type="button" className="care-toggle" onClick={() => setOpen((value) => !value)}>
        <span className="care-toggle-main">
          <BookOpen size={18} />
          <span>📕 疫苗本</span>
        </span>
        <span className={`care-badge care-badge-${badge.state}`}>{badge.text}</span>
      </button>

      {open ? (
        <div className="card care-body">
          {message ? <Notice level={message.tone}>{message.text}</Notice> : null}
          <div className="action-row">
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void openPhoto()}>
              <Camera size={15} />
              {busy ? '识别中…' : '拍疫苗本录入'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openManual}>
              <Plus size={15} />
              手动添加
            </button>
          </div>

          {schedules.length ? (
            <div className="care-schedule">
              <p className="block-label">下一次加强</p>
              {schedules.map((schedule) => (
                <div className="schedule-row" key={`${schedule.kind}-${schedule.dueDate}`}>
                  <div>
                    <p className="li-title">{vaccineKindLabel(schedule.kind)}加强针</p>
                    <p className="muted small">{schedule.dueDate}</p>
                  </div>
                  {schedule.kind !== 'other' ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => completeSchedule(schedule.kind as 'combo' | 'rabies', schedule.dueDate)}
                    >
                      <Check size={14} />
                      已完成
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {records.length ? (
            <div className="timeline">
              {records.map((record) => (
                <div className="timeline-row" key={record.id}>
                  <span className="timeline-dot" />
                  <div className="timeline-main">
                    <p className="li-title">{record.vaccineName}</p>
                    <p className="muted small">
                      {record.doseDate}
                      {record.clinic ? ` · ${record.clinic}` : ''}
                      {record.source === 'auto' ? ' · 自动顺延' : ''}
                    </p>
                    {record.nextDate ? <p className="muted tiny">疫苗本标注下次：{record.nextDate}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="修改疫苗记录"
                    title="修改疫苗记录"
                    onClick={() => setEditingRecord(record)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="删除疫苗记录"
                    title="删除疫苗记录"
                    onClick={() => removeVaccination(record.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">还没有接种记录。拍照识图后必须逐条核对，确认前不会写入。</p>
          )}

          {firstSchedule.length ? (
            <div className="care-schedule">
              <p className="block-label">首免建议时间表</p>
              {firstSchedule.map((item) => (
                <div className="row-between" key={item.label}>
                  <span className="small">{item.label}</span>
                  <span className="muted small">{item.date}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="disclaimer">以上时间表仅供参考，具体请遵医嘱。照片与记录仅保存在本机。</p>
        </div>
      ) : null}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readAsDataUrl(file).then(readPhoto);
        }}
      />

      {drafts ? (
        <Sheet
          title="确认疫苗记录"
          subtitle={`${pet.name} · 识别结果逐条核对，确认前不会写入`}
          onClose={() => {
            setDrafts(null);
            setSourcePhoto(undefined);
          }}
          footer={
            <div className="foot-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDrafts(null);
                  setSourcePhoto(undefined);
                }}
              >
                取消
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmDrafts()}>
                <Check size={16} />
                确认无误，写入疫苗本
              </button>
            </div>
          }
        >
          {sourcePhoto ? (
            <div className="photo-strip">
              <img src={sourcePhoto} alt="疫苗本原图" />
              <span className="muted tiny">确认后照片留在本机，不进入导出备份</span>
            </div>
          ) : null}
          {duplicateKeys.size ? (
            <Notice level="warn">有日期和疫苗名相同的记录，可能重复录入，请逐条核对。</Notice>
          ) : null}
          {drafts.map((record, index) => {
            const key = `${record.vaccineName.replace(/\s+/g, '').toLowerCase()}:${record.doseDate}`;
            return (
              <div className={`vaccine-draft ${duplicateKeys.has(key) ? 'duplicate' : ''}`} key={record.id}>
                <div className="row-between">
                  <p className="block-label">第 {index + 1} 针</p>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="忽略这条记录"
                    title="忽略这条记录"
                    onClick={() => setDrafts((current) => current?.filter((item) => item.id !== record.id) ?? null)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Field label="疫苗名称" required>
                  <TextInput
                    value={record.vaccineName}
                    onChange={(event) => patchDraft(record.id, { vaccineName: event.target.value })}
                  />
                </Field>
                <div className="field-row">
                  <Field label="接种日期" required>
                    <TextInput
                      type="date"
                      value={record.doseDate}
                      onChange={(event) => patchDraft(record.id, { doseDate: event.target.value })}
                    />
                  </Field>
                  <Field label="下次日期">
                    <TextInput
                      type="date"
                      value={record.nextDate ?? ''}
                      onChange={(event) => patchDraft(record.id, { nextDate: event.target.value || undefined })}
                    />
                  </Field>
                </div>
                <Field label="医院 / 诊所">
                  <TextInput
                    value={record.clinic ?? ''}
                    placeholder="看不清可以留空"
                    onChange={(event) => patchDraft(record.id, { clinic: event.target.value })}
                  />
                </Field>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() =>
              setDrafts((current) => [
                ...(current ?? []),
                {
                  id: newId(),
                  vaccineName: '',
                  doseDate: '',
                  clinic: '',
                  source: sourcePhoto ? 'photo' : 'manual',
                },
              ])
            }
          >
            <Plus size={16} />
            再加一针
          </button>
        </Sheet>
      ) : null}

      {editingRecord ? (
        <Sheet
          title="修改疫苗记录"
          subtitle={`${pet.name} · 修改末针日期后年度加强会自动重算`}
          onClose={() => setEditingRecord(null)}
          footer={
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditingRecord(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!editingRecord.vaccineName.trim() || !editingRecord.doseDate}
                onClick={() => {
                  updateVaccination(editingRecord.id, {
                    ...editingRecord,
                    vaccineKind: vaccineKindOf(editingRecord.vaccineName),
                  });
                  setEditingRecord(null);
                  setMessage({ text: '疫苗记录已更新，年度加强日程已重算', tone: 'ok' });
                }}
              >
                <Check size={16} />
                保存修改
              </button>
            </div>
          }
        >
          <Field label="疫苗名称" required>
            <TextInput
              value={editingRecord.vaccineName}
              onChange={(event) =>
                setEditingRecord((current) =>
                  current ? { ...current, vaccineName: event.target.value } : current,
                )
              }
            />
          </Field>
          <div className="field-row">
            <Field label="接种日期" required>
              <TextInput
                type="date"
                value={editingRecord.doseDate}
                onChange={(event) =>
                  setEditingRecord((current) =>
                    current ? { ...current, doseDate: event.target.value } : current,
                  )
                }
              />
            </Field>
            <Field label="下次日期">
              <TextInput
                type="date"
                value={editingRecord.nextDate ?? ''}
                onChange={(event) =>
                  setEditingRecord((current) =>
                    current ? { ...current, nextDate: event.target.value || undefined } : current,
                  )
                }
              />
            </Field>
          </div>
          <Field label="医院 / 诊所">
            <TextInput
              value={editingRecord.clinic ?? ''}
              onChange={(event) =>
                setEditingRecord((current) =>
                  current ? { ...current, clinic: event.target.value } : current,
                )
              }
            />
          </Field>
        </Sheet>
      ) : null}
    </div>
  );
}

