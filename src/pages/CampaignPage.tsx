import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Confirm } from '../components/Dialog';
import { MultiSelect } from '../components/MultiSelect';
import {
  deleteCampaign,
  fetchCampaign,
  fetchSuppressed,
  footerReady,
  previewEmail,
  resolveAudience,
  saveCampaign,
  sendTest,
  startCampaign,
  stopCampaign,
  useOrgSettings,
  type Audience,
  type Campaign,
  type CampaignStats,
} from '../lib/campaigns';
import { displayName, formatDate } from '../lib/filters';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import { MERGE_FIELDS, mergeValues, unknownFields, useTemplates } from '../lib/templates';
import { CATEGORIES, CUSTOMER_TYPES, REGIONS, STATUSES } from '../types';
import { STATUS_LABEL } from './CampaignsPage';

/** A campaign: the editor while it's a draft, the results once it's sent or scheduled. */
export default function CampaignPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ campaign: Campaign; stats?: CampaignStats } | null | undefined>(undefined);
  const load = useCallback(async () => setData(await fetchCampaign(id)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (data === undefined) return <div className="detail-page"><p className="muted">Loading…</p></div>;
  if (data === null)
    return (
      <div className="detail-page">
        <div className="empty">
          <strong>This campaign doesn't exist.</strong>
          <Link to="/campaigns">Back to campaigns</Link>
        </div>
      </div>
    );
  return data.campaign.status === 'draft' ? <Editor initial={data.campaign} onStarted={load} /> : <Results campaign={data.campaign} stats={data.stats} reload={load} />;
}

// ---------------------------------------------------------------------------------------------
function Editor({ initial, onStarted }: { initial: Campaign; onStarted: () => void }) {
  const navigate = useNavigate();
  const { profile, people } = useSession();
  const { contacts, loading } = useContacts();
  const { templates } = useTemplates();
  const { org } = useOrgSettings();
  const [c, setC] = useState<Campaign>(initial);
  const [saved, setSaved] = useState<Campaign>(initial);
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<'send' | 'delete' | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [showList, setShowList] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const canEdit = initial.createdBy === profile.id || profile.role === 'admin';
  const isAdmin = profile.role === 'admin';
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);

  useEffect(() => {
    fetchSuppressed().then(setSuppressed);
  }, []);

  const audience = useMemo(() => resolveAudience(contacts, c.business, c.audience, suppressed), [contacts, c.business, c.audience, suppressed]);
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of audience.excluded) m.set(x.reason, (m.get(x.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [audience.excluded]);
  const campaignTags = useMemo(() => [...new Set(contacts.flatMap((x) => x.campaigns))].sort((a, b) => a.localeCompare(b)), [contacts]);

  const sender = people.find((p) => p.id === c.senderId) ?? profile;
  const sample = audience.included.find((x) => x.id === sampleId) ?? audience.included[0];
  const preview = previewEmail(c, sample ? mergeValues(sample, sender.displayName) : mergeValues({ firstName: 'Alex', lastName: 'Sample', company: 'tbd', title: '', regions: [], properties: [] } as never, sender.displayName), sender.signature);
  const typos = unknownFields(`${c.subject}\n${c.body}`);

  const set = <K extends keyof Campaign>(k: K, v: Campaign[K]) => setC((x) => ({ ...x, [k]: v }));
  const setAud = <K extends keyof Audience>(k: K) => (v: Audience[K]) => setC((x) => ({ ...x, audience: { ...x.audience, [k]: v } }));

  async function save() {
    const err = await saveCampaign(c);
    if (err) {
      setMsg({ kind: 'error', text: `Couldn't save: ${err}` });
      return false;
    }
    setSaved(c);
    return true;
  }

  const insertField = (key: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const token = `{{${key}}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    set('body', el.value.slice(0, start) + token + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function test() {
    setMsg(null);
    if (typos.length) return setMsg({ kind: 'error', text: `Fix {{${typos.join('}}, {{')}}} first.` });
    setBusy('test');
    try {
      if (dirty && !(await save())) return;
      const r = await sendTest(c.id, sample?.id);
      setMsg({ kind: 'ok', text: `Test sent to ${r.to}. Check how it looks, including on your phone.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  async function send() {
    setConfirm(null);
    setBusy('send');
    try {
      if (dirty && !(await save())) return;
      const r = await startCampaign(c.id, audience.included.map((x) => x.id), when === 'later' ? new Date(scheduleAt).toISOString() : undefined);
      setMsg({ kind: 'ok', text: r.scheduled ? `Scheduled for ${r.queued} people.` : `Sending to ${r.queued} people.` });
      onStarted();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
      setBusy('');
    }
  }

  const problems = [
    !footerReady(org) && 'brokerage details (Settings)',
    !c.subject.trim() && 'a subject',
    !c.body.trim() && 'a message',
    typos.length > 0 && 'valid merge fields',
    audience.included.length === 0 && 'at least one recipient with consent',
  ].filter(Boolean) as string[];

  return (
    <div className="detail-page campaign-page">
      <nav className="crumbs">
        <Link to="/campaigns">← Campaigns</Link>
      </nav>
      <header className="contact-head">
        <div className="contact-title">
          <input className="title-input" aria-label="Campaign name" value={c.name} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} />
          <div className="tag-row">
            <span className="tag">{c.business}</span>
            <span className="tag camp-status cs-draft">Draft</span>
            {dirty && <span className="muted small">Unsaved changes</span>}
          </div>
        </div>
        {canEdit && (
          <div className="head-actions">
            <button type="button" className="btn" onClick={save} disabled={!dirty}>
              Save draft
            </button>
            <button type="button" className="btn danger-outline" onClick={() => setConfirm('delete')}>
              Delete
            </button>
          </div>
        )}
      </header>
      {msg && (
        <p className={`notice ${msg.kind === 'error' ? 'warn' : 'ok'}`} role={msg.kind === 'error' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}
      {!footerReady(org) && (
        <p className="notice warn">
          Canadian anti-spam law requires the brokerage's name, mailing address and a phone, email or website in every marketing email.{' '}
          {isAdmin ? <Link to="/settings#brokerage">Add them in Settings →</Link> : 'Ask an admin to add them in Settings.'}
        </p>
      )}

      <div className="detail-grid campaign-grid">
        <div className="detail-col">
          <section className="panel">
            <h2>1. Audience</h2>
            <div className="seg" role="group" aria-label="Who">
              {(['prospects', 'all', 'other'] as const).map((w) => (
                <button key={w} type="button" disabled={!canEdit} aria-pressed={c.audience.who === w} className={c.audience.who === w ? 'on' : ''} onClick={() => setAud('who')(w)}>
                  {w === 'prospects' ? 'Prospects' : w === 'all' ? 'All contacts' : 'Other contacts'}
                </button>
              ))}
            </div>
            <div className="list-filters">
              {c.audience.who !== 'other' && <MultiSelect label="Status" options={STATUSES} value={c.audience.statuses} onChange={setAud('statuses')} />}
              <MultiSelect label="Customer type" options={CUSTOMER_TYPES} value={c.audience.customerTypes} onChange={setAud('customerTypes')} />
              <MultiSelect label="Category" options={CATEGORIES} value={c.audience.categories} onChange={setAud('categories')} />
              <MultiSelect label="Region" options={REGIONS} value={c.audience.regions} onChange={setAud('regions')} />
              <MultiSelect label="Campaign tag" options={campaignTags} value={c.audience.campaigns} onChange={setAud('campaigns')} />
            </div>
            {loading ? (
              <p className="muted">Loading contacts…</p>
            ) : (
              <div className="audience-summary">
                <p className="hero-line">
                  <strong>{audience.included.length}</strong> will receive it
                  <span className="muted"> · {audience.matching.length} match these filters</span>
                </p>
                {reasons.length > 0 && (
                  <p className="muted small">
                    Left out: {reasons.map(([r, n]) => `${n} ${r}`).join(', ')}. Hub only emails contacts with valid consent.
                  </p>
                )}
                <button type="button" className="link-btn" aria-expanded={showList} onClick={() => setShowList((s) => !s)}>
                  {showList ? 'Hide' : 'Show'} recipients
                </button>
                {showList && (
                  <ul className="recipient-list">
                    {audience.included.slice(0, 200).map((x) => (
                      <li key={x.id}>
                        <Link to={`/contacts/${x.id}`}>{displayName(x)}</Link> <span className="muted small">{x.email}</span>
                      </li>
                    ))}
                    {audience.included.length > 200 && <li className="muted small">…and {audience.included.length - 200} more</li>}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>2. Message</h2>
            <div className="form-grid">
              <label className="field">
                <span>From</span>
                <select value={c.senderId ?? profile.id} disabled={!canEdit} onChange={(e) => set('senderId', e.target.value)}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} ({p.email})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Start from a template</span>
                <select
                  value=""
                  disabled={!canEdit}
                  onChange={(e) => {
                    const t = templates?.find((x) => x.id === e.target.value);
                    if (t) setC((x) => ({ ...x, subject: t.subject, body: t.body }));
                  }}
                >
                  <option value="">Choose…</option>
                  {templates?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Subject</span>
              <input value={c.subject} disabled={!canEdit} onChange={(e) => set('subject', e.target.value)} />
            </label>
            <div className="field">
              <span>Insert a field (filled in for each person)</span>
              <div className="field-chips">
                {MERGE_FIELDS.map((f) => (
                  <button key={f.key} type="button" disabled={!canEdit} onMouseDown={(e) => e.preventDefault()} onClick={() => insertField(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Message</span>
              <textarea ref={bodyRef} rows={12} value={c.body} disabled={!canEdit} onChange={(e) => set('body', e.target.value)} />
            </label>
            {typos.length > 0 && <p className="field-error">Hub doesn't know {`{{${typos.join('}}, {{')}}}`}. Use the field buttons.</p>}
            <p className="muted small">
              {sender.displayName}'s signature, the brokerage details and an unsubscribe link are added automatically. Replies go to {sender.email}.
            </p>
          </section>
        </div>

        <div className="detail-col">
          <section className="panel preview-panel">
            <div className="panel-head">
              <h2>Preview</h2>
              {audience.included.length > 0 && (
                <select aria-label="Preview as" value={sample?.id ?? ''} onChange={(e) => setSampleId(e.target.value)}>
                  {audience.included.slice(0, 50).map((x) => (
                    <option key={x.id} value={x.id}>
                      As {displayName(x)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="email-preview">
              <div className="ep-meta">
                <div>
                  <span className="muted">From</span> {sender.displayName} &lt;{sender.email}&gt;
                </div>
                <div>
                  <span className="muted">To</span> {sample?.email ?? 'each recipient'}
                </div>
                <div className="ep-subject">{preview.subject || <span className="muted">(no subject)</span>}</div>
              </div>
              <div className="ep-body">
                {preview.body ? preview.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p className="muted">Your message will appear here.</p>}
                {preview.signature && <p className="ep-sig">{preview.signature}</p>}
                <div className="ep-footer">
                  {org && footerReady(org) ? `${org.brokerageName} · ${org.mailingAddress} · ${org.contactLine}` : '[Brokerage name · mailing address · phone or website]'}
                  <br />
                  You're receiving this because of your past dealings or inquiries with us. <u>Unsubscribe</u>.
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>3. Send</h2>
            <div className="inline-actions">
              <button type="button" className="btn" onClick={test} disabled={!!busy || !footerReady(org) || !c.subject.trim() || !c.body.trim()}>
                {busy === 'test' ? 'Sending test…' : `Send a test to me`}
              </button>
              <span className="muted small">Goes to {profile.email}</span>
            </div>
            {isAdmin ? (
              <>
                <div className="seg small" role="group" aria-label="When">
                  <button type="button" aria-pressed={when === 'now'} className={when === 'now' ? 'on' : ''} onClick={() => setWhen('now')}>
                    Send now
                  </button>
                  <button type="button" aria-pressed={when === 'later'} className={when === 'later' ? 'on' : ''} onClick={() => setWhen('later')}>
                    Schedule
                  </button>
                </div>
                {when === 'later' && (
                  <label className="field">
                    <span>Send at</span>
                    <input type="datetime-local" value={scheduleAt} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setScheduleAt(e.target.value)} />
                  </label>
                )}
                {problems.length > 0 && <p className="muted small">Before sending, add {problems.join(', ')}.</p>}
                <button
                  type="button"
                  className="btn primary"
                  disabled={!!busy || problems.length > 0 || (when === 'later' && !scheduleAt)}
                  onClick={() => setConfirm('send')}
                >
                  {busy === 'send' ? 'Starting…' : when === 'now' ? `Send to ${audience.included.length} people` : `Schedule for ${audience.included.length} people`}
                </button>
              </>
            ) : (
              <p className="notice">Only admins can send campaigns. Save the draft and let an admin know it's ready to review.</p>
            )}
          </section>
        </div>
      </div>

      {confirm === 'send' && (
        <Confirm
          title={when === 'now' ? `Send to ${audience.included.length} people now?` : `Schedule for ${audience.included.length} people?`}
          message={`“${preview.subject}” will go from ${sender.displayName} <${sender.email}>${when === 'later' ? ` on ${new Date(scheduleAt).toLocaleString('en-CA')}` : ''}. This can't be undone once sent.`}
          confirmLabel={when === 'now' ? 'Send now' : 'Schedule'}
          onCancel={() => setConfirm(null)}
          onConfirm={send}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          title="Delete this draft?"
          message="The draft will be removed for everyone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            const err = await deleteCampaign(c.id);
            if (err) setMsg({ kind: 'error', text: err });
            else navigate('/campaigns');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
interface SendRow {
  id: string;
  contact_id: string | null;
  email: string;
  status: string;
  error: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  unsubscribed_at: string | null;
}

function Results({ campaign, stats, reload }: { campaign: Campaign; stats?: CampaignStats; reload: () => void }) {
  const { profile, people } = useSession();
  const { contacts } = useContacts();
  const [sends, setSends] = useState<SendRow[]>([]);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState('');
  const active = campaign.status === 'sending' || campaign.status === 'scheduled';

  const loadSends = useCallback(async () => {
    const { data } = await supabase
      .from('campaign_sends')
      .select('id, contact_id, email, status, error, opened_at, clicked_at, unsubscribed_at')
      .eq('campaign_id', campaign.id)
      .order('email');
    setSends((data ?? []) as SendRow[]);
  }, [campaign.id]);

  useEffect(() => {
    loadSends();
    if (!active) return;
    // Refresh while it's going out.
    const t = setInterval(() => {
      reload();
      loadSends();
    }, 15_000);
    return () => clearInterval(t);
  }, [active, loadSends, reload]);

  const byId = useMemo(() => new Map(contacts.map((x) => [x.id, x])), [contacts]);
  const s = stats ?? { recipients: 0, queued: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0, unsubscribed: 0 };
  const attempted = s.sent + s.bounced;
  const pct = (n: number) => (attempted ? `${Math.round((n / attempted) * 100)}%` : '—');
  const sender = people.find((p) => p.id === campaign.senderId);

  const tiles = [
    { label: 'Recipients', value: String(s.recipients), sub: s.queued ? `${s.queued} still to send` : '' },
    { label: 'Delivered', value: pct(s.delivered), sub: `${s.delivered} of ${attempted}` },
    { label: 'Opened', value: pct(s.opened), sub: `${s.opened} people` },
    { label: 'Clicked', value: pct(s.clicked), sub: `${s.clicked} people` },
    { label: 'Bounced', value: String(s.bounced), sub: s.failed ? `${s.failed} not sent` : '' },
    { label: 'Unsubscribed', value: String(s.unsubscribed), sub: '' },
  ];

  return (
    <div className="detail-page campaign-page">
      <nav className="crumbs">
        <Link to="/campaigns">← Campaigns</Link>
      </nav>
      <header className="contact-head">
        <div className="contact-title">
          <h1>{campaign.name}</h1>
          <div className="muted">
            “{campaign.subject}” from {sender?.displayName ?? 'a former user'}
          </div>
          <div className="tag-row">
            <span className="tag">{campaign.business}</span>
            <span className={`tag camp-status cs-${campaign.status}`}>{STATUS_LABEL[campaign.status]}</span>
            <span className="muted small">
              {campaign.status === 'scheduled' && campaign.scheduledFor
                ? `Sends ${new Date(campaign.scheduledFor).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`
                : campaign.finishedAt
                  ? `Finished ${formatDate(campaign.finishedAt)}`
                  : campaign.startedAt
                    ? `Started ${formatDate(campaign.startedAt)}`
                    : ''}
            </span>
          </div>
        </div>
        {active && profile.role === 'admin' && (
          <div className="head-actions">
            <button type="button" className="btn danger-outline" onClick={() => setConfirmStop(true)}>
              {campaign.status === 'scheduled' ? 'Cancel' : 'Stop sending'}
            </button>
          </div>
        )}
      </header>
      {error && <p className="notice warn">{error}</p>}
      {campaign.status === 'sending' && (
        <p className="notice">Sending in batches; this page updates every 15 seconds. Large lists continue in the background, within Resend's daily limit.</p>
      )}

      <div className="stat-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <span className="muted small">{t.label}</span>
            <strong>{t.value}</strong>
            {t.sub && <span className="muted small">{t.sub}</span>}
          </div>
        ))}
      </div>
      <p className="muted small">Opens are approximate: some email apps block tracking, others open emails automatically.</p>

      <div className="table-wrap">
        <table className="contact-table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Status</th>
              <th className="hide-sm">Opened</th>
              <th className="hide-sm">Clicked</th>
            </tr>
          </thead>
          <tbody>
            {sends.map((r) => {
              const contact = r.contact_id ? byId.get(r.contact_id) : undefined;
              return (
                <tr key={r.id}>
                  <td>
                    {contact ? <Link to={`/contacts/${contact.id}`}>{displayName(contact)}</Link> : <span>{r.email}</span>}
                    <div className="muted small">{r.email}</div>
                  </td>
                  <td>
                    <span className={`tag send-${r.unsubscribed_at ? 'bounced' : r.status}`}>{r.unsubscribed_at ? 'Unsubscribed' : r.status[0].toUpperCase() + r.status.slice(1)}</span>
                    {r.error && <div className="muted small">{r.error}</div>}
                  </td>
                  <td className="hide-sm">{r.opened_at ? formatDate(r.opened_at) : ''}</td>
                  <td className="hide-sm">{r.clicked_at ? formatDate(r.clicked_at) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmStop && (
        <Confirm
          title={campaign.status === 'scheduled' ? 'Cancel this scheduled campaign?' : 'Stop sending?'}
          message="Nobody else will be emailed. People who already received it aren't affected."
          confirmLabel={campaign.status === 'scheduled' ? 'Cancel campaign' : 'Stop sending'}
          danger
          onCancel={() => setConfirmStop(false)}
          onConfirm={async () => {
            setConfirmStop(false);
            try {
              await stopCampaign(campaign.id);
              reload();
              loadSends();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
