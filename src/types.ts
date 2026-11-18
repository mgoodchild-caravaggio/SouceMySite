export const STATUSES = ['Prospect', 'Contacted', 'Lead', 'Active Lead', 'Unqualified'] as const;
export const REGIONS = [
  'Simcoe',
  'York',
  'Toronto',
  'Halton',
  'Peel',
  'Durham',
  'Hamilton-Wentworth',
  'Greater Golden Horseshoe',
  'Middlesex',
  'Peterborough',
] as const;
export const CATEGORIES = [
  'Industrial Land',
  'Residential Land',
  'Industrial Building',
  'Residential',
  'Agricultural',
  'White Belt',
  'Expansion Boundary',
  'Investment Property',
] as const;
export const CUSTOMER_TYPES = [
  'Buyer',
  'Seller',
  'Builder/Developer',
  'Investor',
  'Past Client',
  'Agricultural',
  'Finance/Lender',
  'Referral Source',
  'Infrastructure',
] as const;

export const BUSINESSES = ['Real Estate', 'Staging'] as const;
export const CONSENT_TYPES = ['express', 'implied', 'none'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export type Status = (typeof STATUSES)[number];
export type Business = (typeof BUSINESSES)[number];
export type Region = (typeof REGIONS)[number];
export type Category = (typeof CATEGORIES)[number];
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  label: string;
}

/** A parcel or building tied to a prospect. Each property is one pin on the map. */
export interface Property extends LatLng {
  id: string;
  address: string;
  acres?: number;
  category: Category;
  relation: 'Owns' | 'Interested in';
}

/** Anyone in Hub: a prospect (in the sales pipeline, with properties on the map) or another contact. */
export interface Contact {
  id: string;
  business: Business;
  isProspect: boolean;
  firstName: string;
  lastName: string;
  /** "tbd" when the contact is an individual with no company, matching the Salesforce convention. */
  company: string;
  title: string;
  phone: string;
  phone2: string;
  email?: string;
  website: string;
  mailingAddress: string;
  status: Status;
  leadSource: string;
  regions: Region[];
  categories: Category[];
  customerTypes: CustomerType[];
  dealValue?: number;
  /** ISO date (YYYY-MM-DD) of the next follow-up, if one is set. */
  followUpOn?: string;
  /** True when a follow-up date is set. */
  followUp: boolean;
  assignedTo?: string;
  archivedAt?: string;
  campaigns: string[];
  notes: string;
  properties: Property[];
  /** CASL email consent: express (they agreed), implied (deal or inquiry; expires), or none. */
  emailConsent: ConsentType;
  consentDate?: string;
  consentSource: string;
  consentExpiresOn?: string;
  unsubscribedAt?: string;
}

/** The map and its components work with prospects, which are contacts marked as prospects. */
export type Prospect = Contact;

export interface Filters {
  text: string;
  statuses: Status[];
  regions: Region[];
  categories: Category[];
  customerTypes: CustomerType[];
  campaigns: string[];
  followUpOnly: boolean;
}

export type Mode = 'near' | 'route';

export interface RouteResult {
  /** [lat, lng] pairs along the driving route. */
  line: [number, number][];
  distanceKm: number;
  durationMin: number;
  /** True when the routing service failed and we fell back to a straight line. */
  approximate: boolean;
}

/** How a prospect relates to the active search: nearest property and its distance. */
export interface Match {
  prospect: Prospect;
  property: Property;
  /** Distance from the search point, or perpendicular distance from the route. */
  distanceKm: number;
  /** Distance along the route to the closest point (route mode only). */
  alongKm?: number;
  inRange: boolean;
}
