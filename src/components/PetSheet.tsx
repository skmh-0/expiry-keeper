import { useRef, useState } from 'react';
import { CalendarDays, Camera, Check, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { Pet, WeightUnit } from '../types';
import { Field, Notice, Segmented, Sheet, TextInput, Toggle } from './ui';
import { breedSuggestions, type BreedSuggestion } from '../lib/breeds';
import { captureNativePhoto, isNative } from '../lib/native';
import { downscale, readAsDataUrl } from '../lib/image';
import { deletePhoto, putPhoto } from '../lib/storage';
import { PetAvatar } from './PetAvatar';
import { isValidIso, todayIso } from '../lib/shelfLife';
import { formatWeight, WEIGHT_UNITS, weightFromKg, weightToKg } from '../lib/pets';

const SPECIES = [
  { value: 'cat', label: '猫' },
  { value: 'dog', label: '狗' },
  { value: 'other', label: '其他' },
] as const;

const GENDERS = [
  { value: 'male', label: '公' },
  { value: 'female', label: '母' },
  { value: 'unknown', label: '未知' },
] as const;

export function PetSheet({
  pet,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  pet: Pet;
  isNew: boolean;
  onClose: () => void;
  onSave: (pet: Pet) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<Pet>(pet);
  const [breedOpen, setBreedOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>();
  const [avatarHint, setAvatarHint] = useState('');
  const [formError, setFormError] = useState('');
  const [avatarSourceOpen, setAvatarSourceOpen] = useState(false);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(pet.weightUnit ?? 'jin');
  const [weightInput, setWeightInput] = useState(
    weightFromKg(pet.weightKg, pet.weightUnit ?? 'jin')?.toString() ?? '',
  );
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarCameraInputRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const birthDateRef = useRef<HTMLInputElement | null>(null);
  const birthDatePickerRef = useRef<HTMLInputElement | null>(null);
  const [birthDateText, setBirthDateText] = useState(pet.birthDate ?? '');
  const patch = (next: Partial<Pet>) => setDraft((current) => ({ ...current, ...next }));
  const suggestions = breedSuggestions(draft.species, draft.breed ?? '');
  const birthdayError =
    birthDateText.trim() && !isValidIso(birthDateText)
      ? '出生日期请按 YYYY-MM-DD 填写'
      : birthDateText > todayIso()
        ? '出生日期不能晚于今天'
        : '';
  const parsedWeight = weightInput.trim() === '' ? undefined : Number(weightInput);
  const physicalWeightKg = weightToKg(parsedWeight ?? Number.NaN, weightUnit);
  const weightError =
    parsedWeight !== undefined && Number.isFinite(parsedWeight) && parsedWeight < 0
      ? '体重不能为负'
      : parsedWeight !== undefined && Number.isFinite(parsedWeight) && parsedWeight === 0
        ? '体重必须大于 0'
        : weightInput.trim() && !Number.isFinite(parsedWeight)
          ? '请输入有效体重'
          : '';
  const overweightHint =
    physicalWeightKg !== undefined && physicalWeightKg > 100
      ? '体重超过 100kg，请确认单位是千克且没有多输一位'
      : '';

  const applyAvatar = async (dataUrl: string) => {
    setAvatarBusy(true);
    setAvatarHint('');
    try {
      const compact = await downscale(dataUrl, 256, 0.82);
      setAvatarPreview(compact);
      setAvatarHint('头像已选好，保存档案后写入本机');
    } catch (error) {
      setAvatarHint(error instanceof Error ? error.message : '头像保存失败，保留默认图标');
    } finally {
      setAvatarBusy(false);
    }
  };

  const chooseAvatar = async (source: 'camera' | 'photos') => {
    setAvatarSourceOpen(false);
    if (isNative()) {
      try {
        const photo = await captureNativePhoto(source);
        if (photo) await applyAvatar(photo);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!/cancel/i.test(reason)) setAvatarHint('相机不可用，可以改用相册');
      }
      return;
    }
    if (source === 'camera') avatarCameraInputRef.current?.click();
    else avatarInputRef.current?.click();
  };

  const save = async () => {
    // 安卓中文输入法可能只更新 DOM、不触发 React change；保存时以输入框实际值为准
    const name = (nameRef.current?.value ?? draft.name).trim();
    const birthDate = (birthDateRef.current?.value ?? birthDateText).trim();
    if (!name) {
      setFormError('请先填写名字');
      return;
    }
    if (birthDate && (!isValidIso(birthDate) || birthDate > todayIso())) {
      setFormError(
        birthDate > todayIso() ? '出生日期不能晚于今天' : '出生日期请按 YYYY-MM-DD 填写',
      );
      return;
    }
    if (weightError) {
      setFormError(weightError);
      return;
    }
    setFormError('');
    let next: Pet = {
      ...draft,
      name,
      birthDate: birthDate || undefined,
      weightKg:
        physicalWeightKg !== undefined && physicalWeightKg > 0
          ? physicalWeightKg
          : undefined,
      weightUnit,
    };
    if (avatarPreview) {
      const photoId = `avatar_${draft.id}`;
      if (!(await putPhoto(photoId, avatarPreview))) {
        setFormError('头像写入本机失败，可以重试或先保留默认图标');
        return;
      }
      next = { ...next, avatarPhotoId: photoId };
    } else if (!draft.avatarPhotoId && pet.avatarPhotoId) {
      await deletePhoto(pet.avatarPhotoId);
    }
    onSave(next);
  };

  const changeWeightUnit = (nextUnit: WeightUnit) => {
    const currentKg = weightToKg(Number(weightInput), weightUnit);
    setWeightUnit(nextUnit);
    setWeightInput(weightFromKg(currentKg, nextUnit)?.toString() ?? '');
    patch({
      weightUnit: nextUnit,
      weightKg: currentKg !== undefined && currentKg > 0 ? currentKg : undefined,
    });
  };

  const weightPlaceholder =
    weightUnit === 'g' ? '例如 100' : weightUnit === 'jin' ? '例如 10' : '例如 5';

  return (
    <Sheet
      title={isNew ? '添加宠物' : '宠物档案'}
      subtitle="体重与出生日期会影响每日建议喂食量"
      onClose={onClose}
      footer={
        <div className="foot-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            <Check size={16} />
            保存
          </button>
        </div>
      }
    >
      <Field label="名字" required>
        <TextInput
          ref={nameRef}
          value={draft.name}
          placeholder="例如 奶糖"
          onChange={(event) => patch({ name: event.target.value })}
          onInput={() => {
            const name = nameRef.current?.value;
            if (name !== undefined) patch({ name });
          }}
          onBlur={() => {
            const name = nameRef.current?.value.trim();
            if (name !== undefined) patch({ name });
          }}
        />
      </Field>
      <Field label="种类">
        <Segmented
          value={draft.species}
          onChange={(species) => patch({ species })}
          options={SPECIES.map((option) => ({ value: option.value, label: option.label }))}
        />
      </Field>
      <div className="avatar-editor">
        {avatarPreview ? (
          <span className="pet-avatar pet-avatar-lg">
            <img src={avatarPreview} alt="" />
          </span>
        ) : (
          <PetAvatar pet={draft} size="lg" />
        )}
        <div className="avatar-editor-main">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={avatarBusy}
            onClick={() => setAvatarSourceOpen((open) => !open)}
          >
            <Camera size={15} />
            {avatarBusy ? '处理中…' : '更换头像'}
          </button>
          {avatarSourceOpen ? (
            <div className="avatar-source-picker">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void chooseAvatar('camera')}>
                <Camera size={14} />
                拍照
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void chooseAvatar('photos')}>
                <ImageIcon size={14} />
                从相册选择
              </button>
            </div>
          ) : null}
          <span className="muted tiny">图片压到 256×256 后只存本机，导出备份不含头像</span>
          {avatarHint ? <span className="muted tiny">{avatarHint}</span> : null}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">品种</span>
          <div className="breed-picker">
            <TextInput
              value={draft.breed ?? ''}
              placeholder={draft.species === 'dog' ? '例如 金毛' : '例如 金渐层'}
              onFocus={() => setBreedOpen(true)}
              onChange={(event) => {
                patch({ breed: event.target.value });
                setBreedOpen(true);
              }}
              onBlur={() => window.setTimeout(() => setBreedOpen(false), 120)}
            />
            {breedOpen && draft.species !== 'other' ? (
              <div className="breed-menu">
                {suggestions.map((entry: BreedSuggestion) => (
                  <button
                    key={entry.name}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      patch({ breed: entry.name });
                      setBreedOpen(false);
                    }}
                  >
                    <span>{entry.name}</span>
                    <em>{entry.reason === '别名匹配' ? `别名匹配 · ${entry.aliases[0]}` : entry.reason}</em>
                  </button>
                ))}
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    patch({ breed: draft.breed?.trim() ?? '' });
                    setBreedOpen(false);
                  }}
                >
                  <span>使用「{draft.breed?.trim() || '自定义品种'}」作为自定义品种</span>
                  <em>自由填写</em>
                </button>
              </div>
            ) : null}
          </div>
          <span className="field-hint">支持名称、别名和拼音首字母联想，也可以直接写自家叫法</span>
        </div>
        <Field label="头像 emoji" hint="不想用照片时可以留空或填一个 emoji">
          <TextInput
            value={draft.avatar && !draft.avatar.startsWith('data:image/') ? draft.avatar : ''}
            placeholder={draft.species === 'dog' ? '🐶' : '🐱'}
            maxLength={4}
            onChange={(event) => {
              setAvatarPreview(undefined);
              setAvatarHint('');
              patch({ avatar: event.target.value, avatarPhotoId: undefined });
            }}
          />
        </Field>
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">
            体重
            {weightError ? <span className="flag">待核对</span> : null}
          </span>
          <div className="inline">
            <TextInput
              aria-label="体重"
              value={weightInput}
              inputMode="decimal"
              placeholder={weightPlaceholder}
              onChange={(event) => {
                const next = event.target.value.replace(/[^\d.-]/g, '');
                setWeightInput(next);
                const value = Number(next);
                const kg = weightToKg(value, weightUnit);
                patch({ weightKg: kg !== undefined && kg > 0 ? kg : undefined });
              }}
            />
            <span className="weight-unit-label">{WEIGHT_UNITS.find((unit) => unit.value === weightUnit)?.label}</span>
          </div>
          <Segmented<WeightUnit>
            value={weightUnit}
            onChange={changeWeightUnit}
            options={WEIGHT_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
          />
          <span className="field-hint">默认按斤填写；刚出生的幼猫可切换到克</span>
        </div>
        <div className="field">
          <span className="field-label">
            出生日期
            {birthdayError ? <span className="flag">待核对</span> : null}
          </span>
          <div className="inline">
            <TextInput
              ref={birthDateRef}
              aria-label="出生日期"
              value={birthDateText}
              inputMode="numeric"
              maxLength={10}
              placeholder="YYYY-MM-DD"
              onChange={(event) => {
                setBirthDateText(event.target.value);
                patch({ birthDate: isValidIso(event.target.value) ? event.target.value : undefined });
              }}
              onInput={() => {
                const value = birthDateRef.current?.value ?? '';
                setBirthDateText(value);
                patch({ birthDate: isValidIso(value) ? value : undefined });
              }}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              aria-label="打开出生日期日历"
              title="打开出生日期日历"
              onClick={() => {
                const picker = birthDatePickerRef.current as
                  | (HTMLInputElement & { showPicker?: () => void })
                  | null;
                try {
                  if (picker?.showPicker) picker.showPicker();
                  else picker?.click();
                } catch {
                  picker?.click();
                }
              }}
            >
              <CalendarDays size={15} />
            </button>
          </div>
          <span className="field-hint">可直接输入 YYYY-MM-DD，也可以点日历选择</span>
          <input
            ref={birthDatePickerRef}
            type="date"
            value={draft.birthDate ?? ''}
            className="date-picker-proxy"
            aria-label="出生日期日历选择"
            onChange={(event) => {
              const value = event.target.value;
              setBirthDateText(value);
              patch({ birthDate: value || undefined });
            }}
          />
        </div>
      </div>
      {birthdayError ? <Notice level="error">{birthdayError}</Notice> : null}
      {weightError ? <Notice level="error">{weightError}</Notice> : null}
      {overweightHint ? <Notice level="warn">{overweightHint}</Notice> : null}
      {draft.weightHistory?.length ? (
        <p className="muted tiny">
          已记录 {draft.weightHistory.length} 次体重，最近一次 {draft.weightHistory[0].date} ·{' '}
          {formatWeight(draft.weightHistory[0].weightKg, weightUnit)}
        </p>
      ) : null}
      <Field label="性别">
        <Segmented
          value={draft.gender ?? 'unknown'}
          onChange={(gender) => patch({ gender })}
          options={GENDERS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </Field>
      <div className="block">
        <Toggle
          label="已绝育"
          hint="绝育后能量需求系数 1.0，未绝育 1.2"
          checked={Boolean(draft.neutered)}
          onChange={(neutered) => patch({ neutered })}
        />
      </div>
      {formError ? <Notice level="error">{formError}</Notice> : null}
      <Notice level="warn">
        满 1 岁自动按成猫计算，满 8 岁按老年计算；幼年（{'<'}1 岁）系数 1.2、老年（≥8 岁）0.8。
        出生日期不填时按成猫兜底。
      </Notice>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readAsDataUrl(file).then(applyAvatar);
        }}
      />
      <input
        ref={avatarCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readAsDataUrl(file).then(applyAvatar);
        }}
      />
      {!isNew && onDelete ? (
        <button type="button" className="btn btn-danger btn-block" onClick={onDelete}>
          <Trash2 size={16} />
          删除这只宠物
        </button>
      ) : null}
    </Sheet>
  );
}
