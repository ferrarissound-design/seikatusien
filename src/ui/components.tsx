import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { href } from './router';
import { parseYen } from '../lib/money';

export function PageHead({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="page-head">
      {back && (
        <a className="icon-btn back-btn" href={href(back)} aria-label="戻る">
          <Icon name="back" />
        </a>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Card({ title, icon, action, children, className = '' }: { title?: ReactNode; icon?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-title">
          {title && (
            <h2>
              {icon && <span aria-hidden="true">{icon}</span>}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function ProgressBar({ value, max, label, tone }: { value: number; max: number; label: string; tone?: 'accent' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`progress ${tone ?? ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CheckRow({ checked, label, onToggle, round, sub }: { checked: boolean; label: string; onToggle: () => void; round?: boolean; sub?: ReactNode }) {
  return (
    <button type="button" className={`check-row ${checked ? 'checked' : ''}`} role="checkbox" aria-checked={checked} onClick={onToggle}>
      <span className={`checkbox ${round ? 'round' : ''}`} aria-hidden="true">
        {checked && <Icon name="check" size={20} />}
      </span>
      <span className="label-text">
        {label}
        {sub && <span className="muted small" style={{ display: 'block', textDecoration: 'none' }}>{sub}</span>}
      </span>
    </button>
  );
}

/** 下から出るシート。背景スクロールを止め、Esc で閉じる。 */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select');
    // iOS で自動的にキーボードが出て画面が跳ねないよう、自動フォーカスは最初の入力欄のみ・少し遅らせる
    if (first && first.dataset.autofocus === 'true') setTimeout(() => first.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </div>
        {children}
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            やめる
          </button>
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
    </Sheet>
  );
}

export function YenInput({
  value,
  onChange,
  label,
  autoFocus,
  allowEmpty = true,
  placeholder = '0',
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const invalid = value !== '' && parseYen(value) === null;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-yen">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9,]*"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          placeholder={placeholder}
          data-autofocus={autoFocus ? 'true' : undefined}
          aria-invalid={invalid || (!allowEmpty && value === '')}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {invalid && <div className="error-text">0以上の整数（円）で入力してください</div>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="spread" style={{ minHeight: 56 }}>
      <label htmlFor={id} className="grow">
        <div style={{ fontWeight: 600 }}>{label}</div>
        {description && <div className="muted small">{description}</div>}
      </label>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" aria-hidden="true" />
      </span>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="emoji" aria-hidden="true">
        {emoji}
      </span>
      {children}
    </div>
  );
}

/** 一行入力＋追加ボタン。Enter で追加し、入力欄を空にしてフォーカスを維持。 */
export function AddInline({ placeholder, onAdd, label }: { placeholder: string; onAdd: (v: string) => Promise<unknown> | void; label: string }) {
  const [v, setV] = useState('');
  const submit = async () => {
    const t = v.trim();
    if (!t) return;
    await onAdd(t.slice(0, 200));
    setV('');
  };
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input type="text" aria-label={label} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} enterKeyHint="done" maxLength={200} />
      <button type="submit" className="btn primary" aria-label="追加" disabled={!v.trim()} style={{ flex: 'none', padding: '10px 16px' }}>
        <Icon name="plus" />
      </button>
    </form>
  );
}
