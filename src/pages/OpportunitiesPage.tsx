import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AddMatchDialog } from '../components/AddMatchDialog';
import { ContactForm } from '../components/ContactForm';
import { Dialog } from '../components/Dialog';
import { MultiSelect } from '../components/MultiSelect';
import { opportunityFacts } from '../components/OpportunitiesPanel';
import { OpportunityEditor } from '../components/OpportunityEditor';
import { PropertyEditor } from '../components/PropertyEditor';
import { createMatchCampaign } from '../lib/campaigns';
import { companyLabel, displayName, formatDate } from '../lib/filters';
import { matchListing, matchRequirement } from '../lib/matching';
import { LISTING_STATUSES, REQUIREMENT_STATUSES, statusLabel, useOpportunities, type Opportunity, type OpportunityKind } from '../lib/opportunities';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import { CATEGORIES, REGIONS, type Contact } from '../types';

type KindFilter = '' | OpportunityKind;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STATUS_OPTIONS = [...new Set([...LISTING_STATUSES, ...REQUIREMENT_STATUSES].map((s) => s.id))];
const PAGE = 50;

/** Every listing and buyer requirement in one place, with their best match and a way to add new ones. */
export default function OpportunitiesPage() {
  const { business } = useSession();
  const { contacts, loading: contactsLoading } = useContacts();
  const { opportunities, manualMatches, loading } = useOpportunities();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const kind = (params.get('kind') ?? '') as KindFilter;
  const text = params.get('q') ?? '';
  const statuses = params.get('status') === 'any' ? [] : (params.get('status')?.split(',').filter(Boolean) ?? ['open']);
  const [categories, setCategories] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [listingType, setListingType] = useState<'' | 'listed' | 'off_market'>('');
  const [needsDetail, setNeedsDetail] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [creating, setCreating] = useState<OpportunityKind | null>(null);
  const [editing, setEditing] = useState<{ o: Opportunity; contact: Contact } | null>(null);
  const [starting, setStarting] = useState('');
  const [addingTo, setAddingTo] = useState<Opportunity | null>(null);
  const [error, setError] = useState('');

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShown(PAGE);
  };

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const data = useMemo(() => ({ contacts, opportunities, manual: manualMatches }), [contacts, opportunities, manualMatches]);

  // Everything in this business, before the filters, for the counts.
  const inBusiness = useMemo(
    () => opportunities.filter((o) => byId.get(o.contactId)?.business === business),
    [opportunities, byId, business],
  );

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return inBusiness
      .filter((o) => !kind || o.kind === kind)
      .filter((o) => !statuses.length || statuses.includes(o.status))
      .filter((o) => !categories.length || o.categories.some((c) => categories.includes(c)))
      .filter((o) => {
        if (!regions.length) return true;
        const owner = byId.get(o.contactId);
        return [...o.regions, ...(owner?.regions ?? [])].some((r) => regions.includes(r));
      })
      .filter((o) => !listingType || (o.kind === 'listing' && o.listingType === listingType))
      .filter((o) => !needsDetail || o.needsDetail)
      .filter((o) => {
        if (!q) return true;
        const owner = byId.get(o.contactId);
        const property = owner?.properties.find((p) => p.id === o.propertyId);
        return [o.title, o.notes, o.areaLabel, owner ? displayName(owner) : '', owner?.company ?? '', property?.address ?? ''].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'listing' ? -1 : 1) || Number(a.needsDetail) - Number(b.needsDetail) || b.updatedAt.localeCompare(a.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBusiness, kind, text, params.get('status'), categories, regions, listingType, needsDetail, byId]);

  // Match counts and the best match, only for the rows on screen (matching every draft is wasted work).
  const visible = rows.slice(0, shown);
  const matchInfo = useMemo(() => {
    const out = new Map<string, { count: number; byHand: number; best?: { name: string; score: number } }>();
    for (const o of visible) {
      const owner = byId.get(o.contactId);
      if (!owner || o.status !== 'open') continue;
      const subject = { opportunity: o, contact: owner, property: owner.properties.find((p) => p.id === o.propertyId) };
      const r = o.kind === 'listing' ? matchListing(subject, data) : matchRequirement(subject, data);
      const top = r.find((x) => !x.manual || x.manual.scored) ?? r[0];
      out.set(o.id, { count: r.length, byHand: r.filter((x) => x.manual).length, best: top && { name: displayName(top.contact), score: top.manual && !top.manual.scored ? -1 : top.score } });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((o) => o.id + o.updatedAt).join(), data, byId]);

  const counts = {
    listings: inBusiness.filter((o) => o.kind === 'listing' && o.status === 'open').length,
    requirements: inBusiness.filter((o) => o.kind === 'requirement' && o.status === 'open').length,
    drafts: inBusiness.filter((o) => o.needsDetail && o.status === 'open').length,
  };
  const filtersOn = !!(categories.length || regions.length || listingType || needsDetail || text || kind || params.get('status'));

  async function startCampaign(o: Opportunity, owner: Contact) {
    setStarting(o.id);
    try {
      const name = o.kind === 'listing' ? `Buyers for ${o.title.replace(/^Listing:\s*/, '')}` : `Land for ${displayName(owner)}: ${o.title}`;
      navigate(`/campaigns/${await createMatchCampaign(business, name, o.id)}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting('');
    }
  }

  return (
    <div className="list-page opportunities-page">
      <header className="page-head">
        <div>
          <h1>Opportunities</h1>
          <span className="muted">
            {plural(counts.listings, 'open listing')} · {plural(counts.requirements, 'open requirement')}
            {counts.drafts > 0 && (
              <>
                {' · '}
                <button type="button" className="link-btn small inline" onClick={() => { setNeedsDetail(true); setShown(PAGE); }}>
                  {counts.drafts} need detail
                </button>
              </>
            )}
            {' · '}
            {business}
          </span>
        </div>
        <div className="inline-actions">
          <button type="button" className="btn primary" onClick={() => setCreating('listing')}>
            + Listing
          </button>
          <button type="button" className="btn" onClick={() => setCreating('requirement')}>
            + Requirement
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {([
          ['', 'All'],
          ['listing', 'Listings'],
          ['requirement', 'Requirements'],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setParam('kind', k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="list-tools">
        <input className="text-filter" type="search" placeholder="Title, owner, address or area" value={text} onChange={(e) => setParam('q', e.target.value)} aria-label="Search opportunities" />
        <div className="list-filters">
          <MultiSelect
            label="Status"
            options={STATUS_OPTIONS}
            value={statuses}
            format={statusLabel}
            onChange={(v) => setParam('status', v.length ? (v.length === 1 && v[0] === 'open' ? '' : v.join(',')) : 'any')}
          />
          <MultiSelect label="Category" options={CATEGORIES} value={categories as (typeof CATEGORIES)[number][]} onChange={(v) => { setCategories(v); setShown(PAGE); }} />
          <MultiSelect label="Region" options={REGIONS} value={regions as (typeof REGIONS)[number][]} onChange={(v) => { setRegions(v); setShown(PAGE); }} />
          {kind !== 'requirement' && (
            <select className="chip-select" aria-label="Listing type" value={listingType} onChange={(e) => { setListingType(e.target.value as typeof listingType); setShown(PAGE); }}>
              <option value="">Listed or off-market</option>
              <option value="listed">Listed</option>
              <option value="off_market">Off-market</option>
            </select>
          )}
          <button type="button" className={`chip-btn ${needsDetail ? 'active' : ''}`} aria-pressed={needsDetail} onClick={() => { setNeedsDetail((x) => !x); setShown(PAGE); }}>
            Needs detail
          </button>
          {filtersOn && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setCategories([]);
                setRegions([]);
                setListingType('');
                setNeedsDetail(false);
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && <p className="notice warn">{error}</p>}

      {loading || contactsLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty">
          <strong>{inBusiness.length ? 'No opportunities match these filters.' : `No opportunities in ${business} yet.`}</strong>
          <span>Add a listing for land being shopped, or a requirement for what a buyer wants.</span>
        </div>
      ) : (
        <>
          <p className="muted small result-count">
            {rows.length} {rows.length === 1 ? 'opportunity' : 'opportunities'}
          </p>
          <ul className="opp-list opp-board">
            {visible.map((o) => {
              const owner = byId.get(o.contactId);
              const m = matchInfo.get(o.id);
              return (
                <li key={o.id} className={`opp-card ${o.status !== 'open' ? 'closed' : ''}`}>
                  <div className="opp-head">
                    <span className={`tag kind-${o.kind}`}>{o.kind === 'listing' ? 'Listing' : 'Requirement'}</span>
                    <strong className="opp-title">{o.title || (o.kind === 'listing' ? 'Listing' : 'Requirement')}</strong>
                    <span className={`tag opp-${o.status}`}>{statusLabel(o.status)}</span>
                    {o.needsDetail && <span className="tag needs-detail">Needs detail</span>}
                  </div>
                  <div className="small">
                    {owner ? (
                      <>
                        <Link to={`/contacts/${owner.id}#opportunities`}>{displayName(owner)}</Link>
                        {companyLabel(owner) && <span className="muted"> · {companyLabel(owner)}</span>}
                        {owner.phone && (
                          <>
                            {' · '}
                            <a href={`tel:${owner.phone.replace(/\D/g, '')}`}>{owner.phone}</a>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="muted">Contact archived or not loaded</span>
                    )}
                  </div>
                  <div className="muted small opp-facts">{opportunityFacts(o, owner).join(' · ') || 'No details yet'}</div>
                  <div className="opp-foot">
                    <span className="small">
                      {o.status !== 'open' ? (
                        <span className="muted">Not matched while {statusLabel(o.status).toLowerCase()}</span>
                      ) : m && m.count > 0 ? (
                        <>
                          <strong>{m.count}</strong> {m.count === 1 ? 'match' : 'matches'}
                          {m.byHand > 0 && <span className="muted"> ({m.byHand} by hand)</span>}
                          {m.best && m.best.score >= 0 && (
                            <span className="muted">
                              {' '}
                              · best: {m.best.name} ({m.best.score})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">No matches yet</span>
                      )}
                    </span>
                    <span className="muted small">Updated {formatDate(o.updatedAt)}</span>
                  </div>
                  <div className="inline-actions">
                    {owner && (
                      <button type="button" className="btn small" onClick={() => setEditing({ o, contact: owner })}>
                        {o.needsDetail ? 'Add details' : 'Edit'}
                      </button>
                    )}
                    {m && m.count > 0 && (
                      <Link className="btn small" to={`/map?match=${o.id}`}>
                        Show matches on map
                      </Link>
                    )}
                    {owner && o.status === 'open' && (
                      <button type="button" className="btn small" onClick={() => setAddingTo(o)}>
                        + Add a match
                      </button>
                    )}
                    {owner && o.status === 'open' && (
                      <button type="button" className="link-btn small" disabled={starting === o.id} onClick={() => startCampaign(o, owner)}>
                        Start a campaign
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.length > shown && (
            <button type="button" className="btn small load-more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
            </button>
          )}
        </>
      )}

      {creating && <NewOpportunity kind={creating} onClose={() => setCreating(null)} />}
      {addingTo && <AddMatchDialog opportunity={addingTo} onClose={() => setAddingTo(null)} />}
      {editing && <OpportunityEditor contact={editing.contact} kind={editing.o.kind} opportunity={editing.o} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Pick who the listing or requirement belongs to, then fill it in with the usual editor. */
function NewOpportunity({ kind, onClose }: { kind: OpportunityKind; onClose: () => void }) {
  const { business } = useSession();
  const { contacts, addProperty } = useContacts();
  const [text, setText] = useState('');
  // pick someone → (new contact) → (their property, for a listing) → the listing or requirement itself
  const [step, setStep] = useState<'pick' | 'newContact' | 'property' | 'editor'>('pick');
  const [contactId, setContactId] = useState('');
  // Read from the store so a property added a moment ago is there.
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const choose = (c: Contact) => {
    setContactId(c.id);
    setStep(kind === 'listing' && !c.properties.length ? 'property' : 'editor');
  };
  const who = kind === 'listing' ? 'owner' : 'buyer';

  const results = useMemo(() => {
    const q = text.trim().toLowerCase();
    const pool = contacts.filter((c) => c.business === business && !c.archivedAt);
    const hits = q
      ? pool.filter((c) => `${displayName(c)} ${c.company} ${c.phone} ${c.properties.map((p) => p.address).join(' ')}`.toLowerCase().includes(q))
      : // With nothing typed, suggest the people this is most likely for.
        pool.filter((c) => (kind === 'listing' ? c.customerTypes.includes('Seller') && c.properties.length : c.customerTypes.some((t) => t === 'Buyer' || t === 'Builder/Developer' || t === 'Investor')));
    return hits.slice(0, 12);
  }, [text, contacts, business, kind]);

  if (step === 'editor' && contact) return <OpportunityEditor contact={contact} kind={kind} onClose={onClose} />;

  if (step === 'newContact') {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return (
      <ContactForm
        initial={{
          isProspect: true,
          firstName: words[0] ?? '',
          lastName: words.slice(1).join(' '),
          customerTypes: [kind === 'listing' ? 'Seller' : 'Buyer'],
        }}
        onSaved={(c) => {
          setContactId(c.id);
          setStep(kind === 'listing' ? 'property' : 'editor');
        }}
        // The form closes itself after saving; only go back to the picker if it was cancelled.
        onClose={() => setStep((s) => (s === 'newContact' ? 'pick' : s))}
      />
    );
  }

  if (step === 'property' && contact) {
    return (
      <>
        <PropertyEditor
          onSave={async (input) => {
            await addProperty(contact.id, input);
            setStep('editor');
          }}
          onClose={() => setStep((s) => (s === 'property' ? 'pick' : s))}
        />
        <p className="sr-only" role="status">
          Add the land {displayName(contact)} is selling, then fill in the listing.
        </p>
      </>
    );
  }

  return (
    <Dialog title={kind === 'listing' ? 'New listing: whose land?' : 'New requirement: who is buying?'} onClose={onClose}>
      <p className="muted small">
        {kind === 'listing'
          ? 'Pick the owner, or add a new one. A listing is one of their properties; if they have none yet, you’ll add it next.'
          : 'Pick the buyer, builder/developer or investor who wants land, or add a new one.'}
      </p>
      <input type="search" className="text-filter wide" placeholder="Search by name, company, phone or address" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      {!text.trim() && results.length > 0 && <p className="muted small">{kind === 'listing' ? 'Sellers with property:' : 'Buyers, builders and investors:'}</p>}
      <ul className="pick-list">
        {results.map((c) => {
          const blocked = kind === 'listing' && !c.properties.length;
          return (
            <li key={c.id}>
              {/* An owner with no property can't have a listing yet: show the way to add one instead of a button. */}
              {blocked ? (
                <button type="button" className="pick-row" onClick={() => choose(c)}>
                  <PickLabel c={c} />
                  <span className="link-btn small">Add their property</span>
                </button>
              ) : (
                <button type="button" className="pick-row" onClick={() => choose(c)}>
                  <PickLabel c={c} />
                  <span className="link-btn small">Choose</span>
                </button>
              )}
            </li>
          );
        })}
        {text.trim() && !results.length && <li className="muted small">No one by that name in Hub yet.</li>}
      </ul>
      <button type="button" className="btn small new-person" onClick={() => setStep('newContact')}>
        + New {who}
        {text.trim() && !results.length ? `: ${text.trim()}` : ''}
      </button>
    </Dialog>
  );
}

function PickLabel({ c }: { c: Contact }) {
  return (
    <span>
      <strong>{displayName(c)}</strong>
      {companyLabel(c) && <span className="muted"> · {companyLabel(c)}</span>}
      <span className="muted small pick-sub">
        {[c.customerTypes.join(', '), c.properties.length ? `${c.properties.length} ${c.properties.length === 1 ? 'property' : 'properties'}` : 'No properties']
          .filter(Boolean)
          .join(' · ')}
      </span>
    </span>
  );
}
