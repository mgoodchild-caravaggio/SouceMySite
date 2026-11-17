import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Category, CustomerType, Prospect, Region, Status } from '../types';

type Patch = Partial<Pick<Prospect, 'status' | 'followUp' | 'notes'>>;

interface PropertyRow {
  id: string;
  address: string;
  lat: number;
  lng: number;
  acres: number | null;
  category: Category;
  relation: 'Owns' | 'Interested in';
}

interface ProspectRow {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  phone: string;
  email: string | null;
  status: Status;
  lead_source: string;
  regions: Region[];
  categories: Category[];
  customer_types: CustomerType[];
  deal_value: number | null;
  follow_up: boolean;
  campaigns: string[];
  notes: string;
  properties: PropertyRow[];
}

function fromRow(r: ProspectRow): Prospect {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    company: r.company,
    phone: r.phone,
    email: r.email ?? undefined,
    status: r.status,
    leadSource: r.lead_source,
    regions: r.regions,
    categories: r.categories,
    customerTypes: r.customer_types,
    dealValue: r.deal_value ?? undefined,
    followUp: r.follow_up,
    campaigns: r.campaigns,
    notes: r.notes,
    properties: r.properties.map((p) => ({ ...p, acres: p.acres ?? undefined })),
  };
}

function toRow(patch: Patch) {
  return {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.followUp !== undefined && { follow_up: patch.followUp }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  };
}

/** Loads every prospect with its properties, and saves status / follow-up / notes edits to Supabase. */
export function useProspects(onError: (message: string) => void) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const prospectsRef = useRef(prospects);
  prospectsRef.current = prospects;

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('prospects')
      .select('*, properties(*)')
      .order('id')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) onError(`Couldn't load prospects: ${error.message}`);
        else setProspects((data as ProspectRow[]).map(fromRow));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const update = useCallback(
    async (id: string, patch: Patch) => {
      // Show the change straight away, and put the old values back if the save fails.
      const before = prospectsRef.current.find((p) => p.id === id);
      if (!before) return;
      const undo = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Patch]])) as Patch;
      setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      const { error } = await supabase.from('prospects').update(toRow(patch)).eq('id', id);
      if (error) {
        setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...undo } : p)));
        onError(`Couldn't save the change: ${error.message}`);
      }
    },
    [onError],
  );

  return { prospects, loading, update };
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
