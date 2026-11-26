import { useCallback, useEffect, useState } from 'react';
import { consentState } from './filters';
import { callFunction } from './outlook';
import { supabase } from './supabase';
import { fillTemplate } from './templates';
import type { Business, Category, Contact, CustomerType, Region, Status } from '../types';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';

export interface Audience {
  /** prospects only, every contact, or only non-prospect contacts */
  who: 'prospects' | 'all' | 'other';
  statuses: Status[];
  customerTypes: CustomerType[];
  categories: Category[];
  regions: Region[];
  campaigns: string[];
  /** An email blast from a matching campaign: only its members (in these stages, if any are picked). */
  memberOf?: string;
  memberStages?: Stage[];
}

export const EMPTY_AUDIENCE: Audience = { who: 'prospects', statuses: [], customerTypes: [], categories: [], regions: [], campaigns: [] };

export type CampaignKind = 'email' | 'match';

/** Stages a matching campaign's members move through. */
export const STAGES = [
  { id: 'suggested', label: 'Suggested' },
  { id: 'shortlisted', label: 'Shortlisted' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'interested', label: 'Interested' },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'offer', label: 'Offer / deal' },
] as const;
export type Stage = (typeof STAGES)[number]['id'];
export const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)?.label ?? s;

/** A map area: a centre and a radius. */
export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  label: string;
}

/** What "Find matches" searches for, on top of the campaign's opportunity (if it has one). */
export interface Criteria {
  statuses: Status[];
  customerTypes: CustomerType[];
  categories: Category[];
  regions: Region[];
  area?: Area;
}
export const EMPTY_CRITERIA: Criteria = { statuses: [], customerTypes: [], categories: [], regions: [] };

export interface Campaign {
  id: string;
  kind: CampaignKind;
  business: Business;
  name: string;
  subject: string;
  body: string;
  senderId?: string;
  audience: Audience;
  status: CampaignStatus;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  /** Matching campaigns: the listing or requirement it's built around, its search, and whether it's still being worked. */
  opportunityId?: string;
  criteria: Criteria;
  matchStatus: 'active' | 'closed';
  /** Email blasts sent from a matching campaign point back to it. */
  parentId?: string;
}

export interface CampaignStats {
  recipients: number;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  failed: number;
  unsubscribed: number;
}

interface CampaignRow {
  id: string;
  kind: CampaignKind;
  opportunity_id: string | null;
  criteria: Partial<Criteria>;
  match_status: 'active' | 'closed';
  parent_id: string | null;
  business: Business;
  name: string;
  subject: string;
  body: string;
  sender_id: string | null;
  audience: Partial<Audience>;
  status: CampaignStatus;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const fromRow = (r: CampaignRow): Campaign => ({
  id: r.id,
  kind: r.kind,
  opportunityId: r.opportunity_id ?? undefined,
  criteria: { ...EMPTY_CRITERIA, ...r.criteria },
  matchStatus: r.match_status,
  parentId: r.parent_id ?? undefined,
  business: r.business,
  name: r.name,
  subject: r.subject,
  body: r.body,
  senderId: r.sender_id ?? undefined,
  audience: { ...EMPTY_AUDIENCE, ...r.audience },
  status: r.status,
  scheduledFor: r.scheduled_for ?? undefined,
  startedAt: r.started_at ?? undefined,
  finishedAt: r.finished_at ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const statsFromRow = (r: Record<string, number>): CampaignStats => ({
  recipients: r.recipients ?? 0,
  queued: r.queued ?? 0,
  sent: r.sent ?? 0,
  delivered: r.delivered ?? 0,
  opened: r.opened ?? 0,
  clicked: r.clicked ?? 0,
  bounced: r.bounced ?? 0,
  failed: r.failed ?? 0,
  unsubscribed: r.unsubscribed ?? 0,
});

/** All campaigns in a business, newest first, with their totals. */
export function useCampaigns(business: Business) {
  const [campaigns, setCampaigns] = useState<(Campaign & { stats?: CampaignStats })[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      supabase.from('campaigns').select('*').eq('business', business).order('created_at', { ascending: false }),
      supabase.from('campaign_stats').select('*'),
    ]);
    if (c.error) return setError(c.error.message);
    const stats = new Map((s.data ?? []).map((r: Record<string, number> & { campaign_id: string }) => [r.campaign_id, statsFromRow(r)]));
    setCampaigns((c.data as CampaignRow[]).map((r) => ({ ...fromRow(r), stats: stats.get(r.id) })));
  }, [business]);
  useEffect(() => {
    load();
  }, [load]);
  return { campaigns, error, reload: load };
}

export async function fetchCampaign(id: string): Promise<{ campaign: Campaign; stats?: CampaignStats } | null> {
  const [c, s] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', id).maybeSingle(),
    supabase.from('campaign_stats').select('*').eq('campaign_id', id).maybeSingle(),
  ]);
  if (!c.data) return null;
  return { campaign: fromRow(c.data as CampaignRow), stats: s.data ? statsFromRow(s.data as Record<string, number>) : undefined };
}

export async function createCampaign(business: Business, senderId: string): Promise<string> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ business, name: `Campaign ${new Date().toLocaleDateString('en-CA')}`, sender_id: senderId, audience: EMPTY_AUDIENCE })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** A new matching campaign, optionally built around a listing or requirement. */
export async function createMatchCampaign(business: Business, name: string, opportunityId?: string, criteria: Criteria = EMPTY_CRITERIA): Promise<string> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ business, kind: 'match', name, opportunity_id: opportunityId ?? null, criteria })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Changes to a matching campaign (any teammate can make them). */
export async function updateMatchCampaign(id: string, patch: { name?: string; criteria?: Criteria; matchStatus?: 'active' | 'closed' }): Promise<string> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim() || 'Untitled campaign';
  if (patch.criteria !== undefined) row.criteria = patch.criteria;
  if (patch.matchStatus !== undefined) row.match_status = patch.matchStatus;
  const { error } = await supabase.from('campaigns').update(row).eq('id', id);
  return error?.message ?? '';
}

/** An email blast to a matching campaign's members: a draft email campaign that points back to it. */
export async function createMemberBlast(parent: Campaign, senderId: string): Promise<string> {
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      business: parent.business,
      kind: 'email',
      parent_id: parent.id,
      name: `${parent.name}: email`,
      sender_id: senderId,
      audience: { ...EMPTY_AUDIENCE, who: 'all', memberOf: parent.id, memberStages: [] },
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function saveCampaign(c: Campaign): Promise<string> {
  const { error } = await supabase
    .from('campaigns')
    .update({ name: c.name.trim() || 'Untitled campaign', subject: c.subject, body: c.body, sender_id: c.senderId ?? null, audience: c.audience })
    .eq('id', c.id);
  return error?.message ?? '';
}

export async function deleteCampaign(id: string): Promise<string> {
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  return error?.message ?? '';
}

export const sendTest = (campaignId: string, sampleContactId?: string) =>
  callFunction<{ to: string }>('campaign-send', { action: 'test', campaignId, contactIds: sampleContactId ? [sampleContactId] : [] });

export const startCampaign = (campaignId: string, contactIds: string[], scheduleFor?: string) =>
  callFunction<{ queued: number; excluded: number; scheduled: boolean }>('campaign-send', { action: 'send', campaignId, contactIds, scheduleFor });

export const stopCampaign = (campaignId: string) => callFunction('campaign-send', { action: 'cancel', campaignId });

/** Addresses on the do-not-email list. */
export async function fetchSuppressed(): Promise<Set<string>> {
  const out = new Set<string>();
  // Read in pages: Supabase returns at most 1,000 rows per request.
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('email_suppressions').select('email').order('email').range(from, from + 999);
    for (const r of data ?? []) out.add(r.email as string);
    if (!data || data.length < 1000) return out;
  }
}

export type Exclusion = 'no email address' | 'no consent' | 'consent expired' | 'unsubscribed' | 'duplicate address';

/** Splits contacts matching an audience into who will get the email and who won't (and why). Mirrors the server's checks. */
export function resolveAudience(contacts: Contact[], business: Business, a: Audience, suppressed: Set<string>, members?: Set<string>) {
  const any = <T,>(want: T[], have: T[]) => want.length === 0 || want.some((w) => have.includes(w));
  const matching = contacts.filter(
    (c) =>
      c.business === business &&
      (a.memberOf ? !!members?.has(c.id) && !c.archivedAt : a.who === 'all' || (a.who === 'prospects' ? c.isProspect : !c.isProspect)) &&
      (!a.statuses.length || (c.isProspect && a.statuses.includes(c.status))) &&
      any(a.customerTypes, c.customerTypes) &&
      any(a.categories, c.categories) &&
      any(a.regions, c.regions) &&
      any(a.campaigns, c.campaigns),
  );
  const included: Contact[] = [];
  const excluded: { contact: Contact; reason: Exclusion }[] = [];
  const seen = new Set<string>();
  for (const c of matching) {
    const state = consentState(c);
    const email = c.email?.toLowerCase() ?? '';
    const reason: Exclusion | null =
      state === 'no-email'
        ? 'no email address'
        : state === 'unsubscribed' || suppressed.has(email)
          ? 'unsubscribed'
          : state === 'none'
            ? 'no consent'
            : state === 'expired'
              ? 'consent expired'
              : seen.has(email)
                ? 'duplicate address'
                : null;
    if (reason) excluded.push({ contact: c, reason });
    else {
      seen.add(email);
      included.push(c);
    }
  }
  return { matching, included, excluded };
}

export interface OrgSettings {
  brokerageName: string;
  mailingAddress: string;
  contactLine: string;
  /** The domain campaigns are sent from (verified with Resend). */
  sendingDomain: string;
}

/** One business's company details for the email footer, and its sending domain. */
export function useOrgSettings(business: Business) {
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('org_settings')
      .select('brokerage_name, mailing_address, contact_line, sending_domain')
      .eq('business', business)
      .maybeSingle();
    setOrg({
      brokerageName: data?.brokerage_name ?? '',
      mailingAddress: data?.mailing_address ?? '',
      contactLine: data?.contact_line ?? '',
      sendingDomain: data?.sending_domain ?? '',
    });
  }, [business]);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (o: OrgSettings) => {
    const { error } = await supabase
      .from('org_settings')
      .update({
        brokerage_name: o.brokerageName.trim(),
        mailing_address: o.mailingAddress.trim(),
        contact_line: o.contactLine.trim(),
        sending_domain: o.sendingDomain.trim().toLowerCase().replace(/^@/, ''),
      })
      .eq('business', business);
    if (!error) setOrg(o);
    return error?.message ?? '';
  };
  return { org, save, reload: load };
}

export const footerReady = (o: OrgSettings | null) =>
  !!o && !!o.brokerageName.trim() && !!o.mailingAddress.trim() && !!o.contactLine.trim() && !!o.sendingDomain.trim();

/** The email as a recipient will see it, for the preview. */
export function previewEmail(c: Pick<Campaign, 'subject' | 'body'>, values: Record<string, string>, signature: string) {
  return { subject: fillTemplate(c.subject, values).text, body: fillTemplate(c.body, values).text, signature: signature.trim() };
}
