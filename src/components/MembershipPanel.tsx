import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGES, useCampaigns, type Stage } from '../lib/campaigns';
import { formatDate } from '../lib/filters';
import { addMembers, removeMembers, updateMember, useContactMemberships, withContactDate } from '../lib/members';
import type { Contact } from '../types';

/** The matching campaigns a contact is on, their stage in each, and "Add to campaign…". */
export function MembershipPanel({ contact, disabled }: { contact: Contact; disabled?: boolean }) {
  const { items, reload } = useContactMemberships(contact.id);
  const { campaigns } = useCampaigns(contact.business);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');

  const on = new Set(items?.map((m) => m.campaignId));
  const open = (campaigns ?? []).filter((c) => c.kind === 'match' && c.matchStatus === 'active' && !on.has(c.id));

  const run = async (p: Promise<string>) => {
    const err = await p;
    setError(err);
    await reload();
  };

  return (
    <section className="panel" id="campaigns">
      <div className="panel-head">
        <h2>Campaigns</h2>
        {!disabled && open.length > 0 && (
          <form
            className="inline-actions"
            onSubmit={(e) => {
              e.preventDefault();
              if (adding) run(addMembers(adding, [{ contactId: contact.id, source: 'contact' }])).then(() => setAdding(''));
            }}
          >
            <select aria-label="Matching campaign" value={adding} onChange={(e) => setAdding(e.target.value)} className="small-select">
              <option value="">Add to campaign…</option>
              {open.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn small" disabled={!adding}>
              Add
            </button>
          </form>
        )}
      </div>
      {items === null ? (
        <p className="muted small">Loading…</p>
      ) : !items.length ? (
        <p className="muted small">Not on any matching campaign yet.</p>
      ) : (
        <ul className="membership-list">
          {items.map((m) => (
            <li key={m.id} className={m.campaignClosed ? 'closed' : ''}>
              <div>
                <Link to={`/campaigns/${m.campaignId}`}>{m.campaignName}</Link>
                {m.campaignClosed && <span className="tag">Closed</span>}
                <div className="muted small">
                  {m.lastContactedAt ? `Last contacted ${formatDate(m.lastContactedAt)}` : `Added ${formatDate(m.createdAt)}`}
                  {m.note && ` · ${m.note}`}
                </div>
              </div>
              <select
                aria-label={`Stage in ${m.campaignName}`}
                className={`stage-select st-${m.stage}`}
                value={m.stage}
                disabled={disabled || m.campaignClosed}
                onChange={(e) => run(updateMember(m.id, withContactDate(m, { stage: e.target.value as Stage })))}
              >
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {!disabled && !m.campaignClosed && (
                <button type="button" className="link-btn tl-delete small" onClick={() => run(removeMembers([m.id]))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
