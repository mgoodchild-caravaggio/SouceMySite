import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ContactForm } from '../components/ContactForm';
import { useAiStatus } from '../lib/askHub';
import { companyLabel, displayName, formatDate } from '../lib/filters';
import { haversineKm } from '../lib/geo';
import { continueResearch, domainOf, isStalled, RESEARCH_AREAS, startResearch, useResearch, type Finding, type ResearchKind, type ResearchRun } from '../lib/research';
import { searchPlaces } from '../lib/services';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import type { Category, Contact } from '../types';

const KIND_LABEL: Record<ResearchKind, string> = { developers: 'Builders & developers', applications: 'Development applications' };
const OTHER = '__other';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/\b(inc|ltd|limited|corp|corporation|homes?|group|developments?|the)\b/g, '').replace(/[^a-z0-9]/g, '');
const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/**
 * Ask Hub outside research: Claude searches the web for builders/developers or municipal development
 * applications in an area. What it finds is a list of leads to review; nothing is added to Hub until
 * someone clicks Add, and added leads have no email consent.
 */
export default function ResearchPage() {
  const { people } = useSession();
  const { status: ai } = useAiStatus();
  const { contacts, addProperty } = useContacts();
  const { runs, findings, error, reload, patchFinding } = useResearch();
  const [kind, setKind] = useState<ResearchKind>('applications');
  const [area, setArea] = useState(RESEARCH_AREAS[0]);
  const [town, setTown] = useState('');
  const [focus, setFocus] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [driving, setDriving] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'new' | 'added' | 'dismissed'>('new');
  const [runFilter, setRunFilter] = useState('');
  const [adding, setAdding] = useState<Finding | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const ready = !!ai?.enabled && ai.keySet;
  const overCap = !!ai && ai.monthSpendUsd >= ai.monthlyCapUsd;

  /** Keeps a run going, one step at a time, while this page is open. */
  async function drive(runId: string) {
    setDriving((s) => new Set(s).add(runId));
    try {
      for (let i = 0; i < 12 && alive.current; i++) {
        const r = await continueResearch(runId);
        await reload();
        if (r.status !== 'running') {
          if (r.status === 'done') setMessage({ ok: true, text: `Research finished: ${r.found ?? 0} ${r.found === 1 ? 'lead' : 'leads'} to review.` });
          break;
        }
        if (r.busy) await wait(5000);
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      await reload();
    }
    setDriving((s) => {
      const n = new Set(s);
      n.delete(runId);
      return n;
    });
  }

  async function start() {
    const where = area === OTHER ? town.trim() : area;
    if (!where) return setMessage({ ok: false, text: 'Say which town or area.' });
    setMessage(null);
    setDriving((s) => new Set(s).add('new'));
    try {
      const r = await startResearch(kind, where, focus.trim());
      await reload();
      setRunFilter('');
      setTab('new');
      setDriving((s) => {
        const n = new Set(s);
        n.delete('new');
        return n;
      });
      if (r.status === 'running') await drive(r.runId);
      else if (r.status === 'done') setMessage({ ok: true, text: `Research finished: ${r.found ?? 0} leads to review.` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      setDriving((s) => {
        const n = new Set(s);
        n.delete('new');
        return n;
      });
      await reload();
    }
  }

  // ---- Linking findings to Hub ----
  const realEstate = useMemo(() => contacts.filter((c) => c.business === 'Real Estate' && !c.archivedAt), [contacts]);
  /** A contact that looks like this finding: same website, phone, email or company name. */
  const inHub = (f: Finding): Contact | undefined => {
    const site = domainOf(f.website);
    const phone = digits(f.phone);
    const name = norm(f.kind === 'developer' ? f.name : '');
    return realEstate.find(
      (c) =>
        (site && domainOf(c.website.startsWith('http') ? c.website : `https://${c.website}`) === site) ||
        (phone.length === 10 && (digits(c.phone) === phone || digits(c.phone2) === phone)) ||
        (f.email && c.email?.toLowerCase() === f.email) ||
        (name.length > 3 && norm(c.company) === name),
    );
  };
  /** Hub contacts with land within 1 km of an application. */
  const nearby = (f: Finding) =>
    f.lat == null || f.lng == null
      ? []
      : realEstate.filter((c) => c.id !== f.contactId && c.properties.some((p) => haversineKm({ lat: f.lat!, lng: f.lng! }, p) <= 1));

  // Put applications on the map (once each; OpenStreetMap allows about one lookup a second).
  const placing = useRef(new Set<string>());
  useEffect(() => {
    const todo = findings.filter((f) => f.kind === 'application' && f.address && f.lat == null && !placing.current.has(f.id)).slice(0, 15);
    if (!todo.length) return;
    let stop = false;
    (async () => {
      for (const f of todo) {
        if (stop) return;
        placing.current.add(f.id);
        const q = [f.address, f.municipality, 'Ontario'].filter(Boolean).join(', ');
        const hit = (await searchPlaces(q).catch(() => []))[0];
        if (hit) await patchFinding(f.id, { lat: hit.lat, lng: hit.lng });
        await wait(1100);
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings.length]);

  const shown = findings.filter((f) => f.state === tab && (!runFilter || f.runId === runFilter));
  const counts = { new: 0, added: 0, dismissed: 0 };
  for (const f of findings) if (!runFilter || f.runId === runFilter) counts[f.state]++;
  const runOf = (id: string) => runs?.find((r) => r.id === id);
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.displayName ?? 'Someone';

  const decide = async (f: Finding, state: Finding['state'], contactId?: string) => {
    const err = await patchFinding(f.id, {
      state,
      contact_id: contactId ?? (state === 'new' ? null : f.contactId ?? null),
      decided_at: state === 'new' ? null : new Date().toISOString(),
    });
    if (err) setMessage({ ok: false, text: err });
  };

  return (
    <div className="detail-page research-page">
      <header className="page-head">
        <div>
          <h1>Research</h1>
          <span className="muted">Ask Hub searches the web for new prospects. Review each lead before it goes into Hub.</span>
        </div>
      </header>

      {ai && !ready && (
        <p className="notice warn">
          Research uses Ask Hub, which is switched off. An admin can turn it on in <Link to="/settings">Settings → Ask Hub</Link>.
        </p>
      )}

      <section className="panel research-new">
        <h2>New research</h2>
        <div className="seg" role="group" aria-label="What to look for">
          {(Object.keys(KIND_LABEL) as ResearchKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="muted small">
          {kind === 'developers'
            ? 'Builders and land developers active in the area who aren’t in Hub yet, with website, office phone and a source.'
            : 'Recent development applications, plans of subdivision, site plans, rezonings and Official Plan amendments, from municipal sources. Hub shows who you know nearby.'}
        </p>
        <div className="form-grid">
          <label className="field">
            <span>Area</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              {RESEARCH_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              <option value={OTHER}>Another town…</option>
            </select>
          </label>
          {area === OTHER ? (
            <label className="field">
              <span>Town or area</span>
              <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Orangeville" maxLength={120} />
            </label>
          ) : (
            <span />
          )}
          <label className="field span-2">
            <span>Focus (optional)</span>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={300}
              placeholder={kind === 'developers' ? 'e.g. industrial developers, or builders doing 50+ lot subdivisions' : 'e.g. employment lands, or applications over 10 ha'}
            />
          </label>
        </div>
        <div className="inline-actions">
          <button type="button" className="btn primary" disabled={!ready || overCap || driving.size > 0} onClick={start}>
            {driving.size ? 'Researching…' : 'Start research'}
          </button>
          <span className="muted small">
            Takes 1–3 minutes; usually $0.50–$2 of the Ask Hub budget
            {ai ? ` ($${ai.monthSpendUsd.toFixed(2)} of $${ai.monthlyCapUsd.toFixed(2)} used this month)` : ''}.
          </span>
        </div>
        {message && (
          <p className={`notice ${message.ok ? 'ok' : 'warn'}`} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
      </section>

      {error && <p className="notice warn">{error}</p>}

      {runs && runs.length > 0 && (
        <section className="panel">
          <h2>Recent research</h2>
          <ul className="run-list">
            {runs.slice(0, 8).map((r) => (
              <RunRow
                key={r.id}
                run={r}
                who={nameOf(r.createdBy)}
                found={findings.filter((f) => f.runId === r.id).length}
                active={driving.has(r.id)}
                selected={runFilter === r.id}
                onSelect={() => setRunFilter(runFilter === r.id ? '' : r.id)}
                onContinue={() => drive(r.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Leads{runFilter && runOf(runFilter) ? ` from ${KIND_LABEL[runOf(runFilter)!.kind].toLowerCase()} · ${runOf(runFilter)!.area}` : ''}</h2>
          <div className="seg small" role="group" aria-label="Which leads">
            {(['new', 'added', 'dismissed'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'new' ? 'To review' : t === 'added' ? 'Added' : 'Dismissed'} ({counts[t]})
              </button>
            ))}
          </div>
        </div>
        {runFilter && (
          <button type="button" className="link-btn small" onClick={() => setRunFilter('')}>
            Show leads from all research
          </button>
        )}
        {runs === null ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted">{tab === 'new' ? 'Nothing to review. Start some research above.' : 'None yet.'}</p>
        ) : (
          <ul className="finding-list">
            {shown.map((f) => (
              <FindingCard
                key={f.id}
                f={f}
                match={inHub(f)}
                near={nearby(f)}
                linked={f.contactId ? contacts.find((c) => c.id === f.contactId) : undefined}
                onAdd={() => setAdding(f)}
                onDismiss={() => decide(f, 'dismissed')}
                onUndo={() => decide(f, 'new')}
              />
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <ContactForm
          initial={initialFor(adding)}
          onClose={() => setAdding(null)}
          onSaved={async (c) => {
            const f = adding;
            setAdding(null);
            // An application's land goes on the map for the new prospect.
            if (f.kind === 'application' && f.lat != null && f.lng != null) {
              await addProperty(c.id, {
                address: f.address || f.name,
                lat: f.lat,
                lng: f.lng,
                category: (/industrial|employment/i.test(`${f.name} ${f.summary}`) ? 'Industrial Land' : 'Residential Land') as Category,
                relation: 'Owns',
              });
            }
            await decide(f, 'added', c.id);
            setMessage({ ok: true, text: `${displayName(c)} is in Hub now, with no email consent.` });
          }}
        />
      )}
    </div>
  );
}

/** A new prospect from a lead: no email consent (CASL), and the source in the notes. */
function initialFor(f: Finding) {
  const [first, ...rest] = f.contactName.trim().split(/\s+/);
  const notes = [
    f.summary,
    f.kind === 'application' && [f.appStatus, f.fileNumber && `File ${f.fileNumber}`, f.address, f.municipality].filter(Boolean).join(' · '),
    f.kind === 'application' && `Application: ${f.name}`,
    f.sourceUrl && `Source: ${f.sourceUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    business: 'Real Estate' as const,
    isProspect: true,
    firstName: f.contactName ? first : '',
    lastName: f.contactName ? rest.join(' ') : '',
    company: f.kind === 'developer' ? f.name : 'tbd',
    title: f.role,
    phone: f.phone,
    email: f.email || undefined,
    website: f.website,
    mailingAddress: f.kind === 'developer' ? f.address : '',
    leadSource: `AI research: ${domainOf(f.sourceUrl) || 'web'}`,
    customerTypes: f.kind === 'developer' ? (['Builder/Developer'] as Contact['customerTypes']) : [],
    notes,
    emailConsent: 'none' as const,
  };
}

function RunRow({
  run,
  who,
  found,
  active,
  selected,
  onSelect,
  onContinue,
}: {
  run: ResearchRun;
  who: string;
  found: number;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onContinue: () => void;
}) {
  const stalled = !active && isStalled(run);
  return (
    <li className={selected ? 'selected' : ''}>
      <button type="button" className="run-main" onClick={onSelect} title="Show only this research's leads">
        <strong>{KIND_LABEL[run.kind]}</strong> · {run.area}
        {run.focus && <span className="muted"> · {run.focus}</span>}
        <span className="muted small run-meta">
          {who} · {formatDate(run.createdAt)} · {run.searches} {run.searches === 1 ? 'search' : 'searches'} · ${run.costUsd.toFixed(2)}
        </span>
        {run.summary && <span className="small run-summary">{run.summary}</span>}
        {run.error && <span className="field-error small">{run.error}</span>}
      </button>
      <span className="run-state">
        {run.status === 'done' ? (
          <span className="tag">{found} {found === 1 ? 'lead' : 'leads'}</span>
        ) : run.status === 'failed' ? (
          <span className="tag warn-tag">Failed</span>
        ) : active || !stalled ? (
          <span className="tag running-tag">
            <span className="spinner small" aria-hidden="true" /> Searching… step {run.steps + 1}
          </span>
        ) : (
          <button type="button" className="btn small" onClick={onContinue}>
            Continue
          </button>
        )}
      </span>
    </li>
  );
}

function FindingCard({
  f,
  match,
  near,
  linked,
  onAdd,
  onDismiss,
  onUndo,
}: {
  f: Finding;
  match?: Contact;
  near: Contact[];
  linked?: Contact;
  onAdd: () => void;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  const facts = [f.kind === 'application' && f.appStatus, f.fileNumber && `File ${f.fileNumber}`, [f.address, f.municipality].filter(Boolean).join(', ')].filter(Boolean);
  return (
    <li className="finding">
      <div className="finding-head">
        <span className={`tag ${f.kind === 'developer' ? 'kind-dev' : 'kind-app'}`}>{f.kind === 'developer' ? 'Builder/developer' : 'Application'}</span>
        <strong className="finding-name">{f.name}</strong>
      </div>
      {facts.length > 0 && <div className="muted small">{facts.join(' · ')}</div>}
      <p className="finding-summary">{f.summary}</p>
      {(f.contactName || f.phone || f.email || f.website) && (
        <div className="small finding-contact">
          {f.contactName && (
            <span>
              {f.contactName}
              {f.role && <span className="muted"> ({f.role})</span>}
            </span>
          )}
          {f.phone && <a href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}>{f.phone}</a>}
          {f.email && <span>{f.email}</span>}
          {f.website && (
            <a href={f.website} target="_blank" rel="noreferrer noopener">
              {domainOf(f.website) || f.website}
            </a>
          )}
        </div>
      )}
      {match && f.state === 'new' && (
        <p className="notice small finding-note">
          Looks like <Link to={`/contacts/${match.id}`}>{displayName(match)}</Link>
          {companyLabel(match) && ` (${companyLabel(match)})`}, already in Hub.
        </p>
      )}
      {near.length > 0 && (
        <p className="notice small finding-note">
          <strong>
            {near.length} {near.length === 1 ? 'contact has' : 'contacts have'} land within 1 km:
          </strong>{' '}
          {near.slice(0, 5).map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link to={`/contacts/${c.id}`}>{displayName(c)}</Link>
            </span>
          ))}
          {near.length > 5 && ` and ${near.length - 5} more`}
          {f.lat != null && (
            <>
              {' · '}
              <Link to={`/map?near=${f.lat},${f.lng}&r=1&label=${encodeURIComponent(f.address || f.name)}`}>Show on map</Link>
            </>
          )}
        </p>
      )}
      <div className="finding-foot">
        {f.sourceUrl ? (
          <a className="small finding-source" href={f.sourceUrl} target="_blank" rel="noreferrer noopener" title={f.sourceUrl}>
            Source: {f.sourceTitle || domainOf(f.sourceUrl)}
          </a>
        ) : (
          <span className="muted small">No source link</span>
        )}
        <span className="finding-actions">
          {f.state === 'new' ? (
            <>
              <button type="button" className="btn small" onClick={onDismiss}>
                Dismiss
              </button>
              <button type="button" className="btn small primary" onClick={onAdd}>
                Add as prospect
              </button>
            </>
          ) : (
            <>
              {linked && (
                <Link className="btn small" to={`/contacts/${linked.id}`}>
                  Open {displayName(linked)}
                </Link>
              )}
              <button type="button" className="link-btn small" onClick={onUndo}>
                {f.state === 'added' ? 'Back to review' : 'Undo'}
              </button>
            </>
          )}
        </span>
      </div>
    </li>
  );
}
