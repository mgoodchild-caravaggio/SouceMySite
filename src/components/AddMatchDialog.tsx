import { useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import { companyLabel, displayName } from '../lib/filters';
import { useOpportunities, type Opportunity } from '../lib/opportunities';
import { useContacts } from '../lib/store';
import type { Contact } from '../types';

/**
 * Match someone to a listing or requirement by hand, e.g. a buyer you know wants this land even though
 * their requirement says otherwise. If they have open opportunities of the other kind, pick which one.
 */
export function AddMatchDialog({ opportunity, onClose }: { opportunity: Opportunity; onClose: () => void }) {
  const { contacts } = useContacts();
  const { opportunities, manualMatches, addManualMatch } = useOpportunities();
  const [text, setText] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [otherId, setOtherId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const owner = contacts.find((c) => c.id === opportunity.contactId);
  const wantKind = opportunity.kind === 'listing' ? 'requirement' : 'listing';
  // Already matched by hand, from either side.
  const taken = useMemo(() => {
    const ids = new Set<string>();
    for (const m of manualMatches) {
      if (m.opportunityId === opportunity.id) ids.add(m.contactId);
      if (m.otherOpportunityId === opportunity.id) {
        const o = opportunities.find((x) => x.id === m.opportunityId);
        if (o) ids.add(o.contactId);
      }
    }
    return ids;
  }, [manualMatches, opportunities, opportunity.id]);

  const results = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts
      .filter((c) => c.business === owner?.business && !c.archivedAt && c.id !== opportunity.contactId)
      .filter((c) => `${displayName(c)} ${c.company} ${c.phone} ${c.email ?? ''}`.toLowerCase().includes(q))
      .slice(0, 10);
  }, [text, contacts, owner?.business, opportunity.contactId]);

  const theirs = contact ? opportunities.filter((o) => o.contactId === contact.id && o.kind === wantKind && o.status === 'open') : [];

  const pick = (c: Contact) => {
    setContact(c);
    const open = opportunities.filter((o) => o.contactId === c.id && o.kind === wantKind && o.status === 'open');
    setOtherId(open.length === 1 ? open[0].id : '');
  };

  async function save() {
    if (!contact) return;
    setBusy(true);
    const err = await addManualMatch({ opportunityId: opportunity.id, contactId: contact.id, otherOpportunityId: otherId || undefined, note });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Dialog
      title={`Add a match to “${opportunity.title}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!contact || busy} onClick={save}>
            {busy ? 'Adding…' : 'Add match'}
          </button>
        </>
      }
    >
      {!contact ? (
        <>
          <p className="muted small">
            Who {opportunity.kind === 'listing' ? 'might buy this land' : 'has land that fits'}? Hand-added matches go to the top of the list, whatever the score says.
          </p>
          <input
            type="search"
            className="text-filter wide"
            placeholder="Search by name, company, phone or email"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <ul className="pick-list">
            {results.map((c) => {
              const already = taken.has(c.id);
              return (
                <li key={c.id}>
                  <button type="button" className="pick-row" disabled={already} onClick={() => pick(c)}>
                    <span>
                      <strong>{displayName(c)}</strong>
                      {companyLabel(c) && <span className="muted"> · {companyLabel(c)}</span>}
                      <span className="muted small pick-sub">{c.customerTypes.join(', ') || (c.isProspect ? 'Prospect' : 'Contact')}</span>
                    </span>
                    <span className="link-btn small">{already ? 'Already matched' : 'Choose'}</span>
                  </button>
                </li>
              );
            })}
            {text.trim().length >= 2 && !results.length && <li className="muted small">No one by that name.</li>}
          </ul>
        </>
      ) : (
        <div className="form-grid">
          <div className="field span-2">
            <span>Matching</span>
            <div className="static-field">
              <strong>{displayName(contact)}</strong>
              {companyLabel(contact) && <span className="muted"> · {companyLabel(contact)}</span>}{' '}
              <button type="button" className="link-btn small" onClick={() => setContact(null)}>
                Change
              </button>
            </div>
          </div>
          {theirs.length > 0 && (
            <label className="field span-2">
              <span>Their {wantKind}</span>
              <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                <option value="">Just them (no particular {wantKind})</option>
                {theirs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!theirs.length && (
            <p className="muted small span-2">
              {displayName(contact)} has no open {wantKind}. The match is still saved and shows here{wantKind === 'requirement' ? '; add a requirement on their page to match them everywhere.' : '.'}
            </p>
          )}
          <label className="field span-2">
            <span>Why (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Told me on the phone they'd go to 80 acres" maxLength={300} />
          </label>
          {error && <p className="field-error span-2">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
