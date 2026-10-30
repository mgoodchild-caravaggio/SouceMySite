import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { searchPlaces } from '../lib/services';
import type { Place } from '../types';

interface Props {
  placeholder: string;
  value: Place | null;
  onSelect: (p: Place | null) => void;
  /** Optional extra action shown inside the field, e.g. "use my location". */
  accessory?: ReactNode;
  large?: boolean;
}

/**
 * Address/place search backed by Nominatim. Searches on Enter rather than per keystroke,
 * as the public Nominatim usage policy does not allow autocomplete.
 */
export function PlaceSearch({ placeholder, value, onSelect, accessory, large }: Props) {
  const [text, setText] = useState(value?.label ?? '');
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const wrap = useRef<HTMLFormElement>(null);

  useEffect(() => setText(value?.label ?? ''), [value]);

  useEffect(() => {
    if (!results) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setResults(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [results]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError('');
    try {
      const found = await searchPlaces(q, abort.current.signal);
      if (found.length === 1) {
        onSelect(found[0]);
        setResults(null);
      } else {
        setResults(found);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`place-search ${large ? 'large' : ''}`} onSubmit={run} ref={wrap}>
      <svg className="ps-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        aria-label={placeholder}
      />
      {busy && <span className="spinner" aria-label="Searching" />}
      {value && !busy && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Clear"
          onClick={() => {
            setText('');
            onSelect(null);
          }}
        >
          ×
        </button>
      )}
      {accessory}
      {(results || error) && (
        <div className="ps-results">
          {error && <div className="ps-empty">{error}</div>}
          {results?.length === 0 && <div className="ps-empty">No matches. Try a town, street or postal code.</div>}
          {results?.map((r) => (
            <button
              type="button"
              key={`${r.lat},${r.lng}`}
              className="ps-row"
              onClick={() => {
                onSelect(r);
                setResults(null);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
