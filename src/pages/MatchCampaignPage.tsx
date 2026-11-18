import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CampaignMap, STAGE_COLOR, SUGGESTION_COLOR, type CampaignPin } from '../components/CampaignMap';
import { Confirm } from '../components/Dialog';
import { MultiSelect } from '../components/MultiSelect';
import { PlaceSearch } from '../components/PlaceSearch';
import { ScheduleDialog } from '../components/ScheduleDialog';
import {
  createMemberBlast,
  deleteCampaign,
  STAGES,
  stageLabel,
  updateMatchCampaign,
  type Area,
  type Campaign,
  type CampaignStats,
  type Criteria,
  type Stage,
} from '../lib/campaigns';
import { companyLabel, displayName, formatDate } from '../lib/filters';
import { haversineKm } from '../lib/geo';
import { campaignCandidates, KIND_LABEL, type MatchResult, type Reason } from '../lib/matching';
import { useMembers, type Member } from '../lib/members';
import { useOpportunities } from '../lib/opportunities';
import { reverseGeocode } from '../lib/services';
import { useSession } from '../lib/session';
import { downloadCsv, useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import { CATEGORIES, CUSTOMER_TYPES, REGIONS, STATUSES, type Contact, type LatLng, type Property } from '../types';
import { STATUS_LABEL } from './CampaignsPage';

type Tab = 'list' | 'find';
const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i])) as Record<Stage, number>;
const SUGGEST_PAGE = 25;

/** A matching campaign: an opportunity (or just an area and filters), the people found for it, and the work on each. */
export function MatchCampaign({ campaign, reload }: { campaign: Campaign; reload: () => void }) {
  const navigate = useNavigate();
  const { profile, people } = useSession();
  const { contacts, loading } = useContacts();
  const { opportunities } = useOpportunities();
  const { members, error, setError, add, update, remove } = useMembers(campaign.id);

  const [name, setName] = useState(campaign.name);
  const [criteria, setCriteria] = useState<Criteria>(campaign.criteria);
  const [tab, setTab] = useState<Tab>('list');
  // A campaign with no one on it yet opens on Find matches.
  const tabChosen = useRef(false);
  const [stageFilter, setStageFilter] = useState<Stage | ''>('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showCount, setShowCount] = useState(SUGGEST_PAGE);
  const [pinned, setPinned] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Contact | null>(null);
  const [confirm, setConfirm] = useState<'delete' | null>(null);
  const [busy, setBusy] = useState('');
  const [blasts, setBlasts] = useState<(Campaign & { stats?: CampaignStats })[]>([]);
  const [meetings, setMeetings] = useState<number | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (members && !tabChosen.current) {
      tabChosen.current = true;
      if (!members.length) setTab('find');
    }
  }, [members]);

  const closed = campaign.matchStatus === 'closed';
  const canDelete = campaign.createdBy === profile.id || profile.role === 'admin';

  // ---- The subject: the listing's land or the buyer's search area ----
  const opportunity = opportunities.find((o) => o.id === campaign.opportunityId);
  const owner = opportunity && contacts.find((c) => c.id === opportunity.contactId);
  const property = owner?.properties.find((p) => p.id === opportunity?.propertyId);
  const subjectPoint: (LatLng & { label: string; radiusKm?: number }) | undefined =
    opportunity?.kind === 'listing' && property
      ? { lat: property.lat, lng: property.lng, label: `${owner ? displayName(owner) : ''}: ${property.address}` }
      : opportunity?.kind === 'requirement' && opportunity.areaLat != null && opportunity.areaLng != null
        ? { lat: opportunity.areaLat, lng: opportunity.areaLng, radiusKm: opportunity.areaRadiusKm ?? 25, label: `${owner ? displayName(owner) : ''} is looking here` }
        : undefined;

  // ---- Save the criteria a moment after they stop changing ----
  const firstCriteria = useRef(true);
  useEffect(() => {
    if (firstCriteria.current) {
      firstCriteria.current = false;
      return;
    }
    const t = setTimeout(() => updateMatchCampaign(campaign.id, { criteria }).then((e) => e && setError(e)), 600);
    return () => clearTimeout(t);
  }, [criteria, campaign.id, setError]);

  // ---- Candidates and members ----
  const data = useMemo(() => ({ contacts, opportunities }), [contacts, opportunities]);
  const candidates = useMemo(
    () => campaignCandidates(campaign.business, criteria, opportunity && owner ? { opportunity, contact: owner, property } : null, data),
    [campaign.business, criteria, opportunity, owner, property, data],
  );
  const byContact = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const memberOf = useMemo(() => new Map((members ?? []).map((m) => [m.contactId, m])), [members]);
  const suggestions = useMemo(() => candidates.filter((c) => !memberOf.has(c.contact.id)), [candidates, memberOf]);
  const candidateOf = useMemo(() => new Map(candidates.map((c) => [c.contact.id, c])), [candidates]);

  const counts = useMemo(() => {
    const m: Partial<Record<Stage, number>> = {};
    for (const x of members ?? []) m[x.stage] = (m[x.stage] ?? 0) + 1;
    return m;
  }, [members]);

  const listed = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => !stageFilter || m.stage === stageFilter)
      .filter((m) => {
        if (!q) return true;
        const c = byContact.get(m.contactId);
        return !!c && `${displayName(c)} ${c.company} ${c.phone}`.toLowerCase().includes(q);
      })
      .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || (b.score ?? -1) - (a.score ?? -1));
  }, [members, stageFilter, text, byContact]);

  // ---- Results: meetings booked with members since they joined, and email blasts ----
  const memberKey = members ? `:${members.map((m) => m.contactId).join(',')}` : '';
  useEffect(() => {
    if (!members) return;
    if (!members.length) return setMeetings(0);
    const since = new Map(members.map((m) => [m.contactId, m.createdAt]));
    supabase
      .from('meetings')
      .select('contact_id, created_at')
      .in('contact_id', [...since.keys()].slice(0, 500))
      .eq('status', 'scheduled')
      .gte('created_at', campaign.createdAt)
      .then(({ data }) => setMeetings((data ?? []).filter((r) => r.created_at >= (since.get(r.contact_id) ?? '')).length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, campaign.createdAt]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('campaigns').select('id, name, status, finished_at, started_at, updated_at').eq('parent_id', campaign.id).order('created_at');
      if (!data?.length) return;
      const { data: stats } = await supabase.from('campaign_stats').select('*').in('campaign_id', data.map((d) => d.id));
      setBlasts(
        data.map((d) => ({ ...(d as unknown as Campaign), finishedAt: d.finished_at, startedAt: d.started_at, stats: stats?.find((s) => s.campaign_id === d.id) as CampaignStats | undefined })),
      );
    })();
  }, [campaign.id]);

  // ---- Map pins ----
  const pinPoint = (c: Contact, preferred?: Property): Property | undefined => {
    if (preferred) return preferred;
    if (!c.properties.length) return undefined;
    const centre = criteria.area ?? subjectPoint;
    if (!centre) return c.properties[0];
    return [...c.properties].sort((a, b) => haversineKm(a, centre) - haversineKm(b, centre))[0];
  };
  const pins: CampaignPin[] = useMemo(() => {
    const out: CampaignPin[] = [];
    for (const m of members ?? []) {
      const c = byContact.get(m.contactId);
      const p = c && pinPoint(c, candidateOf.get(c.id)?.property);
      if (c && p) out.push({ key: `m:${m.id}`, contactId: c.id, lat: p.lat, lng: p.lng, label: `${displayName(c)} · ${stageLabel(m.stage)}`, color: STAGE_COLOR[m.stage], member: true, selected: pinned === c.id });
    }
    if (tab === 'find') {
      for (const s of suggestions.slice(0, 300)) {
        const p = pinPoint(s.contact, s.property);
        if (p) out.push({ key: `s:${s.contact.id}`, contactId: s.contact.id, lat: p.lat, lng: p.lng, label: `${displayName(s.contact)} · score ${s.score}`, color: SUGGESTION_COLOR, member: false, selected: pinned === s.contact.id });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, suggestions, tab, pinned, byContact, candidateOf, criteria.area, subjectPoint?.lat]);

  // ---- Actions ----
  const addResults = async (rs: MatchResult[], source: 'match' | 'map') => {
    setBusy('add');
    await add(rs.map((r) => ({ contactId: r.contact.id, score: r.score, reasons: r.reasons, source })));
    setPicked(new Set());
    setBusy('');
  };
  const addContact = async (c: Contact) => {
    const r = candidateOf.get(c.id);
    await add([{ contactId: c.id, score: r?.score, reasons: r?.reasons, source: 'manual' }]);
    setText('');
  };
  const setArea = (a: Area | undefined) => setCriteria((x) => ({ ...x, area: a }));
  const pickPoint = (p: LatLng) => {
    const radiusKm = criteria.area?.radiusKm ?? 10;
    setArea({ ...p, radiusKm, label: '' });
    reverseGeocode(p, undefined, 10)
      .then((town) => setCriteria((x) => (x.area && x.area.lat === p.lat && x.area.lng === p.lng ? { ...x, area: { ...x.area, label: /^-?\d/.test(town) ? '' : town.split(', ')[0] } } : x)))
      .catch(() => {});
  };
  const onPin = (pin: CampaignPin) => {
    setPinned(pin.contactId);
    if (pin.member) {
      setTab('list');
      setStageFilter('');
      setText('');
      setTimeout(() => rowRefs.current.get(pin.contactId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };
  const exportList = () =>
    downloadCsv(
      [
        ['Name', 'Company', 'Phone', 'Email', 'Stage', 'Score', 'Why', 'Note', 'Last contacted', 'Property'],
        ...listed.map((m) => {
          const c = byContact.get(m.contactId);
          return [
            c ? displayName(c) : m.contactId,
            c ? companyLabel(c) : '',
            c?.phone ?? '',
            c?.email ?? '',
            stageLabel(m.stage),
            m.score != null ? String(m.score) : '',
            m.reasons.map((r) => r.text).join('; '),
            m.note,
            m.lastContactedAt ? formatDate(m.lastContactedAt) : '',
            c?.properties.map((p) => p.address).join('; ') ?? '',
          ];
        }),
      ],
      `${campaign.name.replace(/[^\w -]+/g, '').trim() || 'campaign'}-${new Date().toLocaleDateString('en-CA')}.csv`,
    );
  const emailMembers = async () => {
    setBusy('email');
    try {
      navigate(`/campaigns/${await createMemberBlast(campaign, profile.id)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };

  const pinnedSuggestion = pinned && !memberOf.has(pinned) ? candidateOf.get(pinned) : undefined;
  const textMatches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts
      .filter((c) => c.business === campaign.business && !c.archivedAt && !memberOf.has(c.id) && `${displayName(c)} ${c.company} ${c.phone}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [text, contacts, campaign.business, memberOf]);

  return (
    <div className="detail-page match-campaign">
      <Link to="/campaigns" className="back-link">
        ← Campaigns
      </Link>
      <header className="detail-head">
        <div className="camp-title">
          <input
            className="title-input"
            aria-label="Campaign name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== campaign.name && updateMatchCampaign(campaign.id, { name }).then((e) => (e ? setError(e) : reload()))}
          />
          <div className="muted small">
            {opportunity && owner ? (
              <>
                {opportunity.kind === 'listing' ? 'Finding buyers for ' : 'Finding land for '}
                <Link to={`/contacts/${owner.id}#opportunities`}>
                  {displayName(owner)}: {opportunity.title}
                </Link>
              </>
            ) : campaign.opportunityId ? (
              'Its listing or requirement was deleted; the list still works.'
            ) : (
              'An area and filters search'
            )}
            {' · '}
            {campaign.business}
          </div>
        </div>
        <div className="inline-actions">
          <div className="seg small" role="group" aria-label="Campaign status">
            {(['active', 'closed'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={campaign.matchStatus === s}
                className={campaign.matchStatus === s ? 'on' : ''}
                onClick={() => campaign.matchStatus !== s && updateMatchCampaign(campaign.id, { matchStatus: s }).then((e) => (e ? setError(e) : reload()))}
              >
                {s === 'active' ? 'Active' : 'Closed'}
              </button>
            ))}
          </div>
          <button type="button" className="btn small" onClick={emailMembers} disabled={!members?.length || busy === 'email'} title="A marketing email to the members with consent">
            Email members
          </button>
          <button type="button" className="btn small" onClick={exportList} disabled={!listed.length}>
            Export
          </button>
          {canDelete && (
            <button type="button" className="link-btn tl-delete" onClick={() => setConfirm('delete')}>
              Delete
            </button>
          )}
        </div>
      </header>
      {error && <p className="notice warn">{error}</p>}
      {closed && <p className="notice">This campaign is closed. The list is kept for reference; reopen it with Active.</p>}

      {/* Pipeline: members by stage, click to filter */}
      <div className="pipeline" role="group" aria-label="Members by stage">
        <button type="button" className={`pipe ${stageFilter === '' ? 'on' : ''}`} onClick={() => { setStageFilter(''); setTab('list'); }}>
          <strong>{members?.length ?? '…'}</strong>
          <span>On the list</span>
        </button>
        {STAGES.filter((s) => s.id !== 'suggested' || counts.suggested).map((s) => (
          <button key={s.id} type="button" className={`pipe st-${s.id} ${stageFilter === s.id ? 'on' : ''}`} onClick={() => { setStageFilter(stageFilter === s.id ? '' : s.id); setTab('list'); }}>
            <strong>{counts[s.id] ?? 0}</strong>
            <span>{s.label}</span>
          </button>
        ))}
        <div className="pipe static">
          <strong>{meetings ?? '…'}</strong>
          <span>Meetings booked</span>
        </div>
      </div>

      <div className="campaign-work">
        <section className="campaign-map-wrap">
          <CampaignMap pins={pins} area={criteria.area} subject={subjectPoint} onPinClick={onPin} onMapClick={tab === 'find' && !closed ? pickPoint : undefined} />
          <div className="map-legend small">
            {tab === 'find' && (
              <span>
                <i style={{ borderColor: SUGGESTION_COLOR }} className="hollow" /> Suggested
              </span>
            )}
            {STAGES.filter((s) => s.id !== 'suggested').map((s) => (
              <span key={s.id}>
                <i style={{ background: STAGE_COLOR[s.id] }} /> {s.label}
              </span>
            ))}
            {tab === 'find' && !closed && <span className="muted">Click the map to search around a spot</span>}
          </div>
          {pinnedSuggestion && (
            <div className="pin-card">
              <MatchLine r={pinnedSuggestion} />
              <div className="inline-actions">
                <button type="button" className="btn small primary" disabled={closed} onClick={() => addResults([pinnedSuggestion], 'map').then(() => setPinned(null))}>
                  Add to list
                </button>
                <button type="button" className="link-btn small" onClick={() => setPinned(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel campaign-side">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>
              List ({members?.length ?? 0})
            </button>
            <button type="button" role="tab" aria-selected={tab === 'find'} className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>
              Find matches ({suggestions.length})
            </button>
          </div>

          {tab === 'list' ? (
            <>
              <div className="add-search">
                <input type="search" placeholder="Search the list, or add anyone by name…" value={text} onChange={(e) => setText(e.target.value)} />
                {textMatches.length > 0 && !closed && (
                  <ul className="add-results">
                    {textMatches.map((c) => (
                      <li key={c.id}>
                        <span>
                          {displayName(c)}
                          {companyLabel(c) && <span className="muted small"> · {companyLabel(c)}</span>}
                        </span>
                        <button type="button" className="btn small" onClick={() => addContact(c)}>
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {members === null || loading ? (
                <p className="muted">Loading…</p>
              ) : !members.length ? (
                <div className="empty">
                  <strong>No one on the list yet.</strong>
                  <span>
                    Open <button type="button" className="link-btn" onClick={() => setTab('find')}>Find matches</button> to add the best fits, or search for anyone above.
                  </span>
                </div>
              ) : (
                <ul className="member-list">
                  {listed.map((m) => {
                    const c = byContact.get(m.contactId);
                    if (!c) return null;
                    return (
                      <MemberRow
                        key={m.id}
                        rowRef={(el) => {
                          if (el) rowRefs.current.set(c.id, el);
                          else rowRefs.current.delete(c.id);
                        }}
                        m={m}
                        c={c}
                        highlighted={pinned === c.id}
                        disabled={closed}
                        people={people}
                        onUpdate={(patch) => update(m, patch)}
                        onRemove={() => remove([m.id])}
                        onSchedule={() => setScheduling(c)}
                      />
                    );
                  })}
                  {!listed.length && <li className="muted small">No one in this stage.</li>}
                </ul>
              )}
              {blasts.length > 0 && (
                <div className="blasts">
                  <h3>Emails to this list</h3>
                  <ul>
                    {blasts.map((b) => (
                      <li key={b.id}>
                        <Link to={`/campaigns/${b.id}`}>{b.name}</Link> <span className={`tag camp-status cs-${b.status}`}>{STATUS_LABEL[b.status]}</span>
                        {b.stats && (
                          <span className="muted small">
                            {' '}
                            · {b.stats.sent} sent · {b.stats.opened} opened · {b.stats.clicked} clicked
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="criteria">
                <div className="area-row">
                  <PlaceSearch
                    placeholder={opportunity ? 'Also search around a place (optional)' : 'Search around a town or address'}
                    value={criteria.area ? { lat: criteria.area.lat, lng: criteria.area.lng, label: criteria.area.label } : null}
                    onSelect={(p) => setArea(p ? { lat: p.lat, lng: p.lng, label: p.label.split(', ')[0], radiusKm: criteria.area?.radiusKm ?? 10 } : undefined)}
                  />
                  {criteria.area && (
                    <label className="radius">
                      <span>
                        Within <strong>{criteria.area.radiusKm} km</strong>
                        {criteria.area.label && ` of ${criteria.area.label}`}
                      </span>
                      <input type="range" min={1} max={60} value={criteria.area.radiusKm} onChange={(e) => setArea({ ...criteria.area!, radiusKm: Number(e.target.value) })} />
                      <button type="button" className="link-btn small" onClick={() => setArea(undefined)}>
                        Clear area
                      </button>
                    </label>
                  )}
                </div>
                <div className="list-filters">
                  <MultiSelect label="Customer type" options={CUSTOMER_TYPES} value={criteria.customerTypes} onChange={(v) => setCriteria((x) => ({ ...x, customerTypes: v }))} />
                  <MultiSelect label="Category" options={CATEGORIES} value={criteria.categories} onChange={(v) => setCriteria((x) => ({ ...x, categories: v }))} />
                  <MultiSelect label="Region" options={REGIONS} value={criteria.regions} onChange={(v) => setCriteria((x) => ({ ...x, regions: v }))} />
                  <MultiSelect label="Status" options={STATUSES} value={criteria.statuses} onChange={(v) => setCriteria((x) => ({ ...x, statuses: v }))} />
                </div>
              </div>

              {!opportunity && !criteria.area ? (
                <p className="muted small">Pick a place (or click the map) to find land owners there and buyers looking there. The filters narrow the results.</p>
              ) : suggestions.length === 0 ? (
                <p className="muted small">{candidates.length ? 'Everyone who matches is already on the list.' : 'No matches. Try a bigger area or fewer filters.'}</p>
              ) : (
                <>
                  <div className="suggest-head">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={picked.size > 0 && suggestions.slice(0, showCount).every((s) => picked.has(s.contact.id))}
                        onChange={(e) => setPicked(e.target.checked ? new Set(suggestions.slice(0, showCount).map((s) => s.contact.id)) : new Set())}
                      />
                      Select shown
                    </label>
                    <button type="button" className="btn small primary" disabled={!picked.size || busy === 'add' || closed} onClick={() => addResults(suggestions.filter((s) => picked.has(s.contact.id)), 'match')}>
                      {busy === 'add' ? 'Adding…' : `Add ${picked.size || ''} to list`}
                    </button>
                  </div>
                  <ul className="match-list suggest-list">
                    {suggestions.slice(0, showCount).map((r) => (
                      <li key={r.contact.id} className={`match-row suggest ${pinned === r.contact.id ? 'highlight' : ''}`}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${displayName(r.contact)}`}
                          checked={picked.has(r.contact.id)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.contact.id)) next.delete(r.contact.id);
                              else next.add(r.contact.id);
                              return next;
                            })
                          }
                        />
                        <MatchLine r={r} />
                        <button type="button" className="btn small" disabled={closed} onClick={() => addResults([r], 'match')}>
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                  {suggestions.length > showCount && (
                    <button type="button" className="link-btn small" onClick={() => setShowCount((n) => n + SUGGEST_PAGE)}>
                      Show {Math.min(SUGGEST_PAGE, suggestions.length - showCount)} more of {suggestions.length - showCount}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {scheduling && <ScheduleDialog contact={scheduling} onClose={() => setScheduling(null)} onScheduled={() => setScheduling(null)} />}
      {confirm === 'delete' && (
        <Confirm
          title="Delete this campaign?"
          message={`“${campaign.name}” and its list of ${members?.length ?? 0} will be deleted. The contacts themselves, and their timelines, stay.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const err = await deleteCampaign(campaign.id);
            if (err) {
              setConfirm(null);
              setError(err);
            } else navigate('/campaigns');
          }}
        />
      )}
    </div>
  );
}

/** Score, who and why, for a suggestion. */
function MatchLine({ r }: { r: MatchResult }) {
  return (
    <>
      <span className={`score s${Math.min(9, Math.floor(r.score / 10))}`} title={`Match score ${r.score} of 100`}>
        {r.score}
      </span>
      <div className="match-main">
        <div>
          <Link to={`/contacts/${r.contact.id}`}>{displayName(r.contact)}</Link>
          {companyLabel(r.contact) && <span className="muted small"> · {companyLabel(r.contact)}</span>}
          <span className="tag match-kind">{KIND_LABEL[r.kind]}</span>
        </div>
        <Reasons reasons={r.reasons} />
      </div>
    </>
  );
}

function Reasons({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <div className="reasons">
      {reasons.map((x, i) => (
        <span key={i} className={`reason r-${x.tone}`}>
          {x.text}
        </span>
      ))}
    </div>
  );
}

interface RowProps {
  m: Member;
  c: Contact;
  highlighted: boolean;
  disabled: boolean;
  people: { id: string; displayName: string }[];
  onUpdate: (patch: Partial<Pick<Member, 'stage' | 'note' | 'assignedTo'>>) => void;
  onRemove: () => void;
  onSchedule: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
}

/** One person on the list: their stage, why they're here, a note, and ways to reach them. */
function MemberRow({ m, c, highlighted, disabled, people, onUpdate, onRemove, onSchedule, rowRef }: RowProps) {
  const [note, setNote] = useState(m.note);
  useEffect(() => setNote(m.note), [m.note]);
  return (
    <li ref={rowRef} className={`member-row st-${m.stage} ${highlighted ? 'highlight' : ''}`}>
      <span className={`score ${m.score != null ? `s${Math.min(9, Math.floor(m.score / 10))}` : 'none'}`} title={m.score != null ? `Match score ${m.score} of 100` : 'Added by hand'}>
        {m.score ?? '—'}
      </span>
      <div className="match-main">
        <div>
          <Link to={`/contacts/${c.id}`}>{displayName(c)}</Link>
          {companyLabel(c) && <span className="muted small"> · {companyLabel(c)}</span>}
          {c.archivedAt && <span className="tag">Archived</span>}
        </div>
        <Reasons reasons={m.reasons} />
        <input
          className="member-note"
          placeholder="Note"
          aria-label={`Note for ${displayName(c)}`}
          value={note}
          disabled={disabled}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== m.note && onUpdate({ note })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="muted small">
          {m.lastContactedAt ? `Last contacted ${formatDate(m.lastContactedAt)}` : 'Not contacted yet'}
          {c.phone && (
            <>
              {' · '}
              <a href={`tel:${c.phone.replace(/\D/g, '')}`}>{c.phone}</a>
            </>
          )}
        </div>
      </div>
      <div className="member-side">
        <select aria-label={`Stage for ${displayName(c)}`} className={`stage-select st-${m.stage}`} value={m.stage} disabled={disabled} onChange={(e) => onUpdate({ stage: e.target.value as Stage })}>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select aria-label={`Assigned to for ${displayName(c)}`} className="small-select" value={m.assignedTo ?? ''} disabled={disabled} onChange={(e) => onUpdate({ assignedTo: e.target.value })}>
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <div className="inline-actions">
          <button type="button" className="btn small" onClick={onSchedule} disabled={disabled}>
            Schedule
          </button>
          <button type="button" className="link-btn tl-delete small" onClick={onRemove} disabled={disabled} title="Take off the list">
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
