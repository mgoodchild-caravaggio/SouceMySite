import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Business, Category, Contact, CustomerType, Property, Prospect, Region, Status } from '../types';

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
  emailConsent: 'email_consent',
  consentDate: 'consent_date',
  consentSource: 'consent_source',
  consentExpiresOn: 'consent_expires_on',
  unsubscribedAt: 'unsubscribed_at',
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
  email_consent: Contact['emailConsent'];
  consent_date: string | null;
  consent_source: string;
  consent_expires_on: string | null;
  unsubscribed_at: string | null;
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
    emailConsent: r.email_consent,
    consentDate: r.consent_date ?? undefined,
    consentSource: r.consent_source,
    consentExpiresOn: r.consent_expires_on ?? undefined,
    unsubscribedAt: r.unsubscribed_at ?? undefined,
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

/** A new contact: everything except the id, properties and fields the database fills in. */
export type NewContact = Omit<Contact, 'id' | 'properties' | 'followUp' | 'archivedAt'>;
export type PropertyInput = Omit<Property, 'id'>;

const SELECT = '*, properties(*)';

interface ContactsValue {
  /** Every contact that isn't archived, in both businesses. */
  contacts: Contact[];
  loading: boolean;
  /** When each contact last had an activity (ISO timestamp), by contact id. */
  lastActivity: Record<string, string>;
  update: (id: string, patch: ContactPatch) => Promise<void>;
  updateMany: (ids: string[], patch: ContactPatch) => Promise<void>;
  create: (input: NewContact) => Promise<Contact | null>;
  archive: (ids: string[]) => Promise<void>;
  /** Puts a restored (or otherwise changed elsewhere) contact back in the list from the database. */
  reload: (id: string) => Promise<Contact | null>;
  addProperty: (contactId: string, input: PropertyInput) => Promise<void>;
  updateProperty: (contactId: string, propertyId: string, input: PropertyInput) => Promise<void>;
  removeProperty: (contactId: string, propertyId: string) => Promise<void>;
  /** Call after logging an activity so the lists' "Last activity" stays current. */
  touchActivity: (contactId: string, at: string) => void;
}

const ContactsContext = createContext<ContactsValue | null>(null);

/**
 * Supabase returns at most 1,000 rows per request, so read a table in pages until it runs out.
 * `build` must return a fresh, ordered query each time.
 */
async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

/** Fetches one contact (archived or not) straight from the database. */
export async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase.from('contacts').select(SELECT).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return fromRow(data as ContactRow);
}

export function contactFromRow(row: unknown): Contact {
  return fromRow(row as ContactRow);
}

/** Loads contacts with their properties once per sign-in, and saves edits to Supabase. */
export function ContactsProvider({ onError, children }: { onError: (message: string) => void; children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState<Record<string, string>>({});
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAll(() => supabase.from('contacts').select(SELECT).is('archived_at', null).order('last_name').order('id')),
      fetchAll(() => supabase.from('contact_last_activity').select('contact_id, last_activity_at').order('contact_id')),
    ]).then(([contactsRes, activityRes]) => {
      if (cancelled) return;
      if (contactsRes.error) onError(`Couldn't load contacts: ${contactsRes.error.message}`);
      else setContacts((contactsRes.data as ContactRow[]).map(fromRow));
      if (!activityRes.error) {
        setLastActivity(
          Object.fromEntries((activityRes.data as { contact_id: string; last_activity_at: string }[]).map((r) => [r.contact_id, r.last_activity_at])),
        );
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const setOne = (id: string, fn: (c: Contact) => Contact) => setContacts((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const update = useCallback(
    async (id: string, patch: ContactPatch) => {
      // Show the change straight away, and put the old values back if the save fails.
      const before = contactsRef.current.find((c) => c.id === id);
      if (!before) return;
      const changes = normalize(patch);
      const undo = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof Contact]])) as Partial<Contact>;
      setOne(id, (c) => ({ ...c, ...changes }));
      const { error } = await supabase.from('contacts').update(toRow(changes)).eq('id', id);
      if (error) {
        setOne(id, (c) => ({ ...c, ...undo }));
        onError(`Couldn't save the change: ${error.message}`);
      }
    },
    [onError],
  );

  const updateMany = useCallback(
    async (ids: string[], patch: ContactPatch) => {
      if (!ids.length) return;
      const changes = normalize(patch);
      const { error } = await supabase.from('contacts').update(toRow(changes)).in('id', ids);
      if (error) return onError(`Couldn't update ${ids.length} contacts: ${error.message}`);
      setContacts((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, ...changes } : c)));
    },
    [onError],
  );

  const create = useCallback(
    async (input: NewContact) => {
      const { data, error } = await supabase.from('contacts').insert(toRow(input)).select(SELECT).single();
      if (error) {
        onError(`Couldn't add the contact: ${error.message}`);
        return null;
      }
      const contact = fromRow(data as ContactRow);
      setContacts((prev) => [...prev, contact]);
      setLastActivity((prev) => ({ ...prev, [contact.id]: new Date().toISOString() }));
      return contact;
    },
    [onError],
  );

  const archive = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase.from('contacts').update({ archived_at: new Date().toISOString() }).in('id', ids);
      if (error) return onError(`Couldn't archive: ${error.message}`);
      setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
    },
    [onError],
  );

  const reload = useCallback(async (id: string) => {
    const contact = await fetchContact(id);
    setContacts((prev) => {
      const rest = prev.filter((c) => c.id !== id);
      return contact && !contact.archivedAt ? [...rest, contact] : rest;
    });
    return contact;
  }, []);

  const propertyRow = (contactId: string, input: PropertyInput) => ({
    contact_id: contactId,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    acres: input.acres ?? null,
    category: input.category,
    relation: input.relation,
  });

  const addProperty = useCallback(
    async (contactId: string, input: PropertyInput) => {
      const { data, error } = await supabase.from('properties').insert(propertyRow(contactId, input)).select().single();
      if (error) return onError(`Couldn't add the property: ${error.message}`);
      const row = data as PropertyRow;
      setOne(contactId, (c) => ({ ...c, properties: [...c.properties, { ...row, acres: row.acres ?? undefined }] }));
    },
    [onError],
  );

  const updateProperty = useCallback(
    async (contactId: string, propertyId: string, input: PropertyInput) => {
      const { error } = await supabase.from('properties').update(propertyRow(contactId, input)).eq('id', propertyId);
      if (error) return onError(`Couldn't save the property: ${error.message}`);
      setOne(contactId, (c) => ({ ...c, properties: c.properties.map((p) => (p.id === propertyId ? { ...input, id: propertyId } : p)) }));
    },
    [onError],
  );

  const removeProperty = useCallback(
    async (contactId: string, propertyId: string) => {
      const { error } = await supabase.from('properties').delete().eq('id', propertyId);
      if (error) return onError(`Couldn't remove the property: ${error.message}`);
      setOne(contactId, (c) => ({ ...c, properties: c.properties.filter((p) => p.id !== propertyId) }));
    },
    [onError],
  );

  const touchActivity = useCallback((contactId: string, at: string) => {
    setLastActivity((prev) => (prev[contactId] && prev[contactId] >= at ? prev : { ...prev, [contactId]: at }));
  }, []);

  return (
    <ContactsContext.Provider
      value={{ contacts, loading, lastActivity, update, updateMany, create, archive, reload, addProperty, updateProperty, removeProperty, touchActivity }}
    >
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts() {
  const value = useContext(ContactsContext);
  if (!value) throw new Error('useContacts must be used inside ContactsProvider');
  return value;
}

/** Downloads contacts as a CSV file. */
export function exportContacts(rows: Contact[], filename: string) {
  const header = ['First name', 'Last name', 'Company', 'Title', 'Phone', 'Phone 2', 'Email', 'Status', 'Customer types', 'Follow-up', 'Properties'];
  downloadCsv(
    [header, ...rows.map((c) => [
      c.firstName, c.lastName, c.company === 'tbd' ? '' : c.company, c.title, c.phone, c.phone2, c.email ?? '',
      c.isProspect ? c.status : '', c.customerTypes.join('; '), c.followUpOn ?? '', c.properties.map((p) => p.address).join('; '),
    ])],
    filename,
  );
}

function downloadCsv(rows: string[][], filename: string) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCallList(rows: { prospect: Prospect; distanceLabel?: string; address?: string }[]) {
  const header = ['Name', 'Company', 'Phone', 'Email', 'Status', 'Distance', 'Property'];
  downloadCsv(
    [header, ...rows.map(({ prospect: p, distanceLabel, address }) => [
      `${p.firstName} ${p.lastName}`, p.company, p.phone, p.email ?? '', p.status, distanceLabel ?? '', address ?? '',
    ])],
    `call-list-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}
