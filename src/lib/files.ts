import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Files attached to a contact. The files live in the private `contact-files` Storage bucket. */
export const FILES_BUCKET = 'contact-files';
/** The project's upload limit per file. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface ContactFile {
  id: string;
  contactId: string;
  path: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedBy?: string;
  createdAt: string;
}

interface Row {
  id: string;
  contact_id: string;
  path: string;
  name: string;
  size: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
}

const fromRow = (r: Row): ContactFile => ({
  id: r.id,
  contactId: r.contact_id,
  path: r.path,
  name: r.name,
  size: Number(r.size),
  mimeType: r.mime_type,
  uploadedBy: r.uploaded_by ?? undefined,
  createdAt: r.created_at,
});

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Storage keys allow a limited set of characters; the real name is kept in the table. */
const safeKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(-120) || 'file';

/** A contact's files, newest first, with upload, open and delete. */
export function useContactFiles(contactId: string) {
  const [files, setFiles] = useState<ContactFile[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('contact_files').select('*').eq('contact_id', contactId).order('created_at', { ascending: false });
    if (e) return setError(`Couldn't load files: ${e.message}`);
    setFiles((data as Row[]).map(fromRow));
  }, [contactId]);

  useEffect(() => {
    setFiles(null);
    load();
  }, [load]);

  /** Uploads each file; returns messages for any that failed. */
  const upload = async (list: File[]): Promise<string[]> => {
    const problems: string[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) {
        problems.push(`${f.name} is ${formatBytes(f.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
        continue;
      }
      const path = `${contactId}/${crypto.randomUUID()}-${safeKey(f.name)}`;
      const { error: up } = await supabase.storage.from(FILES_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up) {
        problems.push(`${f.name}: ${up.message}`);
        continue;
      }
      const { error: e } = await supabase.from('contact_files').insert({ contact_id: contactId, path, name: f.name, size: f.size, mime_type: f.type });
      if (e) {
        await supabase.storage.from(FILES_BUCKET).remove([path]);
        problems.push(`${f.name}: ${e.message}`);
      }
    }
    await load();
    return problems;
  };

  const remove = async (file: ContactFile) => {
    const { error: e } = await supabase.from('contact_files').delete().eq('id', file.id);
    if (e) return `Couldn't remove ${file.name}: ${e.message}`;
    await supabase.storage.from(FILES_BUCKET).remove([file.path]);
    setFiles((prev) => prev?.filter((x) => x.id !== file.id) ?? null);
    return '';
  };

  return { files, error, upload, remove, reload: load };
}

/** A short-lived link to open (or, with `download`, save) a file. */
export async function fileUrl(file: ContactFile, download = false) {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(file.path, 300, download ? { download: file.name } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Removes every stored file of a contact (before the contact itself is deleted). */
export async function removeAllFiles(contactId: string) {
  const { data } = await supabase.from('contact_files').select('path').eq('contact_id', contactId);
  const paths = (data ?? []).map((r) => r.path as string);
  if (paths.length) await supabase.storage.from(FILES_BUCKET).remove(paths);
}
