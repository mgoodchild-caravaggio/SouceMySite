import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Confirm } from '../components/Dialog';
import { companyLabel, displayName, formatDate, initials } from '../lib/filters';
import { useSession } from '../lib/session';
import { contactFromRow, useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types';

interface ArchivedRow {
  contact: Contact;
  archivedBy?: string;
}

/** Archived contacts in the current business: anyone can restore; admins can delete permanently. */
export default function ArchivePage() {
  const { profile, people, business } = useSession();
  const { reload } = useContacts();
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const isAdmin = profile.role === 'admin';
  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('contacts')
      .select('*, properties(*)')
      .not('archived_at', 'is', null)
      .eq('business', business)
      .order('archived_at', { ascending: false });
    if (e) return setError(`Couldn't load the archive: ${e.message}`);
    setRows((data as { archived_by: string | null }[]).map((r) => ({ contact: contactFromRow(r), archivedBy: r.archived_by ?? undefined })));
  }, [business]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  const restore = async (c: Contact) => {
    const { error: e } = await supabase.from('contacts').update({ archived_at: null }).eq('id', c.id);
    if (e) return setError(`Couldn't restore: ${e.message}`);
    await reload(c.id);
    setRows((prev) => prev?.filter((r) => r.contact.id !== c.id) ?? null);
  };

  const remove = async (c: Contact) => {
    const { error: e } = await supabase.from('contacts').delete().eq('id', c.id);
    if (e) return setError(`Couldn't delete: ${e.message}`);
    setRows((prev) => prev?.filter((r) => r.contact.id !== c.id) ?? null);
  };

  return (
    <div className="list-page">
      <header className="page-head">
        <div>
          <h1>Archive</h1>
          <span className="muted">
            {rows ? `${rows.length} archived · ${business}` : 'Loading…'}
            {isAdmin ? '' : ' · Only admins can delete permanently'}
          </span>
        </div>
      </header>

      {error && (
        <p className="notice warn" role="alert">
          {error}
        </p>
      )}

      <div className="table-wrap">
        <table className="contact-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="hide-sm">Company</th>
              <th>Archived</th>
              <th className="hide-sm">By</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows?.map(({ contact: c, archivedBy }) => (
              <tr key={c.id}>
                <td>
                  <div className="name-cell">
                    <span className="avatar sm other">{initials(c)}</span>
                    <div>
                      <Link to={`/contacts/${c.id}`}>{displayName(c)}</Link>
                      <div className="muted small">{c.isProspect ? 'Prospect' : 'Contact'}</div>
                    </div>
                  </div>
                </td>
                <td className="hide-sm">{companyLabel(c)}</td>
                <td className="nowrap">{c.archivedAt ? formatDate(c.archivedAt) : ''}</td>
                <td className="hide-sm">{archivedBy ? peopleById[archivedBy]?.displayName ?? 'Former user' : ''}</td>
                <td className="col-actions">
                  <button type="button" className="btn small" onClick={() => restore(c)}>
                    Restore
                  </button>
                  {isAdmin && (
                    <button type="button" className="btn small danger-outline" onClick={() => setDeleting(c)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && (
          <div className="empty">
            <strong>Nothing archived in {business}.</strong>
            <span>Archived contacts appear here and can be restored.</span>
          </div>
        )}
      </div>

      {deleting && (
        <Confirm
          title={`Permanently delete ${displayName(deleting)}?`}
          message="This removes the contact, their properties and all activity for good. It can't be undone."
          confirmLabel="Delete permanently"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const c = deleting;
            setDeleting(null);
            remove(c);
          }}
        />
      )}
    </div>
  );
}
