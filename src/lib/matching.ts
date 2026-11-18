// Buyer/seller matching (docs/PLAN-matching.md, step 2).
//
// Pure functions over contacts and opportunities, so the contact page, the Map, campaigns and the AI
// assistant all rank the same way. Every match carries a 0–100 score and plain-language reasons.
// Missing data counts as "unknown" (a small neutral score), never as a mismatch, so records that are
// still incomplete (like the drafted buyer requirements) still surface.

import { haversineKm } from './geo';
import { formatPrice } from './format';
import type { Opportunity } from './opportunities';
import type { Contact, LatLng, Property } from '../types';

export type ReasonTone = 'good' | 'ok' | 'bad';
export interface Reason {
  text: string;
  tone: ReasonTone;
}

export type MatchKind =
  | 'requirement' // a buyer's requirement that fits a listing / property
  | 'listing' // an open listing that fits a requirement
  | 'property' // an owner's (unlisted) property that fits a requirement: a "would you sell?" call
  | 'active_nearby' // a builder/developer or investor with land nearby
  | 'neighbour' // an adjoining owner, for a land assembly
  | 'in_area' // anyone with land inside a campaign's map area
  | 'looking_here'; // a buyer whose search area covers a campaign's map area

export interface MatchResult {
  contact: Contact;
  kind: MatchKind;
  score: number;
  reasons: Reason[];
  /** The opportunity on the other side, when there is one. */
  opportunity?: Opportunity;
  /** The property involved (the candidate's land, or the listing's property). */
  property?: Property;
  distanceKm?: number;
}

/** What we're matching from: a listing (with its property) or a requirement. */
export interface MatchSubject {
  opportunity: Opportunity;
  contact: Contact;
  property?: Property;
}

const NEIGHBOUR_KM = 1.5;
const ACTIVE_NEARBY_KM = 25;
const DEFAULT_AREA_KM = 25;

const overlap = <T,>(a: T[], b: T[]) => a.filter((x) => b.includes(x));
const fmtKm = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);
const fmtAc = (n: number) => `${Math.round(n * 10) / 10} ac`;

/** Where a requirement is looking, if it has a map area. */
const areaOf = (r: Opportunity): (LatLng & { radiusKm: number }) | null =>
  r.areaLat != null && r.areaLng != null ? { lat: r.areaLat, lng: r.areaLng, radiusKm: r.areaRadiusKm ?? DEFAULT_AREA_KM } : null;

/** The open-listing view of a property: listing details if it has one, else what the property itself says. */
function landFacts(property: Property, owner: Contact, listing?: Opportunity) {
  return {
    point: { lat: property.lat, lng: property.lng },
    categories: listing?.categories.length ? listing.categories : [property.category],
    acres: listing?.acresMin ?? property.acres,
    price: listing?.priceMin,
    zoning: listing?.zoning ?? [],
    servicing: listing?.servicing ?? 'unknown',
    targetDate: listing?.targetDate,
    regions: listing?.regions.length ? listing.regions : owner.regions,
  };
}
type Land = ReturnType<typeof landFacts>;

/**
 * How well a piece of land fits a requirement. Returns null when it clearly doesn't fit (wrong category,
 * or outside the area), otherwise a score and reasons.
 */
function scoreFit(req: Opportunity, land: Land): { score: number; reasons: Reason[]; distanceKm?: number } | null {
  const reasons: Reason[] = [];
  let score = 0;

  // Where: the map area first, then regions.
  const area = areaOf(req);
  let distanceKm: number | undefined;
  if (area) {
    distanceKm = haversineKm(area, land.point);
    const where = req.areaLabel ? ` of ${req.areaLabel}` : '';
    if (distanceKm <= area.radiusKm) {
      score += 30;
      reasons.push({ text: `${fmtKm(distanceKm)}${where}, inside their ${area.radiusKm} km area`, tone: 'good' });
    } else if (distanceKm <= area.radiusKm * 1.5) {
      score += 10;
      reasons.push({ text: `${fmtKm(distanceKm)}${where}, just outside their ${area.radiusKm} km area`, tone: 'ok' });
    } else if (!overlap(req.regions, land.regions).length) {
      return null;
    }
  }
  if (!area || (distanceKm != null && distanceKm > area.radiusKm * 1.5)) {
    const regions = overlap(req.regions, land.regions);
    if (regions.length) {
      score += 20;
      reasons.push({ text: `In ${regions.join(', ')}`, tone: 'good' });
    } else if (req.regions.length && land.regions.length) {
      return null;
    } else {
      score += 5;
      reasons.push({ text: 'Area not set', tone: 'ok' });
    }
  }

  // What: category must overlap when both sides say.
  const cats = overlap(req.categories, land.categories);
  if (cats.length) {
    score += 25;
    reasons.push({ text: cats.join(', '), tone: 'good' });
  } else if (req.categories.length && land.categories.length) {
    return null;
  } else {
    score += 8;
  }

  // Size, allowing for an assembly when the buyer would combine parcels.
  if (land.acres != null && (req.acresMin != null || req.acresMax != null)) {
    const lo = req.acresMin ?? 0;
    const hi = req.acresMax ?? Infinity;
    if (land.acres >= lo && land.acres <= hi) {
      score += 15;
      reasons.push({ text: `${fmtAc(land.acres)} fits ${rangeText(req.acresMin, req.acresMax, 'ac')}`, tone: 'good' });
    } else if (land.acres >= lo * 0.8 && land.acres <= hi * 1.2) {
      score += 7;
      reasons.push({ text: `${fmtAc(land.acres)}, close to ${rangeText(req.acresMin, req.acresMax, 'ac')}`, tone: 'ok' });
    } else if (req.assemblyWanted && land.acres < lo) {
      score += 6;
      reasons.push({ text: `${fmtAc(land.acres)}: part of an assembly`, tone: 'ok' });
    } else {
      score -= 10;
      reasons.push({ text: `${fmtAc(land.acres)}, outside ${rangeText(req.acresMin, req.acresMax, 'ac')}`, tone: 'bad' });
    }
  }

  // Price against budget.
  if (land.price != null && req.priceMax != null) {
    if (land.price <= req.priceMax && (req.priceMin == null || land.price >= req.priceMin * 0.8)) {
      score += 10;
      reasons.push({ text: `Asking ${formatPrice(land.price)}, within budget`, tone: 'good' });
    } else if (land.price <= req.priceMax * 1.15) {
      score += 3;
      reasons.push({ text: `Asking ${formatPrice(land.price)}, slightly over budget`, tone: 'ok' });
    } else {
      score -= 10;
      reasons.push({ text: `Asking ${formatPrice(land.price)}, over the ${formatPrice(req.priceMax)} budget`, tone: 'bad' });
    }
  }

  // Zoning / Official Plan designation.
  const zones = overlap(lower(req.zoning), lower(land.zoning));
  if (zones.length) {
    score += 8;
    reasons.push({ text: `Designation: ${land.zoning.filter((z) => zones.includes(z.toLowerCase())).join(', ')}`, tone: 'good' });
  } else if (req.zoning.length && land.zoning.length) {
    score -= 5;
    reasons.push({ text: `Designated ${land.zoning.join(', ')}, they want ${req.zoning.join(', ')}`, tone: 'bad' });
  }

  // Servicing: requirement 'available' = must be serviced; 'planned' = planned is fine.
  if (req.servicing !== 'unknown' && land.servicing !== 'unknown') {
    const ok = req.servicing === 'available' ? land.servicing === 'available' : land.servicing !== 'none';
    score += ok ? 5 : -8;
    reasons.push({ text: ok ? 'Servicing fits' : `Servicing: ${land.servicing}`, tone: ok ? 'good' : 'bad' });
  }

  // Timing: both sides want to move within about six months of each other.
  if (req.targetDate && land.targetDate) {
    const months = Math.abs(Date.parse(req.targetDate) - Date.parse(land.targetDate)) / (30 * 86_400_000);
    if (months <= 6) {
      score += 5;
      reasons.push({ text: 'Timing lines up', tone: 'good' });
    }
  }

  return { score: clamp(score), reasons, distanceKm };
}

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
function rangeText(min: number | undefined, max: number | undefined, unit: string) {
  if (min != null && max != null) return `${min}–${max} ${unit}`;
  if (min != null) return `${min}+ ${unit}`;
  return `up to ${max} ${unit}`;
}

const openOf = (opps: Opportunity[], kind: 'listing' | 'requirement') => opps.filter((o) => o.kind === kind && o.status === 'open');
const isActiveType = (c: Contact) => c.customerTypes.includes('Builder/Developer') || c.customerTypes.includes('Investor');

interface Data {
  contacts: Contact[];
  opportunities: Opportunity[];
}

/** People who fit a listing: buyer requirements, then builders/investors nearby, then (for assemblies) neighbours. */
export function matchListing(subject: MatchSubject, data: Data): MatchResult[] {
  const { opportunity: listing, contact: owner, property } = subject;
  if (!property) return [];
  const land = landFacts(property, owner, listing);
  const byId = new Map(data.contacts.map((c) => [c.id, c]));
  const results: MatchResult[] = [];
  const seen = new Set<string>([owner.id]);

  for (const req of openOf(data.opportunities, 'requirement')) {
    const c = byId.get(req.contactId);
    if (!c || c.id === owner.id || c.business !== owner.business || c.archivedAt) continue;
    const fit = scoreFit(req, land);
    if (!fit) continue;
    results.push({ contact: c, kind: 'requirement', opportunity: req, score: fit.score, reasons: fit.reasons, distanceKm: fit.distanceKm });
    seen.add(c.id);
  }

  // Builders/developers and investors with land nearby, who haven't said what they want yet.
  for (const c of data.contacts) {
    if (seen.has(c.id) || c.business !== owner.business || !isActiveType(c) || c.archivedAt) continue;
    const nearest = nearestProperty(c, land.point);
    const sameCat = c.categories.some((x) => land.categories.includes(x));
    if (nearest && nearest.km <= ACTIVE_NEARBY_KM) {
      const reasons: Reason[] = [{ text: `${c.customerTypes.filter((t) => t === 'Builder/Developer' || t === 'Investor').join(' / ')} with land ${fmtKm(nearest.km)} away`, tone: 'good' }];
      if (sameCat) reasons.push({ text: land.categories.filter((x) => c.categories.includes(x)).join(', '), tone: 'good' });
      results.push({ contact: c, kind: 'active_nearby', property: nearest.property, distanceKm: nearest.km, score: clamp(25 + (sameCat ? 15 : 0) + (1 - nearest.km / ACTIVE_NEARBY_KM) * 20), reasons });
      seen.add(c.id);
    }
  }

  // Neighbours: owners of land right next to this one (an assembly could interest buyers needing more acres).
  for (const c of data.contacts) {
    if (seen.has(c.id) || c.business !== owner.business || c.archivedAt) continue;
    const nearest = nearestProperty(c, land.point);
    if (nearest && nearest.km <= NEIGHBOUR_KM) {
      results.push({
        contact: c,
        kind: 'neighbour',
        property: nearest.property,
        distanceKm: nearest.km,
        score: clamp(20 + (1 - nearest.km / NEIGHBOUR_KM) * 15),
        reasons: [{ text: `Owns ${nearest.property.address}, ${fmtKm(nearest.km)} away`, tone: 'ok' }],
      });
    }
  }

  return sortResults(results);
}

/** Land that fits a requirement: open listings first, then owners whose land fits but isn't listed. */
export function matchRequirement(subject: MatchSubject, data: Data): MatchResult[] {
  const { opportunity: req, contact: buyer } = subject;
  const byId = new Map(data.contacts.map((c) => [c.id, c]));
  const results: MatchResult[] = [];
  const listedProperties = new Set<string>();

  for (const listing of openOf(data.opportunities, 'listing')) {
    const owner = byId.get(listing.contactId);
    const property = owner?.properties.find((p) => p.id === listing.propertyId);
    if (!owner || !property || owner.id === buyer.id || owner.business !== buyer.business || owner.archivedAt) continue;
    listedProperties.add(property.id);
    const fit = scoreFit(req, landFacts(property, owner, listing));
    if (!fit) continue;
    // Listed land ranks above unlisted land with the same fit.
    results.push({ contact: owner, kind: 'listing', opportunity: listing, property, score: clamp(fit.score + 10), reasons: fit.reasons, distanceKm: fit.distanceKm });
  }

  // Unlisted land that fits: worth a "would you consider selling?" call. One result per owner (their best parcel).
  const best = new Map<string, MatchResult>();
  for (const owner of data.contacts) {
    if (owner.id === buyer.id || owner.business !== buyer.business || owner.archivedAt || !owner.isProspect) continue;
    for (const property of owner.properties) {
      if (listedProperties.has(property.id) || property.relation !== 'Owns') continue;
      const fit = scoreFit(req, landFacts(property, owner));
      if (!fit) continue;
      const r: MatchResult = {
        contact: owner,
        kind: 'property',
        property,
        score: clamp(fit.score - 5),
        reasons: [...fit.reasons, { text: owner.customerTypes.includes('Seller') ? 'Owner is a seller' : 'Not listed', tone: owner.customerTypes.includes('Seller') ? 'good' : 'ok' }],
        distanceKm: fit.distanceKm,
      };
      const cur = best.get(owner.id);
      if (!cur || r.score > cur.score) best.set(owner.id, r);
    }
  }
  results.push(...best.values());
  return sortResults(results);
}

/** Every match for a contact's open listings and requirements, grouped by opportunity. */
export function matchesForContact(contact: Contact, data: Data) {
  return data.opportunities
    .filter((o) => o.contactId === contact.id && o.status === 'open')
    .map((o) => {
      const property = contact.properties.find((p) => p.id === o.propertyId);
      const subject = { opportunity: o, contact, property };
      return { opportunity: o, property, results: o.kind === 'listing' ? matchListing(subject, data) : matchRequirement(subject, data) };
    });
}

export interface NearbyItem {
  contact: Contact;
  opportunity?: Opportunity;
  property?: Property;
  distanceKm: number;
  label: string;
}

/** Open opportunities, and builders/investors, near a contact's properties: for "what's around them?" on a call. */
export function nearbyFor(contact: Contact, data: Data, radiusKm: number): NearbyItem[] {
  if (!contact.properties.length) return [];
  const byId = new Map(data.contacts.map((c) => [c.id, c]));
  const items = new Map<string, NearbyItem>();
  const closestKm = (pt: LatLng) => Math.min(...contact.properties.map((p) => haversineKm(p, pt)));
  const add = (key: string, item: NearbyItem) => {
    const cur = items.get(key);
    if (item.distanceKm <= radiusKm && (!cur || item.distanceKm < cur.distanceKm)) items.set(key, item);
  };

  for (const o of data.opportunities) {
    const c = byId.get(o.contactId);
    if (o.status !== 'open' || !c || c.id === contact.id || c.business !== contact.business || c.archivedAt) continue;
    if (o.kind === 'listing') {
      const p = c.properties.find((x) => x.id === o.propertyId);
      if (p) add(`o:${o.id}`, { contact: c, opportunity: o, property: p, distanceKm: closestKm(p), label: `Listing: ${o.categories.join(', ') || p.category}${o.acresMin != null ? ` · ${fmtAc(o.acresMin)}` : ''}` });
    } else {
      const area = areaOf(o);
      if (area) {
        // A buyer whose search area reaches this contact's land.
        const km = Math.max(0, closestKm(area) - area.radiusKm);
        add(`o:${o.id}`, { contact: c, opportunity: o, distanceKm: km, label: `Buyer looking here: ${o.categories.join(', ') || 'land'}${o.acresMin != null || o.acresMax != null ? ` · ${rangeText(o.acresMin, o.acresMax, 'ac')}` : ''}` });
      }
    }
  }
  for (const c of data.contacts) {
    if (c.id === contact.id || c.business !== contact.business || !isActiveType(c) || c.archivedAt) continue;
    for (const p of c.properties) {
      add(`c:${c.id}`, { contact: c, property: p, distanceKm: closestKm(p), label: `${c.customerTypes.filter((t) => t === 'Builder/Developer' || t === 'Investor').join(' / ')} with land here` });
    }
  }
  return [...items.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

function nearestProperty(c: Contact, point: LatLng): { property: Property; km: number } | null {
  let best: { property: Property; km: number } | null = null;
  for (const p of c.properties) {
    const km = haversineKm(p, point);
    if (!best || km < best.km) best = { property: p, km };
  }
  return best;
}

const KIND_ORDER: Record<MatchKind, number> = { requirement: 0, listing: 0, looking_here: 0, property: 1, in_area: 1, active_nearby: 2, neighbour: 3 };
function sortResults(results: MatchResult[]) {
  return results.sort((a, b) => b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
}

export const KIND_LABEL: Record<MatchKind, string> = {
  requirement: 'Buyer requirement',
  listing: 'Listing',
  property: 'Unlisted land',
  active_nearby: 'Active nearby',
  neighbour: 'Neighbour',
  in_area: 'Land in area',
  looking_here: 'Buyer looking here',
};

/** The filters and map area a campaign searches with (the shape stored in campaigns.criteria). */
export interface CandidateCriteria {
  statuses: string[];
  customerTypes: string[];
  categories: string[];
  regions: string[];
  area?: LatLng & { radiusKm: number };
}

/**
 * Everyone a campaign could add: the matches for its listing or requirement (if it has one), plus land
 * owners inside its map area and buyers searching there, narrowed by its filters. One result per
 * contact, keeping their best score.
 */
export function campaignCandidates(
  business: string,
  criteria: CandidateCriteria,
  subject: MatchSubject | null,
  data: Data,
): MatchResult[] {
  const best = new Map<string, MatchResult>();
  const keep = (r: MatchResult) => {
    const cur = best.get(r.contact.id);
    if (!cur || r.score > cur.score) best.set(r.contact.id, r);
  };

  if (subject) {
    const found = subject.opportunity.kind === 'listing' ? matchListing(subject, data) : matchRequirement(subject, data);
    found.forEach(keep);
  }

  const area = criteria.area;
  if (area) {
    const wantCats = criteria.categories;
    const byId = new Map(data.contacts.map((c) => [c.id, c]));
    for (const c of data.contacts) {
      if (c.business !== business || c.archivedAt || c.id === subject?.contact.id) continue;
      const nearest = nearestProperty(c, area);
      if (!nearest || nearest.km > area.radiusKm) continue;
      const catFit = wantCats.length ? wantCats.includes(nearest.property.category as never) || c.categories.some((x) => wantCats.includes(x)) : false;
      const reasons: Reason[] = [{ text: `${nearest.property.relation === 'Owns' ? 'Owns' : nearest.property.relation} ${nearest.property.address}, ${fmtKm(nearest.km)} from the centre`, tone: 'good' }];
      if (catFit) reasons.push({ text: nearest.property.category || c.categories.filter((x) => wantCats.includes(x)).join(', '), tone: 'good' });
      if (nearest.property.acres) reasons.push({ text: fmtAc(nearest.property.acres), tone: 'ok' });
      if (c.customerTypes.length) reasons.push({ text: c.customerTypes.join(', '), tone: 'ok' });
      keep({ contact: c, kind: 'in_area', property: nearest.property, distanceKm: nearest.km, score: clamp(30 + (1 - nearest.km / area.radiusKm) * 30 + (catFit ? 15 : 0)), reasons });
    }
    for (const o of openOf(data.opportunities, 'requirement')) {
      const c = byId.get(o.contactId);
      const a = areaOf(o);
      if (!c || !a || c.business !== business || c.archivedAt || c.id === subject?.contact.id) continue;
      const km = haversineKm(a, area);
      if (km > a.radiusKm + area.radiusKm) continue;
      const catFit = wantCats.length ? o.categories.some((x) => wantCats.includes(x)) : false;
      const reasons: Reason[] = [{ text: `Looking within ${a.radiusKm} km${o.areaLabel ? ` of ${o.areaLabel}` : ''}`, tone: 'good' }];
      if (o.categories.length) reasons.push({ text: o.categories.join(', '), tone: catFit || !wantCats.length ? 'good' : 'ok' });
      if (o.acresMin != null || o.acresMax != null) reasons.push({ text: rangeText(o.acresMin, o.acresMax, 'ac'), tone: 'ok' });
      if (o.priceMax != null) reasons.push({ text: `up to ${formatPrice(o.priceMax)}`, tone: 'ok' });
      keep({ contact: c, kind: 'looking_here', opportunity: o, distanceKm: km, score: clamp(55 + (catFit ? 20 : 0) - Math.min(15, km / 2)), reasons });
    }
  }

  const any = (want: string[], have: string[]) => !want.length || want.some((w) => have.includes(w));
  return sortResults(
    [...best.values()].filter(
      (r) =>
        r.contact.business === business &&
        (!criteria.statuses.length || (r.contact.isProspect && criteria.statuses.includes(r.contact.status))) &&
        any(criteria.customerTypes, r.contact.customerTypes) &&
        // Category and region narrow the area search; an opportunity's own matches already fit its categories.
        (r.kind !== 'in_area' || any(criteria.categories, [...r.contact.categories, r.property?.category ?? ''])) &&
        any(criteria.regions, r.contact.regions),
    ),
  );
}
