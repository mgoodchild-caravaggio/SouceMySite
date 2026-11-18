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

interface Value {
  opportunities: Opportunity[];
  loading: boolean;
  save: (input: OpportunityInput, id?: string) => Promise<string>;
  remove: (id: string) => Promise<string>;
}

const Ctx = createContext<Value | null>(null);

/** Loads every opportunity once per sign-in (they're needed for matching), and saves changes. */
export function OpportunitiesProvider({ children }: { children: ReactNode }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
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
      if (!cancelled) {
        setOpportunities(all.map(fromRow));
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
    return '';
  }, []);

  return <Ctx.Provider value={{ opportunities, loading, save, remove }}>{children}</Ctx.Provider>;
}

export function useOpportunities() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOpportunities must be used inside OpportunitiesProvider');
  return v;
}

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2, notation: 'compact' });
export const formatPrice = (n: number) => money.format(n);

/** "40–80 ac", "40+ ac", "up to 80 ac" or "". */
export function rangeLabel(min: number | undefined, max: number | undefined, unit: string, fmt: (n: number) => string = String) {
  if (min != null && max != null) return min === max ? `${fmt(min)} ${unit}` : `${fmt(min)}–${fmt(max)} ${unit}`;
  if (min != null) return `${fmt(min)}+ ${unit}`;
  if (max != null) return `up to ${fmt(max)} ${unit}`;
  return '';
}

/** The note on drafts created from Salesforce tags; cleared once someone fills in the details. */
export const DRAFT_NOTE = 'Drafted from Salesforce tags. Add acres, budget, area and timing.';
