import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Business } from '../types';

/** One person's mailbox for one business: Real Estate and Staging use different Microsoft 365 mailboxes. */
export interface OutlookConnection {
  userId: string;
  business: Business;
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

/** Everyone's Outlook connection status, per business (never the tokens). */
export function useOutlookConnections() {
  const [connections, setConnections] = useState<OutlookConnection[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('outlook_status');
    if (e) return setError(e.message);
    setConnections(
      (data as { user_id: string; business: Business; mailbox: string; connected_at: string; last_error: string | null }[]).map((r) => ({
        userId: r.user_id,
        business: r.business,
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

/** A person's connection for one business, if they have one. */
export const connectionFor = (connections: OutlookConnection[] | null, userId: string, business: Business) =>
  connections?.find((c) => c.userId === userId && c.business === business);

/** Sends the browser to Microsoft to connect one business's mailbox, returning to Settings afterwards. */
export async function connectOutlook(business: Business) {
  const back = `${window.location.origin}/settings?mailbox=${encodeURIComponent(business)}#outlook`;
  const { url } = await callFunction<{ url: string }>('outlook-connect', { returnTo: back, business });
  window.location.assign(url);
}
