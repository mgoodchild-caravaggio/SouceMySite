import { CATEGORIES, CUSTOMER_TYPES, REGIONS, STATUSES, type Contact, type Filters } from '../types';

export const EMPTY_FILTERS: Filters = {
  text: '',
  statuses: [],
  regions: [],
  categories: [],
  customerTypes: [],
  campaigns: [],
  followUpOnly: false,
};

/** Filters for the Prospects and Contacts lists: the map's filters plus who a contact is assigned to. */
export interface ListFilters extends Filters {
  /** '' for anyone, 'me', 'none', or a user id. */
  assigned: string;
  /** '' any, 'ok' can receive marketing email, 'no' can't. */
  email: '' | 'ok' | 'no';
  /** '' any, or contacts with an open listing / requirement, or a requirement still needing detail. */
  opp: '' | 'listing' | 'requirement' | 'needs_detail';
}

/** Per contact: which kinds of open opportunity they have. Built once per list render. */
export type OppFlags = Map<string, { listing: boolean; requirement: boolean; needsDetail: boolean }>;

export const EMPTY_LIST_FILTERS: ListFilters = { ...EMPTY_FILTERS, assigned: '', email: '', opp: '' };

export function matchesFilters(c: Contact, f: Filters): boolean {
  const any = <T,>(want: T[], have: T[]) => want.length === 0 || want.some((w) => have.includes(w));
  if (f.statuses.length && !(c.isProspect && f.statuses.includes(c.status))) return false;
  if (!any(f.regions, c.regions)) return false;
  if (!any(f.categories, c.categories)) return false;
  if (!any(f.customerTypes, c.customerTypes)) return false;
  if (!any(f.campaigns, c.campaigns)) return false;
  if (f.followUpOnly && !c.followUp) return false;
  const q = f.text.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const hay = `${c.firstName} ${c.lastName} ${c.company} ${c.title} ${c.email ?? ''}`.toLowerCase();
    const phones = `${c.phone} ${c.phone2}`.replace(/\D/g, '');
    if (!hay.includes(q) && !(digits.length >= 3 && phones.includes(digits))) return false;
  }
  return true;
}

export function matchesListFilters(c: Contact, f: ListFilters, myId: string, opps?: OppFlags): boolean {
  if (!matchesFilters(c, f)) return false;
  if (f.assigned === 'me' && c.assignedTo !== myId) return false;
  if (f.assigned === 'none' && c.assignedTo) return false;
  if (f.assigned && !['me', 'none'].includes(f.assigned) && c.assignedTo !== f.assigned) return false;
  if (f.email && (consentState(c) === 'ok') !== (f.email === 'ok')) return false;
  if (f.opp) {
    const o = opps?.get(c.id);
    if (!o || !(f.opp === 'listing' ? o.listing : f.opp === 'requirement' ? o.requirement : o.needsDetail)) return false;
  }
  return true;
}

// Filters live in the page address (?q=…&status=Lead,Contacted) so a filtered list can be bookmarked or shared.
const pick = <T extends string>(allowed: readonly T[], raw: string | null) =>
  (raw ? raw.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v)) : []) as T[];

export function filtersFromParams(p: URLSearchParams): ListFilters {
  return {
    text: p.get('q') ?? '',
    statuses: pick(STATUSES, p.get('status')),
    regions: pick(REGIONS, p.get('region')),
    categories: pick(CATEGORIES, p.get('category')),
    customerTypes: pick(CUSTOMER_TYPES, p.get('type')),
    campaigns: p.get('campaign')?.split(',').filter(Boolean) ?? [],
    followUpOnly: p.get('followup') === '1',
    assigned: p.get('assigned') ?? '',
    email: p.get('email') === 'ok' || p.get('email') === 'no' ? (p.get('email') as 'ok' | 'no') : '',
    opp: (['listing', 'requirement', 'needs_detail'] as const).find((v) => v === p.get('opp')) ?? '',
  };
}

export function filtersToParams(f: ListFilters, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (key: string, value: string) => (value ? p.set(key, value) : p.delete(key));
  set('q', f.text);
  set('status', f.statuses.join(','));
  set('region', f.regions.join(','));
  set('category', f.categories.join(','));
  set('type', f.customerTypes.join(','));
  set('campaign', f.campaigns.join(','));
  set('followup', f.followUpOnly ? '1' : '');
  set('assigned', f.assigned);
  set('email', f.email);
  set('opp', f.opp);
  return p;
}

export function activeFilterCount(f: ListFilters): number {
  return (
    f.statuses.length + f.regions.length + f.categories.length + f.customerTypes.length + f.campaigns.length +
    (f.followUpOnly ? 1 : 0) + (f.assigned ? 1 : 0) + (f.email ? 1 : 0) + (f.opp ? 1 : 0) + (f.text ? 1 : 0)
  );
}

/** "Jane Smith" or the company when there is no name. */
export function displayName(c: Pick<Contact, 'firstName' | 'lastName' | 'company'>): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name || (c.company !== 'tbd' ? c.company : 'Unnamed contact');
}

export function companyLabel(c: Pick<Contact, 'company'>): string {
  return c.company && c.company !== 'tbd' ? c.company : '';
}

export function initials(c: Pick<Contact, 'firstName' | 'lastName' | 'company'>): string {
  const name = displayName(c);
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const DATE_FMT = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' });
const DATE_YEAR_FMT = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Nov 18" (this year) or "Nov 18, 2025". Accepts YYYY-MM-DD or a full timestamp. */
export function formatDate(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? DATE_FMT : DATE_YEAR_FMT).format(d);
}

export const todayIso = () => new Date().toLocaleDateString('en-CA');

/** 'overdue' | 'today' | 'soon' (within 7 days) | 'later', for colouring follow-up dates. */
export function followUpState(iso: string): 'overdue' | 'today' | 'soon' | 'later' {
  const today = todayIso();
  if (iso < today) return 'overdue';
  if (iso === today) return 'today';
  const week = new Date();
  week.setDate(week.getDate() + 7);
  return iso <= week.toLocaleDateString('en-CA') ? 'soon' : 'later';
}

export type ConsentState = 'ok' | 'expired' | 'none' | 'unsubscribed' | 'no-email';

/** Whether a contact may receive marketing email today under CASL, and why not. Mirrors can_email_marketing() in the database. */
export function consentState(c: Pick<Contact, 'email' | 'emailConsent' | 'consentExpiresOn' | 'unsubscribedAt'>): ConsentState {
  if (!c.email) return 'no-email';
  if (c.unsubscribedAt) return 'unsubscribed';
  if (c.emailConsent === 'none') return 'none';
  if (c.consentExpiresOn && c.consentExpiresOn < todayIso()) return 'expired';
  return 'ok';
}

export const CONSENT_LABEL: Record<ConsentState, string> = {
  ok: 'Can email',
  expired: 'Consent expired',
  none: 'No consent',
  unsubscribed: 'Unsubscribed',
  'no-email': 'No email address',
};

/** Implied consent lasts 2 years after a deal and 6 months after an inquiry. */
export function impliedExpiry(fromIso: string, source: string): string {
  const d = new Date(`${fromIso}T00:00:00`);
  d.setMonth(d.getMonth() + (/past client|deal|closed/i.test(source) ? 24 : 6));
  return d.toLocaleDateString('en-CA');
}
