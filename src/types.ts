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
  'White Belt',
  'Expansion Boundary',
  'Urban Boundary',
  'Industrial Land',
  'Industrial Building',
  'Condo Land',
  'Investment Property',
  'Agricultural',
] as const;
export const CUSTOMER_TYPES = ['Buyer', 'Seller', 'Builder Developer', 'Investor'] as const;

export type Status = (typeof STATUSES)[number];
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

export interface Prospect {
  id: string;
  firstName: string;
  lastName: string;
  /** "tbd" when the prospect is an individual with no company, matching the Salesforce convention. */
  company: string;
  phone: string;
  email?: string;
  status: Status;
  leadSource: string;
  regions: Region[];
  categories: Category[];
  customerTypes: CustomerType[];
  dealValue?: number;
  followUp: boolean;
  campaigns: string[];
  notes: string;
  properties: Property[];
}

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
