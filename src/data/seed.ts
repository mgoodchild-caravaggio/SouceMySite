import type { Category, Contact, CustomerType, Prospect, Property, Region, Status } from '../types';

// Fictional sample data. Names, companies, phone numbers (555-01xx) and emails (example.com)
// are invented; locations are scattered around real Southern Ontario towns so the map is realistic.

export const CAMPAIGNS = [
  'Intro Letter Sellers',
  'Durham Intro to sellers',
  'Durham Land Sellers',
  'hewitts creek land owners group',
  'Expansion Boundary Land Sellers',
  'White Belt Agricultural Buyers',
  'Past Clients',
  'barrie sec 1',
  'barrie sec 2',
  '3 month to close - Opportunity',
  'Hamilton Elfrida',
  'Sphere of Influence',
  'Innisfil Heights Industrial',
  'Intro Letter Buyers',
  'Market Watch',
];

interface Anchor {
  town: string;
  lat: number;
  lng: number;
  region: Region;
  spreadKm: number;
  areaCode: string;
  categories: Category[];
  campaigns: string[];
}

const ANCHORS: Anchor[] = [
  { town: 'Barrie', lat: 44.3894, lng: -79.6903, region: 'Simcoe', spreadKm: 7, areaCode: '705', categories: ['Expansion Boundary', 'Residential Land', 'Residential'], campaigns: ['barrie sec 1', 'barrie sec 2', 'Intro Letter Sellers'] },
  { town: 'Innisfil', lat: 44.3550, lng: -79.6200, region: 'Simcoe', spreadKm: 6, areaCode: '705', categories: ['Industrial Land', 'Industrial Building', 'Expansion Boundary'], campaigns: ['Innisfil Heights Industrial', 'hewitts creek land owners group'] },
  { town: 'Oro-Medonte', lat: 44.5000, lng: -79.5500, region: 'Simcoe', spreadKm: 9, areaCode: '705', categories: ['White Belt', 'Agricultural'], campaigns: ['White Belt Agricultural Buyers', 'Intro Letter Sellers'] },
  { town: 'Bradford', lat: 44.1140, lng: -79.5660, region: 'Simcoe', spreadKm: 6, areaCode: '905', categories: ['White Belt', 'Agricultural', 'Expansion Boundary'], campaigns: ['Intro Letter Sellers', 'Expansion Boundary Land Sellers'] },
  { town: 'Orillia', lat: 44.6080, lng: -79.4200, region: 'Simcoe', spreadKm: 6, areaCode: '705', categories: ['Investment Property', 'Residential'], campaigns: ['Sphere of Influence'] },
  { town: 'Newmarket', lat: 44.0590, lng: -79.4610, region: 'York', spreadKm: 5, areaCode: '905', categories: ['Residential', 'Investment Property'], campaigns: ['Past Clients', 'Market Watch'] },
  { town: 'Stouffville', lat: 43.9700, lng: -79.2500, region: 'York', spreadKm: 6, areaCode: '905', categories: ['White Belt', 'Expansion Boundary'], campaigns: ['Expansion Boundary Land Sellers'] },
  { town: 'King', lat: 43.9260, lng: -79.5280, region: 'York', spreadKm: 7, areaCode: '905', categories: ['White Belt', 'Agricultural'], campaigns: ['White Belt Agricultural Buyers'] },
  { town: 'Georgina', lat: 44.2500, lng: -79.4600, region: 'York', spreadKm: 6, areaCode: '905', categories: ['Agricultural', 'Residential Land'], campaigns: ['Intro Letter Sellers'] },
  { town: 'Uxbridge', lat: 44.1080, lng: -79.1200, region: 'Durham', spreadKm: 7, areaCode: '905', categories: ['White Belt', 'Agricultural'], campaigns: ['Durham Land Sellers', 'Durham Intro to sellers'] },
  { town: 'Pickering', lat: 43.9000, lng: -79.1300, region: 'Durham', spreadKm: 5, areaCode: '905', categories: ['Expansion Boundary', 'Industrial Land'], campaigns: ['Durham Intro to sellers', '3 month to close - Opportunity'] },
  { town: 'Brooklin', lat: 43.9600, lng: -78.9500, region: 'Durham', spreadKm: 6, areaCode: '905', categories: ['Expansion Boundary', 'Residential Land'], campaigns: ['Durham Land Sellers'] },
  { town: 'Bowmanville', lat: 43.9120, lng: -78.6900, region: 'Durham', spreadKm: 7, areaCode: '905', categories: ['White Belt', 'Industrial Land'], campaigns: ['Durham Land Sellers', 'Durham Intro to sellers'] },
  { town: 'Port Perry', lat: 44.1000, lng: -78.9400, region: 'Durham', spreadKm: 5, areaCode: '905', categories: ['Agricultural', 'Investment Property'], campaigns: ['Durham Intro to sellers'] },
  { town: 'Milton', lat: 43.5180, lng: -79.8770, region: 'Halton', spreadKm: 6, areaCode: '905', categories: ['Industrial Land', 'Expansion Boundary'], campaigns: ['Expansion Boundary Land Sellers', '3 month to close - Opportunity'] },
  { town: 'Georgetown', lat: 43.6480, lng: -79.9200, region: 'Halton', spreadKm: 6, areaCode: '905', categories: ['White Belt', 'Industrial Building'], campaigns: ['Intro Letter Sellers'] },
  { town: 'Caledon', lat: 43.8600, lng: -79.8600, region: 'Peel', spreadKm: 8, areaCode: '905', categories: ['White Belt', 'Agricultural', 'Expansion Boundary'], campaigns: ['White Belt Agricultural Buyers', 'Expansion Boundary Land Sellers'] },
  { town: 'Brampton', lat: 43.7500, lng: -79.7800, region: 'Peel', spreadKm: 5, areaCode: '905', categories: ['Industrial Building', 'Industrial Land'], campaigns: ['Intro Letter Buyers', 'Past Clients'] },
  { town: 'Elfrida', lat: 43.1700, lng: -79.8000, region: 'Hamilton-Wentworth', spreadKm: 5, areaCode: '905', categories: ['White Belt', 'Expansion Boundary'], campaigns: ['Hamilton Elfrida'] },
  { town: 'Binbrook', lat: 43.1200, lng: -79.8100, region: 'Hamilton-Wentworth', spreadKm: 5, areaCode: '905', categories: ['Agricultural', 'White Belt'], campaigns: ['Hamilton Elfrida'] },
  { town: 'Waterdown', lat: 43.3300, lng: -79.8900, region: 'Hamilton-Wentworth', spreadKm: 4, areaCode: '905', categories: ['Residential Land', 'Residential'], campaigns: ['Sphere of Influence'] },
  { town: 'Etobicoke', lat: 43.6800, lng: -79.5800, region: 'Toronto', spreadKm: 4, areaCode: '416', categories: ['Industrial Building', 'Investment Property'], campaigns: ['Past Clients', 'Market Watch'] },
  { town: 'Scarborough', lat: 43.7800, lng: -79.2300, region: 'Toronto', spreadKm: 4, areaCode: '416', categories: ['Residential', 'Investment Property'], campaigns: ['Sphere of Influence'] },
  { town: 'London', lat: 42.9800, lng: -81.2500, region: 'Middlesex', spreadKm: 8, areaCode: '519', categories: ['Industrial Land', 'Expansion Boundary'], campaigns: ['Intro Letter Sellers'] },
  { town: 'Norwood', lat: 44.3800, lng: -77.9800, region: 'Peterborough', spreadKm: 6, areaCode: '705', categories: ['Agricultural', 'White Belt'], campaigns: ['Intro Letter Sellers'] },
];

const FIRST = ['Adam', 'Alana', 'Bruno', 'Carla', 'Dario', 'Donna', 'Ed', 'Elena', 'Frank', 'Gina', 'Hank', 'Irene', 'Jake', 'Joanne', 'Ken', 'Lina', 'Marco', 'Maria', 'Nick', 'Olga', 'Paul', 'Rita', 'Sal', 'Sandra', 'Tom', 'Tina', 'Victor', 'Wendy', 'Walt', 'Yvonne', 'Gord', 'Doug', 'Bev', 'Luca', 'Priya', 'Raj', 'Wei', 'Grace'];
const LAST = ['Abernathy', 'Bellamy', 'Castellano', 'Dunmore', 'Ellison', 'Fairbairn', 'Galloway', 'Hollister', 'Iacono', 'Jardine', 'Kowalczyk', 'Lindqvist', 'MacPhail', 'Novak', 'Oakley', 'Pellegrino', 'Quigley', 'Rourke', 'Sinclair', 'Tremblay', 'Underhill', 'Vanderveen', 'Whitcombe', 'Yardley', 'Zelinski', 'Brennan', 'Coutts', 'DeLuca', 'Fenwick', 'Greaves', 'Harcourt', 'Kirkpatrick', 'Lamontagne', 'Mercer', 'Prentice', 'Sutherland'];
const COMPANY_SUFFIX = ['Farms', 'Holdings Inc', 'Developments Ltd', 'Sand and Gravel', 'Homes', 'Properties', 'Investments', 'Construction', 'Land Corp'];
const ROADS = ['Concession 4', 'Concession 6', 'Concession 9', '5th Line', '6th Line', '8th Line', 'Sideroad 10', 'Sideroad 15', 'Sideroad 20', 'Townline Rd', 'Old Mill Rd', 'Ridge Rd', 'Lakeshore Rd', 'Station St', 'Industrial Pkwy', 'County Rd 27', 'Regional Rd 8', 'Gore Rd', 'Mud Lake Rd', 'Pinegrove Ave'];
const LEAD_SOURCES = ['Advertisement', 'Advertisement', 'Advertisement', 'Referral', 'Cold Call'];
const STATUS_WEIGHTS: [Status, number][] = [['Prospect', 60], ['Contacted', 12], ['Lead', 18], ['Active Lead', 7], ['Unqualified', 3]];

// Small deterministic PRNG so every load produces the same sample book.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeed(count: number): Prospect[] {
  const rand = mulberry32(20261029);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const some = <T,>(arr: readonly T[], max: number) => {
    const n = 1 + Math.floor(rand() * max);
    return [...new Set(Array.from({ length: n }, () => pick(arr)))];
  };
  const weighted = <T,>(pairs: [T, number][]) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
    return pairs[0][0];
  };
  const jitter = (a: Anchor) => {
    const dist = Math.sqrt(rand()) * a.spreadKm;
    const angle = rand() * Math.PI * 2;
    return {
      lat: a.lat + (dist * Math.cos(angle)) / 111,
      lng: a.lng + (dist * Math.sin(angle)) / (111 * Math.cos((a.lat * Math.PI) / 180)),
    };
  };

  const usedPhones = new Set<string>();
  const prospects: Prospect[] = [];

  for (let i = 0; i < count; i++) {
    const home = pick(ANCHORS);
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const isPerson = rand() < 0.45;
    const company = isPerson ? 'tbd' : `${rand() < 0.5 ? lastName : pick(LAST)} ${pick(COMPANY_SUFFIX)}`;

    let phone = '';
    do {
      phone = `${home.areaCode} 555 01${String(Math.floor(rand() * 100)).padStart(2, '0')}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // Weighted towards sellers, since most prospects own the parcel on the map.
    const customerTypes = some<CustomerType>(
      ['Seller', 'Seller', 'Seller', 'Agricultural', 'Investor', 'Buyer', 'Builder/Developer', 'Past Client', 'Finance/Lender', 'Referral Source', 'Infrastructure'],
      2,
    );
    const propertyCount = rand() < 0.72 ? 1 : rand() < 0.85 ? 2 : 3;
    const properties: Property[] = [];
    for (let p = 0; p < propertyCount; p++) {
      // Second and third properties sometimes sit in a neighbouring area.
      const anchor = p === 0 || rand() < 0.6 ? home : pick(ANCHORS);
      const pos = jitter(anchor);
      properties.push({
        id: `p${i}-${p}`,
        ...pos,
        address: `${100 + Math.floor(rand() * 9800)} ${pick(ROADS)}, ${anchor.town}`,
        acres: rand() < 0.8 ? Math.round((2 + rand() * 180) * 10) / 10 : undefined,
        category: pick(anchor.categories),
        relation: customerTypes.includes('Seller') || !customerTypes.includes('Buyer') ? 'Owns' : 'Interested in',
      });
    }

    const regions = [...new Set<Region>([home.region, ...properties.map((p) => regionOf(p, home))])];
    if (rand() < 0.2) regions.push('Greater Golden Horseshoe');

    prospects.push({
      id: `L${String(i + 1).padStart(4, '0')}`,
      firstName,
      lastName,
      company,
      phone,
      email: rand() < 0.5 ? `${firstName}.${lastName}@example.com`.toLowerCase() : undefined,
      status: weighted(STATUS_WEIGHTS),
      leadSource: pick(LEAD_SOURCES),
      regions,
      categories: [...new Set([...properties.map((p) => p.category), ...(rand() < 0.3 ? [pick(home.categories)] : [])])],
      customerTypes,
      dealValue: rand() < 0.35 ? Math.round((300_000 + rand() * 6_000_000) / 10_000) * 10_000 : undefined,
      ...followUp(rand() < 0.25 ? Math.floor(rand() * 24) - 10 : null),
      business: 'Real Estate',
      isProspect: true,
      ...sampleConsent(customerTypes, rand),
      title: '',
      phone2: '',
      website: '',
      mailingAddress: '',
      campaigns: rand() < 0.15 ? [] : some(home.campaigns, 2),
      notes: '',
      properties,
    });
  }
  return prospects;
}

function regionOf(p: Property, fallback: Anchor): Region {
  const town = p.address.split(', ').pop();
  return ANCHORS.find((a) => a.town === town)?.region ?? fallback.region;
}

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA');
};
const plusMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-CA');
};

/** Sample CASL consent: past clients have implied consent from a deal, referrals from an inquiry, a few gave express consent. */
function sampleConsent(types: CustomerType[], rand: () => number): Pick<Contact, 'emailConsent' | 'consentDate' | 'consentSource' | 'consentExpiresOn'> {
  const r = rand();
  if (types.includes('Past Client')) {
    const date = isoDaysAgo(Math.floor(rand() * 900)); // some past the 2-year window
    return { emailConsent: 'implied', consentDate: date, consentSource: 'Past client: closed deal', consentExpiresOn: plusMonths(date, 24) };
  }
  if (types.includes('Referral Source') || r < 0.12) {
    const date = isoDaysAgo(Math.floor(rand() * 260));
    return { emailConsent: 'implied', consentDate: date, consentSource: 'Inquiry', consentExpiresOn: plusMonths(date, 6) };
  }
  if (r < 0.2) return { emailConsent: 'express', consentDate: isoDaysAgo(Math.floor(rand() * 400)), consentSource: 'Signed up at open house', consentExpiresOn: undefined };
  return { emailConsent: 'none', consentSource: '' };
}

/** A follow-up `days` from today (negative = overdue), or none. */
function followUp(days: number | null): Pick<Contact, 'followUp' | 'followUpOn'> {
  if (days === null) return { followUp: false };
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { followUp: true, followUpOn: d.toLocaleDateString('en-CA') };
}

// Contacts who aren't prospects: people the team works with, in both businesses.
const OTHER_CONTACTS: [first: string, last: string, company: string, title: string, business: Contact['business'], types: CustomerType[]][] = [
  ['Helen', 'Marchetti', 'Marchetti Law LLP', 'Real estate lawyer', 'Real Estate', ['Referral Source']],
  ['Owen', 'Pratt', 'Lakeshore Credit Union', 'Commercial lender', 'Real Estate', ['Finance/Lender']],
  ['Farah', 'Siddiqui', 'Town of Innisfil', 'Senior planner', 'Real Estate', ['Infrastructure']],
  ['Glen', 'Archer', 'Archer Surveying', 'Land surveyor', 'Real Estate', ['Referral Source']],
  ['Monica', 'Teixeira', 'Northshore Mortgage', 'Mortgage broker', 'Real Estate', ['Finance/Lender']],
  ['Ray', 'Dubois', 'Region of Durham', 'Infrastructure planning', 'Real Estate', ['Infrastructure']],
  ['Claire', 'Okafor', 'Okafor Appraisals', 'Appraiser', 'Real Estate', ['Referral Source']],
  ['Bill', 'Hartley', 'Hartley Farms', 'Owner', 'Real Estate', ['Agricultural', 'Past Client']],
  ['Ines', 'Moreau', 'Moreau Planning Group', 'Planning consultant', 'Real Estate', ['Referral Source']],
  ['Derek', 'Lau', 'Simcoe Builders Assoc.', 'Executive director', 'Real Estate', ['Builder/Developer']],
  ['Nadia', 'Rossi', 'Rossi Realty', 'Listing agent', 'Staging', ['Referral Source']],
  ['Chris', 'Bauer', 'tbd', 'Homeowner', 'Staging', ['Seller']],
  ['Amara', 'Jones', 'Coldwell Lakeshore', 'Sales representative', 'Staging', ['Referral Source']],
  ['Stefan', 'Novak', 'Novak Moving & Storage', 'Operations', 'Staging', []],
  ['Leah', 'Kim', 'tbd', 'Homeowner', 'Staging', ['Seller', 'Past Client']],
  ['Pat', 'Moretti', 'Moretti Furniture Rental', 'Account manager', 'Staging', []],
];

function buildOtherContacts(): Contact[] {
  const rand = mulberry32(42); // repeatable sample consent
  return OTHER_CONTACTS.map(([firstName, lastName, company, title, business, customerTypes], i) => ({
    id: `C${String(i + 1).padStart(4, '0')}`,
    business,
    isProspect: false,
    firstName,
    lastName,
    company,
    title,
    phone: `905 555 02${String(i).padStart(2, '0')}`, // 555-02xx, separate from prospects' 555-01xx
    phone2: '',
    email: `${firstName}.${lastName}@example.com`.toLowerCase(),
    website: '',
    mailingAddress: '',
    status: 'Prospect',
    leadSource: 'Referral',
    regions: [],
    categories: [],
    customerTypes,
    followUp: false,
    campaigns: [],
    notes: '',
    properties: [],
    ...sampleConsent(customerTypes, rand),
  }));
}

export const SEED_PROSPECTS = buildSeed(110);
export const SEED_CONTACTS: Contact[] = [...SEED_PROSPECTS, ...buildOtherContacts()];
