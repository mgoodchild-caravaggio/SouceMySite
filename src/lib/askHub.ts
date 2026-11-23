// Ask Hub in the browser: the conversation loop and Hub's tools.
//
// Each step sends the conversation to the ask-hub function, which calls Claude with the stored key
// and logs the cost. When Claude asks for a tool, it runs here, over the data Hub has already loaded
// (and with the signed-in user's own permissions), and the result goes back on the next step.
// Ask Hub never changes data itself: propose_campaign_additions becomes a button the user clicks.

import { useCallback, useEffect, useState } from 'react';
import { stageLabel, type Stage } from './campaigns';
import { CONSENT_LABEL, consentState, displayName, followUpState, todayIso } from './filters';
import { haversineKm } from './geo';
import { KIND_LABEL, matchListing, matchRequirement, nearbyFor, type MatchResult } from './matching';
import { callFunction } from './outlook';
import type { ManualMatch, Opportunity } from './opportunities';
import { searchPlaces } from './services';
import { supabase } from './supabase';
import type { Business, Contact, LatLng } from '../types';

// ---- Message shapes (the subset of the Messages API that Ask Hub uses) ----
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking' | 'redacted_thinking'; [k: string]: unknown };
export interface Turn {
  role: 'user' | 'assistant';
  content: Block[];
}

/** A change Ask Hub suggests; nothing happens until the user clicks it. */
export interface Proposal {
  id: string;
  campaignId?: string;
  newCampaignName?: string;
  opportunityId?: string;
  contactIds: string[];
  why: string;
  done?: string;
}

export interface AiStatus {
  enabled: boolean;
  keySet: boolean;
  keyHint: string;
  monthlyCapUsd: number;
  model: string;
  monthSpendUsd: number;
}

/** Whether Ask Hub is on, the cap and this month's spend. */
export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const load = useCallback(async () => {
    const [{ data: s }, { data: spend }] = await Promise.all([
      supabase.from('ai_settings').select('enabled, key_set, key_hint, monthly_cap_usd, model').single(),
      supabase.rpc('ai_month_spend'),
    ]);
    setStatus({
      enabled: !!s?.enabled,
      keySet: !!s?.key_set,
      keyHint: s?.key_hint ?? '',
      monthlyCapUsd: Number(s?.monthly_cap_usd ?? 0),
      model: s?.model ?? '',
      monthSpendUsd: Number(spend ?? 0),
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { status, reload: load };
}

export const aiAdmin = (body: Record<string, unknown>) => callFunction<Omit<AiStatus, 'monthSpendUsd'>>('ai-admin', body);

// ---- Tools ----
export interface ToolContext {
  contacts: Contact[];
  opportunities: Opportunity[];
  manual?: ManualMatch[];
  business: Business;
  myId: string;
  people: { id: string; displayName: string }[];
  propose: (p: Omit<Proposal, 'id'>) => void;
}

const num = (v: unknown, dflt: number, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt;
};
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
const anyOf = (want: string[], have: string[]) => !want.length || lower(have).some((h) => lower(want).includes(h));
const point = (i: Record<string, unknown>): (LatLng & { radiusKm: number }) | null =>
  typeof i.lat === 'number' && typeof i.lng === 'number' ? { lat: i.lat, lng: i.lng, radiusKm: num(i.radius_km, 10, 200) } : null;
const km = (n: number) => Math.round(n * 10) / 10;

function contactSummary(c: Contact, ctx: ToolContext, from?: LatLng) {
  const props = c.properties.map((p) => ({
    address: p.address,
    acres: p.acres,
    category: p.category,
    relation: p.relation,
    ...(from && { km_away: km(haversineKm(from, p)) }),
  }));
  return {
    id: c.id,
    name: displayName(c),
    company: c.company === 'tbd' ? '' : c.company,
    business: c.business,
    prospect: c.isProspect,
    status: c.isProspect ? c.status : undefined,
    customer_types: c.customerTypes,
    categories: c.categories,
    regions: c.regions,
    phone: c.phone || undefined,
    email_consent: CONSENT_LABEL[consentState(c)],
    follow_up: c.followUpOn,
    assigned_to: ctx.people.find((p) => p.id === c.assignedTo)?.displayName,
    archived: !!c.archivedAt || undefined,
    properties: props.length ? props : undefined,
  };
}

function oppSummary(o: Opportunity, ctx: ToolContext) {
  const owner = ctx.contacts.find((c) => c.id === o.contactId);
  const property = owner?.properties.find((p) => p.id === o.propertyId);
  return {
    id: o.id,
    kind: o.kind,
    listing_type: o.listingType,
    title: o.title,
    status: o.status,
    contact: owner ? { id: owner.id, name: displayName(owner) } : o.contactId,
    property: property?.address,
    categories: o.categories,
    acres: o.acresMin != null || o.acresMax != null ? [o.acresMin ?? null, o.acresMax ?? null] : undefined,
    price: o.kind === 'listing' ? o.priceMin : o.priceMin != null || o.priceMax != null ? [o.priceMin ?? null, o.priceMax ?? null] : undefined,
    zoning: o.zoning.length ? o.zoning : undefined,
    servicing: o.servicing !== 'unknown' ? o.servicing : undefined,
    target_date: o.targetDate,
    assembly: o.assemblyWanted ? { min_total_acres: o.assemblyMinAcres } : undefined,
    area: o.areaLat != null ? { centre: o.areaLabel || `${o.areaLat.toFixed(3)}, ${o.areaLng?.toFixed(3)}`, radius_km: o.areaRadiusKm } : undefined,
    regions: o.regions.length ? o.regions : undefined,
    needs_detail: o.needsDetail || undefined,
    notes: o.notes || undefined,
  };
}

const matchSummary = (m: MatchResult) => ({
  score: m.score,
  contact: { id: m.contact.id, name: displayName(m.contact), company: m.contact.company === 'tbd' ? '' : m.contact.company, phone: m.contact.phone || undefined },
  kind: KIND_LABEL[m.kind],
  added_by_hand: m.manual ? true : undefined,
  reasons: m.reasons.map((r) => (r.tone === 'bad' ? `✗ ${r.text}` : r.text)),
  their_opportunity: m.opportunity?.id,
  property: m.property?.address,
  km: m.distanceKm != null ? km(m.distanceKm) : undefined,
});

/** Runs one tool call; returns JSON text for Claude. */
export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const byId = new Map(ctx.contacts.map((c) => [c.id, c]));
  switch (name) {
    case 'search_contacts': {
      const business = input.business === 'Staging' || input.business === 'Real Estate' ? input.business : ctx.business;
      const text = String(input.text ?? '').trim().toLowerCase();
      const at = point(input);
      const fu = input.follow_up as string | undefined;
      let rows = ctx.contacts
        .filter((c) => c.business === business && !c.archivedAt)
        .filter((c) => !input.prospects_only || c.isProspect)
        .filter((c) => anyOf(strs(input.customer_types), c.customerTypes) && anyOf(strs(input.categories), c.categories) && anyOf(strs(input.regions), c.regions))
        .filter((c) => !strs(input.statuses).length || (c.isProspect && anyOf(strs(input.statuses), [c.status])))
        .filter((c) => !input.assigned_to_me || c.assignedTo === ctx.myId)
        .filter((c) => {
          if (!fu) return true;
          if (!c.followUpOn) return false;
          const st = followUpState(c.followUpOn);
          return fu === 'any' || (fu === 'overdue' ? st === 'overdue' : st !== 'later');
        })
        .filter(
          (c) =>
            !text ||
            [displayName(c), c.company, c.phone, c.email ?? '', c.notes, ...c.properties.map((p) => p.address)].join(' ').toLowerCase().includes(text),
        )
        .map((c) => ({ c, d: at && c.properties.length ? Math.min(...c.properties.map((p) => haversineKm(at, p))) : undefined }));
      if (at) rows = rows.filter((r) => r.d != null && r.d <= at.radiusKm).sort((a, b) => a.d! - b.d!);
      const limit = num(input.limit, 25, 100);
      return JSON.stringify({ total: rows.length, shown: Math.min(limit, rows.length), contacts: rows.slice(0, limit).map((r) => contactSummary(r.c, ctx, at ?? undefined)) });
    }

    case 'get_contact': {
      const c = byId.get(String(input.contact_id));
      if (!c) return JSON.stringify({ error: 'No contact with that id.' });
      const [{ data: acts }, { data: mems }, { data: meets }] = await Promise.all([
        supabase.from('activities').select('kind, body, occurred_at').eq('contact_id', c.id).order('occurred_at', { ascending: false }).limit(15),
        supabase.from('campaign_members').select('stage, note, last_contacted_at, campaigns(id, name, match_status)').eq('contact_id', c.id),
        supabase.from('meetings').select('kind, subject, starts_at').eq('contact_id', c.id).eq('status', 'scheduled').gte('starts_at', new Date().toISOString()).order('starts_at').limit(5),
      ]);
      return JSON.stringify({
        ...contactSummary(c, ctx),
        title: c.title || undefined,
        email: c.email,
        phone2: c.phone2 || undefined,
        lead_source: c.leadSource || undefined,
        deal_value: c.dealValue,
        notes: c.notes || undefined,
        opportunities: ctx.opportunities.filter((o) => o.contactId === c.id).map((o) => oppSummary(o, ctx)),
        campaigns: (mems ?? []).map((m) => {
          const camp = (m as unknown as { campaigns: { id: string; name: string; match_status: string } | null }).campaigns;
          return { id: camp?.id, name: camp?.name, closed: camp?.match_status === 'closed' || undefined, stage: m.stage, note: m.note || undefined, last_contacted: m.last_contacted_at?.slice(0, 10) };
        }),
        upcoming_meetings: meets ?? [],
        recent_activity: (acts ?? []).map((a) => ({ kind: a.kind, when: String(a.occurred_at).slice(0, 10), text: a.body || undefined })),
      });
    }

    case 'locate': {
      const place = String(input.place ?? '').trim();
      if (!place) return JSON.stringify({ error: 'Say which place.' });
      const found = await searchPlaces(/ontario|on\b|canada/i.test(place) ? place : `${place}, Ontario`);
      if (!found.length) return JSON.stringify({ error: `Couldn't find "${place}".` });
      return JSON.stringify({ results: found.slice(0, 3).map((p) => ({ label: p.label, lat: Math.round(p.lat * 1e4) / 1e4, lng: Math.round(p.lng * 1e4) / 1e4 })) });
    }

    case 'list_opportunities': {
      const at = point(input);
      const status = String(input.status ?? 'open');
      let rows = ctx.opportunities
        .filter((o) => byId.get(o.contactId)?.business === ctx.business && !byId.get(o.contactId)?.archivedAt)
        .filter((o) => !input.kind || o.kind === input.kind)
        .filter((o) => status === 'any' || o.status === status)
        .filter((o) => !input.contact_id || o.contactId === input.contact_id)
        .filter((o) => !input.needs_detail || o.needsDetail)
        .filter((o) => anyOf(strs(input.categories), o.categories))
        .map((o) => {
          if (!at) return { o, d: undefined as number | undefined };
          if (o.kind === 'listing') {
            const p = byId.get(o.contactId)?.properties.find((x) => x.id === o.propertyId);
            return { o, d: p ? haversineKm(at, p) : undefined };
          }
          // A requirement "reaches" a point when the point is inside its area (distance 0) or near it.
          return { o, d: o.areaLat != null && o.areaLng != null ? Math.max(0, haversineKm(at, { lat: o.areaLat, lng: o.areaLng }) - (o.areaRadiusKm ?? 25)) : undefined };
        });
      if (at) rows = rows.filter((r) => r.d != null && r.d <= at.radiusKm).sort((a, b) => a.d! - b.d!);
      const limit = num(input.limit, 25, 100);
      return JSON.stringify({ total: rows.length, shown: Math.min(limit, rows.length), opportunities: rows.slice(0, limit).map((r) => ({ ...oppSummary(r.o, ctx), ...(r.d != null && { km: km(r.d) }) })) });
    }

    case 'find_matches': {
      const o = ctx.opportunities.find((x) => x.id === input.opportunity_id);
      const owner = o && byId.get(o.contactId);
      if (!o || !owner) return JSON.stringify({ error: 'No listing or requirement with that id.' });
      const subject = { opportunity: o, contact: owner, property: owner.properties.find((p) => p.id === o.propertyId) };
      const data = { contacts: ctx.contacts, opportunities: ctx.opportunities, manual: ctx.manual };
      const results = o.kind === 'listing' ? matchListing(subject, data) : matchRequirement(subject, data);
      const limit = num(input.limit, 15, 50);
      return JSON.stringify({ for: oppSummary(o, ctx), total: results.length, matches: results.slice(0, limit).map(matchSummary) });
    }

    case 'nearby': {
      const c = byId.get(String(input.contact_id));
      if (!c) return JSON.stringify({ error: 'No contact with that id.' });
      if (!c.properties.length) return JSON.stringify({ error: `${displayName(c)} has no properties on the map.` });
      const items = nearbyFor(c, { contacts: ctx.contacts, opportunities: ctx.opportunities }, num(input.radius_km, 10, 100));
      return JSON.stringify({
        total: items.length,
        items: items.slice(0, 30).map((n) => ({ contact: { id: n.contact.id, name: displayName(n.contact) }, what: n.label, km: km(n.distanceKm), opportunity: n.opportunity?.id })),
      });
    }

    case 'list_campaigns': {
      const { data } = await supabase
        .from('campaigns')
        .select('id, name, opportunity_id, match_status, criteria, created_at')
        .eq('kind', 'match')
        .eq('business', ctx.business)
        .order('created_at', { ascending: false });
      const rows = (data ?? []).filter((c) => input.include_closed || c.match_status === 'active');
      const { data: mems } = rows.length
        ? await supabase.from('campaign_members').select('campaign_id, stage').in('campaign_id', rows.map((r) => r.id))
        : { data: [] };
      return JSON.stringify({
        campaigns: rows.map((c) => {
          const counts: Partial<Record<Stage, number>> = {};
          for (const m of mems ?? []) if (m.campaign_id === c.id) counts[m.stage as Stage] = (counts[m.stage as Stage] ?? 0) + 1;
          const o = ctx.opportunities.find((x) => x.id === c.opportunity_id);
          return { id: c.id, name: c.name, closed: c.match_status === 'closed' || undefined, opportunity: o ? { id: o.id, title: o.title } : undefined, area: c.criteria?.area?.label || undefined, members_by_stage: counts };
        }),
      });
    }

    case 'campaign_members': {
      let q = supabase.from('campaign_members').select('contact_id, stage, score, reasons, note, last_contacted_at').eq('campaign_id', String(input.campaign_id));
      if (typeof input.stage === 'string') q = q.eq('stage', input.stage);
      const { data, error } = await q.limit(300);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify({
        total: data.length,
        members: data.map((m) => {
          const c = byId.get(m.contact_id);
          return {
            contact: { id: m.contact_id, name: c ? displayName(c) : m.contact_id, phone: c?.phone || undefined },
            stage: stageLabel(m.stage as Stage),
            score: m.score ?? undefined,
            reasons: ((m.reasons ?? []) as { text: string }[]).map((r) => r.text),
            note: m.note || undefined,
            last_contacted: m.last_contacted_at?.slice(0, 10),
          };
        }),
      });
    }

    case 'propose_campaign_additions': {
      const ids = strs(input.contact_ids).filter((id) => byId.has(id)).slice(0, 50);
      if (!ids.length) return JSON.stringify({ error: 'None of those contact ids exist.' });
      const campaignId = typeof input.campaign_id === 'string' ? input.campaign_id : undefined;
      const newName = typeof input.new_campaign_name === 'string' ? input.new_campaign_name.trim() : '';
      if (!campaignId && !newName) return JSON.stringify({ error: 'Give campaign_id or new_campaign_name.' });
      ctx.propose({
        campaignId,
        newCampaignName: campaignId ? undefined : newName,
        opportunityId: typeof input.opportunity_id === 'string' ? input.opportunity_id : undefined,
        contactIds: ids,
        why: String(input.why ?? ''),
      });
      return JSON.stringify({ ok: true, shown_to_user: `A button to add ${ids.length} as Suggested. Nothing has changed yet; the user decides.` });
    }

    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}

/** The date, the asker and their page, at the start of each question (kept out of the cached system prompt). */
export function contextLine(opts: { name: string; business: Business; page: string }) {
  const today = new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `[Context: today is ${today} (${todayIso()}); ${opts.name} is asking, viewing ${opts.business}${opts.page ? `; on ${opts.page}` : ''}.]`;
}

export interface StepResult {
  content: Block[];
  stopReason: string;
  costUsd: number;
  monthSpendUsd: number;
  monthlyCapUsd: number;
}

const MAX_STEPS = 12;

/**
 * Runs a conversation forward until Claude answers: call, run any tools it asks for, repeat.
 * `onTurn` sees each new turn as it lands so the panel can show progress.
 */
export async function runConversation(
  turns: Turn[],
  opts: { conversationId: string; question: string; ctx: ToolContext; onTurn: (t: Turn) => void; onCost: (r: StepResult) => void },
): Promise<Turn[]> {
  let history = turns;
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await callFunction<StepResult>('ask-hub', { conversationId: opts.conversationId, question: opts.question, messages: history });
    opts.onCost(r);
    const assistant: Turn = { role: 'assistant', content: r.content };
    history = [...history, assistant];
    opts.onTurn(assistant);

    if (r.stopReason === 'refusal') throw new Error('Claude declined to answer that. Try rephrasing.');
    const uses = r.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (r.stopReason === 'max_tokens' && uses.length) throw new Error('The answer was cut off. Try a narrower question.');
    if (r.stopReason !== 'tool_use' || !uses.length) return history;

    const results: Block[] = [];
    for (const u of uses) {
      try {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input ?? {}, opts.ctx) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${(e as Error).message}`, is_error: true });
      }
    }
    const user: Turn = { role: 'user', content: results };
    history = [...history, user];
    opts.onTurn(user);
  }
  throw new Error('That took too many steps. Try a more specific question.');
}

/** Friendly names for tool calls, shown while Ask Hub works. */
export const TOOL_LABEL: Record<string, string> = {
  search_contacts: 'Searching contacts',
  get_contact: 'Reading a contact',
  locate: 'Finding a place',
  list_opportunities: 'Looking at listings and requirements',
  find_matches: 'Finding matches',
  nearby: 'Looking nearby',
  list_campaigns: 'Checking campaigns',
  campaign_members: 'Reading a campaign list',
  propose_campaign_additions: 'Preparing a suggestion',
};


