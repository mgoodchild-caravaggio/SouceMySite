import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Category, Region } from '../types';

export type OpportunityKind = 'listing' | 'requirement';
export type ListingType = 'listed' | 'off_market';
export type Servicing = 'available' | 'planned' | 'none' | 'unknown';
export type ListingStatus = 'open' | 'under_offer' | 'sold' | 'withdrawn';
export type RequirementStatus = 'open' | 'matched' | 'closed' | 'dropped';

export const LISTING_STATUSES: { id: ListingStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'under_offer', label: 'Under offer' },
  { id: 'sold', label: 'Sold' },
  { id: 'withdrawn', label: 'Withdrawn' },
];
export const REQUIREMENT_STATUSES: { id: RequirementStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'matched', label: 'Matched' },
  { id: 'closed', label: 'Closed' },
  { id: 'dropped', label: 'Dropped' },
];
export const statusLabel = (s: string) => [...LISTING_STATUSES, ...REQUIREMENT_STATUSES].find((x) => x.id === s)?.label ?? s;

/** Common zoning / Official Plan designations, offered as suggestions (free text is allowed). */
export const ZONING_SUGGESTIONS = [
  'Agricultural',
  'Rural',
  'Greenbelt',
  'Whitebelt (unzoned)',
  'Future Development',
  'Residential',
  'Employment',
  'Industrial',
  'Commercial',
  'Mixed Use',
  'Institutional',
];

export const SERVICING_LABEL: Record<Servicing, string> = {
  available: 'Serviced (water & sewer)',
  planned: 'Servicing planned',
  none: 'No municipal servicing',
  unknown: 'Unknown',
};

export interface Opportunity {
  id: string;
  contactId: string;
  kind: OpportunityKind;
  listingType?: ListingType;
  propertyId?: string;
  title: string;
  status: ListingStatus | RequirementStatus;
  categories: Category[];
  acresMin?: number;
  acresMax?: number;
  priceMin?: number;
  priceMax?: number;
  zoning: string[];
  servicing: Servicing;
  targetDate?: string;
  assemblyWanted: boolean;
  assemblyMinAcres?: number;
  areaLat?: number;
  areaLng?: number;
  areaRadiusKm?: number;
  /** Place name for the area centre, e.g. "Barrie". */
  areaLabel: string;
  regions: Region[];
  needsDetail: boolean;
  notes: string;
  createdBy?: string;
  updatedAt: string;
}

export type OpportunityInput = Omit<Opportunity, 'id' | 'createdBy' | 'updatedAt'>;

interface Row {
  id: string;
  contact_id: string;
  kind: OpportunityKind;
  listing_type: ListingType | null;
  property_id: string | null;
  title: string;
  status: Opportunity['status'];
  categories: Category[];
  acres_min: number | null;
  acres_max: number | null;
  price_min: number | null;
  price_max: number | null;
  zoning: string[];
  servicing: Servicing;
  target_date: string | null;
  assembly_wanted: boolean;
  assembly_min_acres: number | null;
  area_lat: number | null;
  area_lng: number | null;
  area_radius_km: number | null;
  area_label: string;
  regions: Region[];
  needs_detail: boolean;
  notes: string;
  created_by: string | null;
  updated_at: string;
}

const u = <T,>(v: T | null) => v ?? undefined;
const num = (v: number | string | null) => (v == null ? undefined : Number(v));

export const opportunityFromRow = (r: Row): Opportunity => fromRow(r);
const fromRow = (r: Row): Opportunity => ({
  id: r.id,
  contactId: r.contact_id,
  kind: r.kind,
  listingType: u(r.listing_type),
  propertyId: u(r.property_id),
  title: r.title,
  status: r.status,
  categories: r.categories,
  acresMin: num(r.acres_min),
  acresMax: num(r.acres_max),
  priceMin: num(r.price_min),
  priceMax: num(r.price_max),
  zoning: r.zoning,
  servicing: r.servicing,
  targetDate: u(r.target_date),
  assemblyWanted: r.assembly_wanted,
  assemblyMinAcres: num(r.assembly_min_acres),
  areaLat: u(r.area_lat),
  areaLng: u(r.area_lng),
  areaRadiusKm: num(r.area_radius_km),
  areaLabel: r.area_label ?? '',
  regions: r.regions,
  needsDetail: r.needs_detail,
  notes: r.notes,
  createdBy: u(r.created_by),
  updatedAt: r.updated_at,
});

const toRow = (o: OpportunityInput) => ({
  contact_id: o.contactId,
  kind: o.kind,
  listing_type: o.kind === 'listing' ? o.listingType ?? 'off_market' : null,
  property_id: o.kind === 'listing' ? o.propertyId ?? null : null,
  title: o.title.trim(),
  status: o.status,
  categories: o.categories,
  acres_min: o.acresMin ?? null,
  acres_max: o.acresMax ?? null,
  price_min: o.priceMin ?? null,
  price_max: o.kind === 'listing' ? null : o.priceMax ?? null,
  zoning: o.zoning,
  servicing: o.servicing,
  target_date: o.targetDate ?? null,
  assembly_wanted: o.kind === 'requirement' && o.assemblyWanted,
  assembly_min_acres: o.kind === 'requirement' && o.assemblyWanted ? o.assemblyMinAcres ?? null : null,
  area_lat: o.kind === 'requirement' ? o.areaLat ?? null : null,
  area_lng: o.kind === 'requirement' ? o.areaLng ?? null : null,
  area_radius_km: o.kind === 'requirement' ? o.areaRadiusKm ?? null : null,
  area_label: o.kind === 'requirement' && o.areaLat != null ? o.areaLabel : '',
  regions: o.regions,
  needs_detail: o.needsDetail,
  notes: o.notes,
});

/** A match someone added by hand: an opportunity and a contact (and optionally one of that contact's opportunities). */
export interface ManualMatch {
  id: string;
  opportunityId: string;
  contactId: string;
  otherOpportunityId?: string;
  note: string;
  createdBy?: string;
  createdAt: string;
}
interface ManualRow {
  id: string;
  opportunity_id: string;
  contact_id: string;
  other_opportunity_id: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
}
const manualFromRow = (r: ManualRow): ManualMatch => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  contactId: r.contact_id,
  otherOpportunityId: r.other_opportunity_id ?? undefined,
  note: r.note,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
});

interface Value {
  opportunities: Opportunity[];
  manualMatches: ManualMatch[];
  loading: boolean;
  save: (input: OpportunityInput, id?: string) => Promise<string>;
  remove: (id: string) => Promise<string>;
  addManualMatch: (m: { opportunityId: string; contactId: string; otherOpportunityId?: string; note: string }) => Promise<string>;
  removeManualMatch: (id: string) => Promise<string>;
}

const Ctx = createContext<Value | null>(null);

/** Loads every opportunity once per sign-in (they're needed for matching), and saves changes. */
export function OpportunitiesProvider({ children }: { children: ReactNode }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [manualMatches, setManualMatches] = useState<ManualMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: Row[] = [];
      // Supabase returns at most 1,000 rows per request.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('opportunities').select('*').order('created_at').order('id').range(from, from + 999);
        if (error || !data) break;
        all.push(...(data as Row[]));
        if (data.length < 1000) break;
      }
      const manual: ManualRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('opportunity_matches').select('*').order('created_at').order('id').range(from, from + 999);
        if (error || !data) break;
        manual.push(...(data as ManualRow[]));
        if (data.length < 1000) break;
      }
      if (!cancelled) {
        setOpportunities(all.map(fromRow));
        setManualMatches(manual.map(manualFromRow));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (input: OpportunityInput, id?: string) => {
    const row = toRow(input);
    const { data, error } = id
      ? await supabase.from('opportunities').update(row).eq('id', id).select().single()
      : await supabase.from('opportunities').insert(row).select().single();
    if (error) return error.message;
    const saved = fromRow(data as Row);
    setOpportunities((prev) => (id ? prev.map((o) => (o.id === id ? saved : o)) : [...prev, saved]));
    return '';
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('opportunities').delete().eq('id', id);
    if (error) return error.message;
    setOpportunities((prev) => prev.filter((o) => o.id !== id));
    // Their hand-added matches go with them (the database does the same).
    setManualMatches((prev) => prev.filter((m) => m.opportunityId !== id).map((m) => (m.otherOpportunityId === id ? { ...m, otherOpportunityId: undefined } : m)));
    return '';
  }, []);

  const addManualMatch = useCallback(async (m: { opportunityId: string; contactId: string; otherOpportunityId?: string; note: string }) => {
    const { data, error } = await supabase
      .from('opportunity_matches')
      .insert({ opportunity_id: m.opportunityId, contact_id: m.contactId, other_opportunity_id: m.otherOpportunityId ?? null, note: m.note.trim() })
      .select()
      .single();
    if (error) return error.code === '23505' ? 'They are already matched to this by hand.' : error.message;
    setManualMatches((prev) => [...prev, manualFromRow(data as ManualRow)]);
    return '';
  }, []);

  const removeManualMatch = useCallback(async (id: string) => {
    const { error } = await supabase.from('opportunity_matches').delete().eq('id', id);
    if (error) return error.message;
    setManualMatches((prev) => prev.filter((m) => m.id !== id));
    return '';
  }, []);

  return <Ctx.Provider value={{ opportunities, manualMatches, loading, save, remove, addManualMatch, removeManualMatch }}>{children}</Ctx.Provider>;
}

export function useOpportunities() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOpportunities must be used inside OpportunitiesProvider');
  return v;
}

export { formatPrice, rangeLabel } from './format';

/** The note on drafts created from Salesforce tags; cleared once someone fills in the details. */
export const DRAFT_NOTE = 'Drafted from Salesforce tags. Add acres, budget, area and timing.';
