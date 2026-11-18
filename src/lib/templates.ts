import { useCallback, useEffect, useState } from 'react';
import { companyLabel } from './filters';
import { supabase } from './supabase';
import type { Contact } from '../types';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  shared: boolean;
  ownerId?: string;
  updatedAt: string;
}

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  shared: boolean;
  owner_id: string | null;
  updated_at: string;
}

const fromRow = (r: TemplateRow): EmailTemplate => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  shared: r.shared,
  ownerId: r.owner_id ?? undefined,
  updatedAt: r.updated_at,
});

/** Templates the signed-in person can use: the team's shared ones and their own. */
export function useTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('email_templates').select('*').order('name');
    if (e) return setError(e.message);
    setTemplates((data as TemplateRow[]).map(fromRow));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (t: Pick<EmailTemplate, 'name' | 'subject' | 'body' | 'shared'> & { id?: string }) => {
      const row = { name: t.name.trim(), subject: t.subject, body: t.body, shared: t.shared };
      const { error: e } = t.id
        ? await supabase.from('email_templates').update(row).eq('id', t.id)
        : await supabase.from('email_templates').insert(row);
      if (e) return e.message;
      await load();
      return '';
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: e } = await supabase.from('email_templates').delete().eq('id', id);
      if (e) return e.message;
      await load();
      return '';
    },
    [load],
  );

  return { templates, error, save, remove, reload: load };
}

/** Merge fields people can put in templates, with what each one becomes. */
export const MERGE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'full_name', label: 'Full name' },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title / role' },
  { key: 'property_address', label: 'Property address' },
  { key: 'region', label: 'Region' },
  { key: 'my_name', label: 'Your name' },
] as const;

export type MergeKey = (typeof MERGE_FIELDS)[number]['key'];

export function mergeValues(c: Contact, myName: string): Record<MergeKey, string> {
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    full_name: `${c.firstName} ${c.lastName}`.trim(),
    company: companyLabel(c),
    title: c.title,
    property_address: c.properties[0]?.address ?? '',
    region: c.regions[0] ?? '',
    my_name: myName,
  };
}

/** Fills {{merge_fields}} in text. Returns the result and any fields that had no value for this contact. */
export function fillTemplate(text: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in values)) return match; // unknown field: leave it visible so it gets noticed
    if (!values[key]) missing.add(key);
    return values[key];
  });
  return { text: out, missing: [...missing] };
}

/** Field keys used in a text that Hub doesn't recognise (typos like {{firstname}}). */
export function unknownFields(text: string): string[] {
  const known = new Set<string>(MERGE_FIELDS.map((f) => f.key));
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !known.has(k)))];
}
