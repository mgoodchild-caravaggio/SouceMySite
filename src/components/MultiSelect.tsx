import { useEffect, useRef, useState } from 'react';

interface Props<T extends string> {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  /** How to show an option, when its value isn't the label. */
  format?: (o: T) => string;
}

export function MultiSelect<T extends string>({ label, options, value, onChange, format = (o) => o }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = (o: T) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);

  return (
    <div className="ms" ref={ref}>
      <button
        type="button"
        className={`chip-btn ${value.length ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {value.length > 0 && <span className="count">{value.length}</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="ms-pop" role="listbox" aria-multiselectable="true">
          {options.map((o) => (
            <label key={format(o)} className="ms-opt">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
              <span>{format(o)}</span>
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" className="link-btn ms-clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
