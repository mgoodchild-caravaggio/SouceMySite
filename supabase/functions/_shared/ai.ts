// Ask Hub: the Anthropic client, the stored key and pricing. Used by ask-hub and ai-admin.
import Anthropic from 'npm:@anthropic-ai/sdk@1.5.0';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decrypt } from './crypto.ts';
import { HttpError } from './supabase.ts';

export { Anthropic };

export interface AiSettings {
  enabled: boolean;
  monthly_cap_usd: number;
  model: string;
  key_set: boolean;
  key_hint: string;
}

export async function loadSettings(db: SupabaseClient): Promise<AiSettings> {
  const { data } = await db.from('ai_settings').select('enabled, monthly_cap_usd, model, key_set, key_hint').single();
  return { ...(data as AiSettings), monthly_cap_usd: Number(data?.monthly_cap_usd ?? 0) };
}

/** A client using the stored key; never returns the key itself. */
export async function clientFor(db: SupabaseClient): Promise<Anthropic> {
  const { data } = await db.from('ai_secrets').select('api_key_enc').maybeSingle();
  if (!data) throw new HttpError(409, 'Ask Hub has no Anthropic API key. An admin can add one in Settings.');
  return new Anthropic({ apiKey: await decrypt(data.api_key_enc), maxRetries: 2, timeout: 120_000 });
}

export async function monthSpend(db: SupabaseClient): Promise<number> {
  const { data } = await db.rpc('ai_month_spend');
  return Number(data ?? 0);
}

// US dollars per million tokens. Cache writes are the 5-minute kind (1.25x input).
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
};
/** Web search is billed per search on top of tokens. */
export const WEB_SEARCH_USD = 10 / 1000;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  return (
    (u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead) / 1e6 +
    searches * WEB_SEARCH_USD
  );
}
