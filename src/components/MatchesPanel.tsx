import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createMatchCampaign } from '../lib/campaigns';
import { companyLabel, displayName } from '../lib/filters';
import { KIND_LABEL, matchesForContact, nearbyFor, type MatchResult } from '../lib/matching';
import { useOpportunities } from '../lib/opportunities';
import { useContacts } from '../lib/store';
import type { Contact } from '../types';

const SHOW = 6;
const RADII = [5, 10, 25];

/**
 * "Matches & nearby": for each of this contact's open listings and requirements, the best matches
 * with reasons; plus what's around their land. Built for when you're on the phone with them.
 */
export function MatchesPanel({ contact }: { contact: Contact }) {
  const { contacts } = useContacts();
  const { opportunities } = useOpportunities();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [radius, setRadius] = useState(10);
  const [starting, setStarting] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // A matching campaign built on this listing or requirement, with its matches ready to add.
  const startCampaign = async (o: (typeof groups)[number]['opportunity']) => {
    setStarting(o.id);
    try {
      const who = displayName(contact);
      const name = o.kind === 'listing' ? `Buyers for ${o.title.replace(/^Listing:\s*/, '')}` : `Land for ${who}: ${o.title}`;
      navigate(`/campaigns/${await createMatchCampaign(contact.business, name, o.id)}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting('');
    }
  };

  const data = useMemo(() => ({ contacts, opportunities }), [contacts, opportunities]);
  const groups = useMemo(() => matchesForContact(contact, data), [contact, data]);
  const nearby = useMemo(() => nearbyFor(contact, data, radius), [contact, data, radius]);

  if (!groups.length && !contact.properties.length) return null;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (m: MatchResult) => <MatchRow key={`${m.kind}:${m.contact.id}:${m.opportunity?.id ?? m.property?.id ?? ''}`} m={m} />;

  return (
    <section className="panel" id="matches">
      <div className="panel-head">
        <h2>Matches &amp; nearby</h2>
      </div>

      {error && <p className="field-error">{error}</p>}
      {groups.length === 0 && (
        <p className="muted small">Add a listing or requirement above to see who matches. Meanwhile, here's what's near their land.</p>
      )}

      {groups.map(({ opportunity: o, results }) => {
        const open = expanded.has(o.id);
        const shown = open ? results : results.slice(0, SHOW);
        return (
          <div key={o.id} className="match-group">
            <div className="match-group-head">
              <h3>
                {o.kind === 'listing' ? 'Who might buy ' : 'Land for '}
                <span className="muted">“{o.title}”</span>
              </h3>
              <div className="inline-actions">
                {results.length > 0 && (
                  <Link className="link-btn small" to={`/map?match=${o.id}`}>
                    Show on map →
                  </Link>
                )}
                <button type="button" className="btn small" disabled={starting === o.id} onClick={() => startCampaign(o)} title="Work these matches as a campaign: stages, notes and calls">
                  Start a campaign
                </button>
              </div>
            </div>
            {o.needsDetail && <p className="muted small">This requirement is still a draft; matches will sharpen once acres, budget and area are added.</p>}
            {results.length === 0 ? (
              <p className="muted small">No matches yet. {o.kind === 'listing' ? 'No open buyer requirements fit this land.' : 'No listings or owners fit this requirement.'}</p>
            ) : (
              <>
                <ul className="match-list">{shown.map(row)}</ul>
                {results.length > SHOW && (
                  <button type="button" className="link-btn small" onClick={() => toggle(o.id)}>
                    {open ? 'Show fewer' : `Show all ${results.length}`}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {contact.properties.length > 0 && (
        <div className="match-group">
          <div className="match-group-head">
            <h3>Near their land</h3>
            <div className="seg small" role="group" aria-label="Distance">
              {RADII.map((r) => (
                <button key={r} type="button" aria-pressed={radius === r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)}>
                  {r} km
                </button>
              ))}
            </div>
          </div>
          {nearby.length === 0 ? (
            <p className="muted small">No open listings, buyers looking here, or builders/investors within {radius} km.</p>
          ) : (
            <ul className="match-list">
              {nearby.slice(0, 12).map((n) => (
                <li key={`${n.contact.id}:${n.opportunity?.id ?? n.property?.id}`} className="match-row">
                  <span className="dist">{n.distanceKm < 0.1 ? 'here' : `${n.distanceKm.toFixed(n.distanceKm < 10 ? 1 : 0)} km`}</span>
                  <div className="match-main">
                    <div>
                      <Link to={`/contacts/${n.contact.id}`}>{displayName(n.contact)}</Link>
                      {companyLabel(n.contact) && <span className="muted small"> · {companyLabel(n.contact)}</span>}
                    </div>
                    <div className="muted small">{n.label}</div>
                  </div>
                  {n.contact.phone && (
                    <a className="btn small" href={`tel:${n.contact.phone.replace(/\D/g, '')}`}>
                      Call
                    </a>
                  )}
                </li>
              ))}
              {nearby.length > 12 && <li className="muted small">…and {nearby.length - 12} more</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** One match: score, who, what kind, the reasons, and a call button. Used by the panel and the Map. */
export function MatchRow({ m, onShow }: { m: MatchResult; onShow?: () => void }) {
  return (
    <li className="match-row">
      <span className={`score s${Math.min(9, Math.floor(m.score / 10))}`} title={`Match score ${m.score} of 100`}>
        {m.score}
      </span>
      <div className="match-main">
        <div>
          <Link to={`/contacts/${m.contact.id}`}>{displayName(m.contact)}</Link>
          {companyLabel(m.contact) && <span className="muted small"> · {companyLabel(m.contact)}</span>}
          <span className="tag match-kind">{KIND_LABEL[m.kind]}</span>
        </div>
        <div className="reasons">
          {m.reasons.map((r, i) => (
            <span key={i} className={`reason r-${r.tone}`}>
              {r.text}
            </span>
          ))}
        </div>
      </div>
      {onShow && m.property && (
        <button type="button" className="btn small" onClick={onShow}>
          Show
        </button>
      )}
      {m.contact.phone && (
        <a className="btn small" href={`tel:${m.contact.phone.replace(/\D/g, '')}`} title={`Call ${m.contact.phone}`}>
          Call
        </a>
      )}
    </li>
  
  );
}
