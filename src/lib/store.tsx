import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Business, Category, Contact, CustomerType, Prospect, Region, Status } from '../types';

/** Fields of a contact that can be edited, and their database column names. */
const COLUMNS = {
  business: 'business',
  isProspect: 'is_prospect',
  firstName: 'first_name',
  lastName: 'last_name',
  company: 'company',
  title: 'title',
  phone: 'phone',
  phone2: 'phone_2',
  email: 'email',
  website: 'website',
  mailingAddress: 'mailing_address',
  status: 'status',
  leadSource: 'lead_source',
  regions: 'regions',
  categories: 'categories',
  customerTypes: 'customer_types',
  dealValue: 'deal_value',
  followUpOn: 'follow_up_on',
  assignedTo: 'assigned_to',
  archivedAt: 'archived_at',
  campaigns: 'campaigns',
  notes: 'notes',
} as const;

type EditableKey = keyof typeof COLUMNS;
/** An edit to a contact. `followUp` is a shortcut: true sets the follow-up to today, false clears it. */
export type ContactPatch = Partial<Pick<Contact, EditableKey>> & { followUp?: boolean };

interface PropertyRow {
  id: string;
  address: string;
  lat: number;
  lng: number;
  acres: number | null;
  category: Category;
  relation: 'Owns' | 'Interested in';
}

interface ContactRow {
  id: string;
  business: Business;
  is_prospect: boolean;
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  phone: string;
  phone_2: string;
  email: string | null;
  website: string;
  mailing_address: string;
  status: Status;
  lead_source: string;
  regions: Region[];
  categories: Category[];
  customer_types: CustomerType[];
  deal_value: number | null;
  follow_up_on: string | null;
  assigned_to: string | null;
  archived_at: string | null;
  campaigns: string[];
  notes: string;
  properties: PropertyRow[];
}

function fromRow(r: ContactRow): Contact {
  return {
    id: r.id,
    business: r.business,
    isProspect: r.is_prospect,
    firstName: r.first_name,
    lastName: r.last_name,
    company: r.company,
    title: r.title,
    phone: r.phone,
    phone2: r.phone_2,
    email: r.email ?? undefined,
    website: r.website,
    mailingAddress: r.mailing_address,
    status: r.status,
    leadSource: r.lead_source,
    regions: r.regions,
    categories: r.categories,
    customerTypes: r.customer_types,
    dealValue: r.deal_value ?? undefined,
    followUpOn: r.follow_up_on ?? undefined,
    followUp: r.follow_up_on != null,
    assignedTo: r.assigned_to ?? undefined,
    archivedAt: r.archived_at ?? undefined,
    campaigns: r.campaigns,
    notes: r.notes,
    properties: r.properties.map((p) => ({ ...p, acres: p.acres ?? undefined })),
  };
}

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

/** Turns a patch into the full set of changed app fields (expanding the followUp shortcut). */
function normalize(patch: ContactPatch): Partial<Contact> {
  const { followUp, ...rest } = patch;
  const out: Partial<Contact> = { ...rest };
  if (followUp !== undefined) out.followUpOn = followUp ? today() : undefined;
  if ('followUpOn' in out) out.followUp = out.followUpOn != null;
  return out;
}

function toRow(changes: Partial<Contact>) {
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (key in changes) row[column] = changes[key as EditableKey] ?? null;
  }
  return row;
}

interface ContactsValue {
  /** Every contact that isn't archived, in both businesses. */
  contacts: Contact[];
  loading: boolean;
  update: (id: string, patch: ContactPatch) => Promise<void>;
}

const ContactsContext = createContext<ContactsValue | null>(null);

/** Loads contacts with their properties once per sign-in, and saves edits to Supabase. */
export function ContactsProvider({ onError, children }: { onError: (message: string) => void; children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('contacts')
      .select('*, properties(*)')
      .is('archived_at', null)
      .order('last_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) onError(`Couldn't load contacts: ${error.message}`);
        else setContacts((data as ContactRow[]).map(fromRow));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const update = useCallback(
    async (id: string, patch: ContactPatch) => {
      // Show the change straight away, and put the old values back if the save fails.
      const before = contactsRef.current.find((c) => c.id === id);
      if (!before) return;
      const changes = normalize(patch);
      const undo = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof Contact]])) as Partial<Contact>;
      setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)));
      const { error } = await supabase.from('contacts').update(toRow(changes)).eq('id', id);
      if (error) {
        setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...undo } : c)));
        onError(`Couldn't save the change: ${error.message}`);
      }
    },
    [onError],
  );

  return <ContactsContext.Provider value={{ contacts, loading, update }}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const value = useContext(ContactsContext);
  if (!value) throw new Error('useContacts must be used inside ContactsProvider');
  return value;
}

export function exportCallList(rows: { prospect: Prospect; distanceLabel?: string; address?: string }[]) {
  const header = ['Name', 'Company', 'Phone', 'Email', 'Status', 'Distance', 'Property'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map(({ prospect: p, distanceLabel, address }) =>
    [`${p.firstName} ${p.lastName}`, p.company, p.phone, p.email ?? '', p.status, distanceLabel ?? '', address ?? '']
      .map(esc)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `call-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
