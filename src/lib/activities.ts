import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored'] as const;
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
