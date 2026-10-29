import { useCallback, useEffect, useRef } from 'react';
import type { ComponentPropsWithRef, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { ExpiryStatus } from '../types';
import { STATUS_LABEL } from '../lib/shelfLife';

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <div className="sheet-head-text">
            <h2>{title}</h2>
            {subtitle ? <p className="muted small">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn-icon" aria-label="关闭" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Field({
  label,
  hint,
  flag,
  required,
  children,
}: {
  label: string;
  hint?: string;
  flag?: boolean;
  /** 必填项：按钮不会静默禁用，点确认时会明确说缺什么 */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required ? <span className="flag flag-required">必填</span> : null}
        {flag ? <span className="flag">待核对</span> : null}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * 文本输入框故意用「非受控 + 外部值同步」的写法：
 * 部分安卓输入法（尤其粘贴和中文联想）不会触发 React 的 change 事件，
 * 受控写法会在重渲染时把用户刚输入的内容顶回旧值，看起来就是「改不动」。
 * 这里让浏览器自己管输入，外部值变化时再同步进去，提交时以输入框里的实际内容为准。
 */
function useExternalValue(
  ref: { current: HTMLInputElement | HTMLTextAreaElement | null },
  value: string | number | readonly string[] | undefined,
) {
  const external = value === undefined ? undefined : String(value);
  useEffect(() => {
    const element = ref.current;
    if (!element || external === undefined) return;
    if (element.value !== external) element.value = external;
  }, [external, ref]);
}

export function TextInput({ className, value, ref: externalRef, ...rest }: ComponentPropsWithRef<'input'>) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  useExternalValue(innerRef, value);
  const attach = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof externalRef === 'function') externalRef(node);
      else if (externalRef) (externalRef as { current: HTMLInputElement | null }).current = node;
    },
    [externalRef],
  );
  return (
    <input
      {...rest}
      ref={attach}
      defaultValue={value === undefined ? undefined : String(value)}
      className={`input ${className ?? ''}`.trim()}
    />
  );
}

export function TextArea({
  className,
  value,
  ref: externalRef,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> & { ref?: Ref<HTMLTextAreaElement> }) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  useExternalValue(innerRef, value);
  const attach = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof externalRef === 'function') externalRef(node);
      else if (externalRef) (externalRef as { current: HTMLTextAreaElement | null }).current = node;
    },
    [externalRef],
  );
  return (
    <textarea
      {...rest}
      ref={attach}
      defaultValue={value === undefined ? undefined : String(value)}
      className={`input textarea ${className ?? ''}`.trim()}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 999,
  suffix,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="btn-icon"
        aria-label="减少"
        title="减少"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus size={16} />
      </button>
      <span className="stepper-value">
        {value}
        {suffix ? <em>{suffix}</em> : null}
      </span>
      <button
        type="button"
        className="btn-icon"
        aria-label="增加"
        title="增加"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info';
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: ExpiryStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Notice({ level, children }: { level: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  return <p className={`notice notice-${level}`}>{children}</p>;
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="toggle-row">
      <div>
        <p className="toggle-label">{label}</p>
        {hint ? <p className="muted small">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
      {action}
    </div>
  );
}
