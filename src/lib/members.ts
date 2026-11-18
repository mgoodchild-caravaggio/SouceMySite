import { useCallback, useEffect, useState } from 'react';
import type { Reason } from './matching';
import type { Stage } from './campaigns';
import { supabase } from './supabase';

export type MemberSource = 'match' | 'manual' | 'map' | 'contact' | 'ai';

/** Someone on a matching campaign's list. */
export interface Member {
  id: string;
  campaignId: string;
  contactId: string;
  stage: Stage;
  score?: number;
  reasons: Reason[];
  source: MemberSource;
  note: string;
  lastContactedAt?: string;
  assignedTo?: string;
  addedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewMember {
  contactId: string;
  stage?: Stage;
  score?: number;
  reasons?: Reason[];
  source: MemberSource;
}

interface Row {
  id: string;
  campaign_id: string;
  contact_id: string;
  stage: Stage;
  score: number | null;
  reasons: Reason[];
  source: MemberSource;
  note: string;
  last_contacted_at: string | null;
  assigned_to: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

const fromRow = (r: Row): Member => ({
  id: r.id,
  campaignId: r.campaign_id,
  contactId: r.contact_id,
  stage: r.stage,
  score: r.score ?? undefined,
  reasons: r.reasons ?? [],
  source: r.source,
  note: r.note,
  lastContactedAt: r.last_contacted_at ?? undefined,
  assignedTo: r.assigned_to ?? undefined,
  addedBy: r.added_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type MemberPatch = Partial<Pick<Member, 'stage' | 'note' | 'lastContactedAt' | 'assignedTo'>>;

const patchRow = (p: MemberPatch) => {
  const row: Record<string, unknown> = {};
  if (p.stage !== undefined) row.stage = p.stage;
  if (p.note !== undefined) row.note = p.note;
  if (p.lastContactedAt !== undefined) row.last_contacted_at = p.lastContactedAt || null;
  if (p.assignedTo !== undefined) row.assigned_to = p.assignedTo || null;
  return row;
};

/** Moving someone to "Contacted" (or further) also records when they were last contacted. */
export function withContactDate(m: Member, patch: MemberPatch): MemberPatch {
  const reached = patch.stage && ['contacted', 'interested', 'not_interested', 'offer'].includes(patch.stage);
  return reached && m.stage !== patch.stage && !patch.lastContactedAt ? { ...patch, lastContactedAt: new Date().toISOString() } : patch;
}

export async function addMembers(campaignId: string, people: NewMember[]): Promise<string> {
  if (!people.length) return '';
  const rows = people.map((p) => ({
    campaign_id: campaignId,
    contact_id: p.contactId,
    stage: p.stage ?? 'shortlisted',
    score: p.score ?? null,
    reasons: p.reasons ?? [],
    source: p.source,
  }));
  // Someone already on the list stays as they are.
  const { error } = await supabase.from('campaign_members').upsert(rows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true });
  return error?.message ?? '';
}

export async function updateMember(id: string, patch: MemberPatch): Promise<string> {
  const { error } = await supabase.from('campaign_members').update(patchRow(patch)).eq('id', id);
  return error?.message ?? '';
}

export async function removeMembers(ids: string[]): Promise<string> {
  const { error } = await supabase.from('campaign_members').delete().in('id', ids);
  return error?.message ?? '';
}

async function fetchAll(filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const all: Row[] = [];
  // Supabase returns at most 1,000 rows per request.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(base()).order('created_at').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data as Row[]));
    if (data.length < 1000) return all.map(fromRow);
  }
}
const base = () => supabase.from('campaign_members').select('*');

/** A campaign's members, with add/update/remove that keep the list in step. */
export function useMembers(campaignId: string) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setMembers(await fetchAll((q) => q.eq('campaign_id', campaignId)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [campaignId]);
  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (people: NewMember[]) => {
      const err = await addMembers(campaignId, people);
      if (err) setError(err);
      await load();
      return err;
    },
    [campaignId, load],
  );

  const update = useCallback(async (m: Member, patch: MemberPatch) => {
    const full = withContactDate(m, patch);
    setMembers((prev) => prev?.map((x) => (x.id === m.id ? { ...x, ...full } : x)) ?? prev);
    const err = await updateMember(m.id, full);
    if (err) {
      setError(err);
      setMembers((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
    }
    return err;
  }, []);

  const remove = useCallback(async (ids: string[]) => {
    const err = await removeMembers(ids);
    if (err) setError(err);
    else setMembers((prev) => prev?.filter((x) => !ids.includes(x.id)) ?? prev);
    return err;
  }, []);

  return { members, error, setError, reload: load, add, update, remove };
}

/** Every campaign a contact is on, with the campaign's name. */
export function useContactMemberships(contactId: string) {
  const [items, setItems] = useState<(Member & { campaignName: string; campaignClosed: boolean })[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('campaign_members')
      .select('*, campaigns(name, match_status)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setItems(
      ((data ?? []) as (Row & { campaigns: { name: string; match_status: string } | null })[]).map((r) => ({
        ...fromRow(r),
        campaignName: r.campaigns?.name ?? 'Campaign',
        campaignClosed: r.campaigns?.match_status === 'closed',
      })),
    );
  }, [contactId]);
  useEffect(() => {
    load();
  }, [load]);
  return { items, reload: load };
}

/** Member counts by stage for every campaign, for the campaigns list. */
export async function fetchStageCounts(): Promise<Map<string, Partial<Record<Stage, number>>>> {
  const out = new Map<string, Partial<Record<Stage, number>>>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('campaign_members').select('campaign_id, stage').order('id').range(from, from + 999);
    for (const r of (data ?? []) as { campaign_id: string; stage: Stage }[]) {
      const m = out.get(r.campaign_id) ?? {};
      m[r.stage] = (m[r.stage] ?? 0) + 1;
      out.set(r.campaign_id, m);
    }
    if (!data || data.length < 1000) return out;
  }
}
