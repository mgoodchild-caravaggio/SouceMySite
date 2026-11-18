import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface OutlookConnection {
  userId: string;
  mailbox: string;
  connectedAt: string;
  lastError?: string;
}

/** Calls one of Hub's server functions as the signed-in user. */
export async function callFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // The function's own message is in the response body.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

/** Everyone's Outlook connection status (never the tokens). */
export function useOutlookConnections() {
  const [connections, setConnections] = useState<OutlookConnection[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('outlook_status');
    if (e) return setError(e.message);
    setConnections(
      (data as { user_id: string; mailbox: string; connected_at: string; last_error: string | null }[]).map((r) => ({
        userId: r.user_id,
        mailbox: r.mailbox,
        connectedAt: r.connected_at,
        lastError: r.last_error ?? undefined,
      })),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { connections, error, reload: load };
}

/** Sends the browser to Microsoft to connect Outlook, returning to the current page afterwards. */
export async function connectOutlook() {
  const back = `${window.location.origin}/settings`;
  const { url } = await callFunction<{ url: string }>('outlook-connect', { returnTo: back });
  window.location.assign(url);
}
