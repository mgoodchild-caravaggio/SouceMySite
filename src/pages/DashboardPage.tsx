import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { Link, useNavigate } from 'react-router-dom';
import { AgendaPanel } from '../components/AgendaPanel';
import { slug } from '../components/ProspectCard';
import { ScheduleDialog } from '../components/ScheduleDialog';
import { KIND_LABEL, logActivity, useRecentActivity } from '../lib/activities';
import { companyLabel, displayName, followUpState, formatDate, todayIso } from '../lib/filters';
import { formatMoney } from '../lib/geo';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import { STATUSES, type Contact, type Status } from '../types';

type Scope = 'mine' | 'everyone';
const SCOPE_KEY = 'hub.dashboard.followUpScope';
const PIPELINE: Status[] = STATUSES.filter((s) => s !== 'Unqualified');

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function timeAgo(iso: string) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (mins > -1) return 'just now';
  if (mins > -60) return relative.format(mins, 'minute');
  if (mins > -60 * 24) return relative.format(Math.round(mins / 60), 'hour');
  if (mins > -60 * 24 * 7) return relative.format(Math.round(mins / 1440), 'day');
  return formatDate(iso);
}

/** Start page: follow-ups due, pipeline, recent team activity and a map of active leads. */
export default function DashboardPage() {
  const { profile, people, business } = useSession();
  const { contacts, loading, update, touchActivity } = useContacts();
  const feed = useRecentActivity(business, 15);
  const [scheduling, setScheduling] = useState<Contact | null>(null);
  const [agendaKey, setAgendaKey] = useState(0);
  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  const inBusiness = useMemo(() => contacts.filter((c) => c.business === business), [contacts, business]);
  const prospects = useMemo(() => inBusiness.filter((c) => c.isProspect), [inBusiness]);

  // Follow-ups: overdue, today and the next 7 days, for me or for everyone.
  const weekAhead = addDays(7);
  const due = useMemo(
    () => inBusiness.filter((c) => c.followUpOn && c.followUpOn <= weekAhead).sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!)),
    [inBusiness, weekAhead],
  );
  const mineCount = due.filter((c) => c.assignedTo === profile.id).length;
  const [scope, setScope] = useState<Scope | null>(() => {
    try {
      return (localStorage.getItem(SCOPE_KEY) as Scope) || null;
    } catch {
      return null;
    }
  });
  // Until someone picks, show their own follow-ups, or everyone's if none are theirs.
  const effectiveScope: Scope = scope ?? (mineCount > 0 ? 'mine' : 'everyone');
  const chooseScope = (s: Scope) => {
    setScope(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      // Not remembered in private windows; that's fine.
    }
  };
  const shown = effectiveScope === 'mine' ? due.filter((c) => c.assignedTo === profile.id) : due;
  const today = todayIso();
  const groups = [
    { id: 'overdue', label: 'Overdue', items: shown.filter((c) => c.followUpOn! < today) },
    { id: 'today', label: 'Today', items: shown.filter((c) => c.followUpOn === today) },
    { id: 'week', label: 'Next 7 days', items: shown.filter((c) => c.followUpOn! > today) },
  ];

  const done = async (c: Contact) => {
    await update(c.id, { followUpOn: undefined });
    const at = await logActivity(c.id, 'follow_up_done');
    if (at) touchActivity(c.id, at);
    feed.reload();
  };

  // Pipeline: count and deal value per status.
  const pipeline = PIPELINE.map((status) => {
    const rows = prospects.filter((p) => p.status === status);
    return { status, count: rows.length, value: rows.reduce((sum, p) => sum + (p.dealValue ?? 0), 0) };
  });
  const maxCount = Math.max(1, ...pipeline.map((p) => p.count));
  const unqualified = prospects.filter((p) => p.status === 'Unqualified').length;
  const openValue = pipeline.reduce((s, p) => s + p.value, 0);

  const activeLeads = prospects.filter((p) => p.status === 'Lead' || p.status === 'Active Lead');
  const followUpLink = `/prospects?followup=1&sort=followUp${effectiveScope === 'mine' ? '&assigned=me' : ''}`;

  return (
    <div className="dashboard">
      <header className="page-head">
        <div>
          <h1>
            {greeting()}, {profile.displayName.split(' ')[0]}
          </h1>
          <span className="muted">
            {new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} · {business}
          </span>
        </div>
      </header>

      <div className="dash-grid">
        <div className="dash-col">
        <section className="panel dash-followups">
          <div className="panel-head">
            <h2>Follow-ups due</h2>
            <div className="seg small" role="group" aria-label="Whose follow-ups">
              {(['mine', 'everyone'] as Scope[]).map((s) => (
                <button key={s} type="button" aria-pressed={effectiveScope === s} className={effectiveScope === s ? 'on' : ''} onClick={() => chooseScope(s)}>
                  {s === 'mine' ? `Mine (${mineCount})` : `Everyone (${due.length})`}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : shown.length === 0 ? (
            <div className="empty compact">
              <strong>Nothing due this week.</strong>
              <span>{effectiveScope === 'mine' && due.length ? 'Switch to Everyone to see the team’s follow-ups.' : 'Set a follow-up date on a contact to see it here.'}</span>
            </div>
          ) : (
            groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.id} className="due-group">
                  <h3 className={`due-head due-${g.id === 'overdue' ? 'overdue' : g.id === 'today' ? 'today' : 'later'}`}>
                    {g.label} <span className="count-pill">{g.items.length}</span>
                  </h3>
                  <ul className="due-list">
                    {g.items.slice(0, 8).map((c) => {
                      const assignee = c.assignedTo ? peopleById[c.assignedTo] : undefined;
                      return (
                        <li key={c.id}>
                          <div className="due-main">
                            <Link to={`/contacts/${c.id}`} className="due-name">
                              {displayName(c)}
                            </Link>
                            <span className="muted small">
                              {[companyLabel(c), effectiveScope === 'everyone' && assignee ? assignee.displayName : ''].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          <div className="due-meta">
                            {c.isProspect && <span className={`tag s-${slug(c.status)}`}>{c.status}</span>}
                            <span className={`due due-${followUpState(c.followUpOn!)}`}>{formatDate(c.followUpOn!)}</span>
                          </div>
                          <div className="due-actions">
                            {c.phone && (
                              <a className="btn small" href={`tel:${c.phone.replace(/\D/g, '')}`} title={`Call ${c.phone}`}>
                                Call
                              </a>
                            )}
                            <button type="button" className="btn small" onClick={() => setScheduling(c)}>
                              Schedule
                            </button>
                            <button type="button" className="btn small primary" onClick={() => done(c)}>
                              Done
                            </button>
                            <select
                              className="snooze"
                              aria-label={`Snooze ${displayName(c)}`}
                              value=""
                              onChange={(e) => e.target.value && update(c.id, { followUpOn: addDays(Number(e.target.value)) })}
                            >
                              <option value="">Snooze…</option>
                              <option value="1">Tomorrow</option>
                              <option value="3">In 3 days</option>
                              <option value="7">Next week</option>
                            </select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {g.items.length > 8 && (
                    <Link className="link-btn" to={followUpLink}>
                      + {g.items.length - 8} more
                    </Link>
                  )}
                </div>
              ))
          )}
          <Link className="link-btn panel-foot" to={followUpLink}>
            All follow-ups →
          </Link>
        </section>

        <section className="panel dash-map">
          <div className="panel-head">
            <h2>Active leads</h2>
            <Link className="link-btn" to="/map">
              Open map →
            </Link>
          </div>
          <LeadsMap leads={activeLeads} />
          <span className="muted small">
            {activeLeads.length} Lead and Active Lead prospects · click a pin to open them
          </span>
        </section>
        </div>
        <div className="dash-col">
        <AgendaPanel refreshKey={agendaKey} />
        <section className="panel dash-pipeline">
          <div className="panel-head">
            <h2>Pipeline</h2>
            <span className="muted small">{prospects.length} prospects</span>
          </div>
          <div className="pipeline-total">
            <span className="hero-number">{formatMoney(openValue)}</span>
            <span className="muted small">deal value in the pipeline</span>
          </div>
          <ul className="pipeline-bars">
            {pipeline.map((p) => (
              <li key={p.status}>
                <Link to={`/prospects?status=${encodeURIComponent(p.status)}`} className="pipeline-row" title={`${p.count} ${p.status} · ${formatMoney(p.value)}`}>
                  <span className="pipeline-label">{p.status}</span>
                  <span className="pipeline-track" aria-hidden="true">
                    <span className="pipeline-bar" style={{ width: `${(p.count / maxCount) * 100}%` }} />
                  </span>
                  <span className="pipeline-count">{p.count}</span>
                  <span className="pipeline-value muted">{p.value ? formatMoney(p.value) : '—'}</span>
                </Link>
              </li>
            ))}
          </ul>
          {unqualified > 0 && (
            <Link className="link-btn small" to="/prospects?status=Unqualified">
              {unqualified} unqualified
            </Link>
          )}
        </section>

        <section className="panel dash-activity">
          <div className="panel-head">
            <h2>Recent activity</h2>
          </div>
          {feed.error ? (
            <p className="field-error">Couldn't load activity: {feed.error}</p>
          ) : !feed.items ? (
            <p className="muted">Loading…</p>
          ) : feed.items.length === 0 ? (
            <div className="empty compact">
              <strong>No activity yet.</strong>
              <span>Calls, notes and status changes from the team will appear here.</span>
            </div>
          ) : (
            <ul className="feed">
              {feed.items.map((a) => (
                <li key={a.id} className={`tl-${a.kind}`}>
                  <span className="feed-dot" aria-hidden="true" />
                  <div>
                    <div>
                      <strong>{a.createdBy ? peopleById[a.createdBy]?.displayName ?? 'Former user' : 'Hub'}</strong>{' '}
                      <span className="muted">{KIND_LABEL[a.kind].toLowerCase()}</span>{' '}
                      <Link to={`/contacts/${a.contactId}`}>{a.contactName || a.contactCompany || 'a contact'}</Link>
                      {a.kind === 'status_change' && <span className="muted"> · {a.body}</span>}
                    </div>
                    {a.body && a.kind !== 'status_change' && <p className="feed-body">{a.body}</p>}
                    <span className="muted small">{timeAgo(a.occurredAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        </div>
      </div>

      {scheduling && (
        <ScheduleDialog
          contact={scheduling}
          onClose={() => setScheduling(null)}
          onScheduled={async (_, followUpDay) => {
            const c = scheduling;
            if (followUpDay) await update(c.id, { followUpOn: followUpDay });
            touchActivity(c.id, new Date().toISOString());
            setAgendaKey((k) => k + 1);
            feed.reload();
          }}
        />
      )}
    </div>
  );
}

const SOUTHERN_ONTARIO: L.LatLngBoundsExpression = [
  [42.8, -81.4],
  [44.7, -77.8],
];
// One colour for every pin; the tooltip says which status each one is.
const leadIcon = L.divIcon({ className: '', html: '<div class="pin dot"></div>', iconSize: [0, 0] });

function FitLeads({ leads }: { leads: Contact[] }) {
  const map = useMap();
  const key = leads.map((l) => l.id).join();
  useEffect(() => {
    const pts = leads.flatMap((l) => l.properties.map((p) => [p.lat, p.lng] as [number, number]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [20, 20], maxZoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function LeadsMap({ leads }: { leads: Contact[] }) {
  const navigate = useNavigate();
  return (
    <MapContainer bounds={SOUTHERN_ONTARIO} className="dash-mini-map" scrollWheelZoom={false} attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitLeads leads={leads} />
      {leads.flatMap((l) =>
        l.properties.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={leadIcon}
            eventHandlers={{ click: () => navigate(`/contacts/${l.id}`) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <strong>{displayName(l)}</strong> · {l.status}
              {l.dealValue ? ` · ${formatMoney(l.dealValue)}` : ''}
            </Tooltip>
          </Marker>
        )),
      )}
    </MapContainer>
  );
}
