import { useCallback, useState } from 'react';
import { SEED_PROSPECTS } from '../data/seed';
import type { Prospect } from '../types';

// Edits made in the app (status, follow-up, notes) are kept per browser on top of the seed data.
const KEY = 'prospect-map.edits.v1';
type Edits = Record<string, Partial<Pick<Prospect, 'status' | 'followUp' | 'notes'>>>;

function loadEdits(): Edits {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveEdits(edits: Edits) {
  try {
    localStorage.setItem(KEY, JSON.stringify(edits));
  } catch {
    // Storage can be unavailable (private mode); edits then last for the session only.
  }
}

export function useProspects() {
  const [edits, setEdits] = useState<Edits>(loadEdits);

  const prospects: Prospect[] = SEED_PROSPECTS.map((p) => (edits[p.id] ? { ...p, ...edits[p.id] } : p));

  const update = useCallback((id: string, patch: Edits[string]) => {
    setEdits((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      saveEdits(next);
      return next;
    });
  }, []);

  return { prospects, update };
}

export function exportCallList(rows: { prospect: Prospect; distanceLabel?: string; address?: string }[]) {
  const header = ['Name', 'Company', 'Phone', 'Email', 'Status', 'Distance', 'Property'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map(({ prospect: p, distanceLabel, address }) =>
    [`${p.firstName} ${p.lastName}`, p.company, p.phone, p.email ?? '', p.status, distanceLabel ?? '', address ?? '']
      .map(esc)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `call-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
