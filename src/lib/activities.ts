import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored', 'campaign_sent', 'unsubscribed', 'bounced', 'campaign_stage', 'match_added', 'file_added', 'file_removed'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
/** Kinds people log by hand; the rest are recorded automatically. */
export const LOGGABLE_KINDS = ['call', 'note', 'email', 'meeting'] as const;
export type LoggableKind = (typeof LOGGABLE_KINDS)[number];

export const KIND_LABEL: Record<ActivityKind, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  status_change: 'Status changed',
  follow_up_done: 'Follow-up done',
  created: 'Added',
  archived: 'Archived',
  restored: 'Restored',
  campaign_sent: 'Campaign email',
  unsubscribed: 'Unsubscribed',
  bounced: 'Email bounced',
  campaign_stage: 'Campaign',
  match_added: 'Match',
  file_added: 'File attached',
  file_removed: 'File removed',
};

export interface Activity {
  id: string;
  contactId: string;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  createdBy?: string;
}

interface ActivityRow {
  id: string;
  contact_id: string;
  kind: ActivityKind;
  body: string;
  occurred_at: string;
  created_by: string | null;
}

const fromRow = (r: ActivityRow): Activity => ({
  id: r.id,
  contactId: r.contact_id,
  kind: r.kind,
  body: r.body,
  occurredAt: r.occurred_at,
  createdBy: r.created_by ?? undefined,
});

/** The activity timeline for one contact, newest first, with add and delete. */
export function useActivities(contactId: string | undefined, onError: (message: string) => void) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!contactId) return;
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false });
    if (error) onError(`Couldn't load activity: ${error.message}`);
    else setActivities((data as ActivityRow[]).map(fromRow));
    setLoading(false);
  }, [contactId, onError]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const add = useCallback(
    async (kind: ActivityKind, body: string, occurredAt?: string) => {
      if (!contactId) return null;
      const { data, error } = await supabase
        .from('activities')
        .insert({ contact_id: contactId, kind, body, ...(occurredAt && { occurred_at: occurredAt }) })
        .select()
        .single();
      if (error) {
        onError(`Couldn't log the activity: ${error.message}`);
        return null;
      }
      const activity = fromRow(data as ActivityRow);
      setActivities((prev) => [activity, ...prev].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
      return activity;
    },
    [contactId, onError],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('activities').delete().eq('id', id);
      if (error) return onError(`Couldn't delete the entry: ${error.message}`);
      setActivities((prev) => prev.filter((a) => a.id !== id));
    },
    [onError],
  );

  return { activities, loading, add, remove, reload: load };
}

/** Logs one activity for a contact (outside a contact page). Returns its time, or null on failure. */
export async function logActivity(contactId: string, kind: ActivityKind, body = ''): Promise<string | null> {
  const { data, error } = await supabase.from('activities').insert({ contact_id: contactId, kind, body }).select('occurred_at').single();
  return error ? null : (data as { occurred_at: string }).occurred_at;
}

export interface FeedItem extends Activity {
  contactName: string;
  contactCompany: string;
}

/** The latest activity across the team in one business, newest first. */
export function useRecentActivity(business: string, limit: number) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('activities')
      .select('*, contacts!inner(first_name, last_name, company, business, archived_at)')
      .eq('contacts.business', business)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (e) return setError(e.message);
    type Row = ActivityRow & { contacts: { first_name: string; last_name: string; company: string } };
    setItems(
      (data as Row[]).map((r) => ({
        ...fromRow(r),
        contactName: `${r.contacts.first_name} ${r.contacts.last_name}`.trim(),
        contactCompany: r.contacts.company === 'tbd' ? '' : r.contacts.company,
      })),
    );
  }, [business, limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, error, reload: load };
}

export interface DayItem extends FeedItem {
  business: string;
}

/** Everything one person did on one day (local time), oldest first, across both businesses. */
export function useDayActivity(userId: string, day: string) {
  const [items, setItems] = useState<DayItem[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const { data, error: e } = await supabase
      .from('activities')
      .select('*, contacts!inner(first_name, last_name, company, business)')
      .eq('created_by', userId)
      .gte('occurred_at', start.toISOString())
      .lt('occurred_at', end.toISOString())
      .not('kind', 'in', '(unsubscribed,bounced)')
      .order('occurred_at', { ascending: true })
      .limit(1000);
    if (e) return setError(e.message);
    setError('');
    type Row = ActivityRow & { contacts: { first_name: string; last_name: string; company: string; business: string } };
    setItems(
      (data as Row[]).map((r) => ({
        ...fromRow(r),
        contactName: `${r.contacts.first_name} ${r.contacts.last_name}`.trim(),
        contactCompany: r.contacts.company === 'tbd' ? '' : r.contacts.company,
        business: r.contacts.business,
      })),
    );
  }, [userId, day]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  return { items, error, reload: load };
}
