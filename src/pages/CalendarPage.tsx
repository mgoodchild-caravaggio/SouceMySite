import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { ScheduleDialog } from '../components/ScheduleDialog';
import {
  addDays,
  addMinutes,
  cancelEvent,
  createEvent,
  fetchEvents,
  formatWallTime,
  minutesOfDay,
  respondToEvent,
  updateEvent,
  wallFromDate,
  weekdayOf,
  type OutlookEvent,
} from '../lib/calendar';
import { companyLabel, displayName } from '../lib/filters';
import { connectionFor, connectOutlook, useOutlookConnections } from '../lib/outlook';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types';

type View = 'day' | 'week' | 'month' | 'list';
const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'list', label: 'List' },
];
const HOUR_PX = 48;
const LIST_DAYS = 14;
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', opts).format(new Date(`${day}T12:00:00`));
/** Sunday on or before a day. */
const weekStart = (day: string) => addDays(day, -weekdayOf(day));

/** The days a view shows, and the range of events to load. */
function rangeFor(view: View, anchor: string) {
  if (view === 'day') return { days: [anchor], from: anchor, to: addDays(anchor, 1) };
  if (view === 'week') {
    const s = weekStart(anchor);
    return { days: Array.from({ length: 7 }, (_, i) => addDays(s, i)), from: s, to: addDays(s, 7) };
  }
  if (view === 'list') return { days: Array.from({ length: LIST_DAYS }, (_, i) => addDays(anchor, i)), from: anchor, to: addDays(anchor, LIST_DAYS) };
  // Month: whole weeks covering the month.
  const first = `${anchor.slice(0, 8)}01`;
  const s = weekStart(first);
  const nextMonth = addDays(first, 32).slice(0, 8) + '01';
  const weeks = Math.ceil((Date.parse(nextMonth) - Date.parse(s)) / (7 * 86_400_000));
  return { days: Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i)), from: s, to: addDays(s, weeks * 7) };
}

function titleFor(view: View, anchor: string, days: string[]) {
  if (view === 'day') return dayLabel(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return dayLabel(anchor, { month: 'long', year: 'numeric' });
  const a = days[0];
  const b = days[days.length - 1];
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  // e.g. "Nov 22 – 28, 2026" or "Nov 29 – Dec 5, 2026"
  const endPart = sameMonth ? String(Number(b.slice(8))) : dayLabel(b, { month: 'short', day: 'numeric' });
  return `${dayLabel(a, { month: 'short', day: 'numeric' })} – ${endPart}, ${b.slice(0, 4)}`;
}

/** Does an event touch a day? (All-day ends are exclusive.) */
const touchesDay = (e: OutlookEvent, day: string) => {
  const s = e.start.slice(0, 10);
  const end = e.end.slice(0, 10);
  if (e.allDay) return s <= day && day < end;
  return s <= day && (day < end || (day === end && e.end.slice(11) !== '00:00') || s === day);
};

/** Side-by-side columns for overlapping timed events in one day. */
function layoutDay(events: OutlookEvent[], day: string) {
  const items = events
    .map((e) => {
      const top = e.start.slice(0, 10) < day ? 0 : minutesOfDay(e.start);
      const bottom = e.end.slice(0, 10) > day ? 1440 : minutesOfDay(e.end);
      return { e, top, bottom: Math.max(bottom, top + 20) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const out: { e: OutlookEvent; top: number; bottom: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.bottom > it.top).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  if (cluster.length) flush();
  return out;
}

const eventClass = (e: OutlookEvent, hub: boolean) =>
  [
    'cal-ev',
    hub ? 'ev-hub' : '',
    e.showAs === 'free' ? 'ev-free' : '',
    e.showAs === 'tentative' || e.myResponse === 'tentativelyAccepted' ? 'ev-tentative' : '',
    e.myResponse === 'notResponded' ? 'ev-pending' : '',
    e.myResponse === 'declined' ? 'ev-declined' : '',
  ]
    .filter(Boolean)
    .join(' ');

/**
 * Your Outlook calendar in Hub: see it by day, week, month or as a list, and add, change or cancel events.
 * It's the calendar of the business picked in the sidebar: Real Estate and Staging have separate mailboxes.
 */
export default function CalendarPage() {
  const { profile, people, business } = useSession();
  const { contacts } = useContacts();
  const { connections } = useOutlookConnections();
  const [params, setParams] = useSearchParams();
  const conn = connectionFor(connections, profile.id, business);
  const today = wallFromDate(new Date()).slice(0, 10);

  const view: View = (VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : isPhone() ? 'day' : 'week') as View;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today;
  const { days, from, to } = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const go = (patch: { view?: View; date?: string }) => {
    const next = new URLSearchParams(params);
    if (patch.view) next.set('view', patch.view);
    if (patch.date) {
      if (patch.date === today) next.delete('date');
      else next.set('date', patch.date);
    }
    setParams(next, { replace: true });
  };
  const step = (dir: 1 | -1) => {
    if (view === 'day') go({ date: addDays(anchor, dir) });
    else if (view === 'week') go({ date: addDays(anchor, 7 * dir) });
    else if (view === 'list') go({ date: addDays(anchor, LIST_DAYS * dir) });
    else {
      const d = new Date(`${anchor.slice(0, 8)}01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + dir);
      go({ date: d.toISOString().slice(0, 10) });
    }
  };

  // ---- Events ----
  const [events, setEvents] = useState<OutlookEvent[] | null>(null);
  const [hubEvents, setHubEvents] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // A different business is a different mailbox: don't show the old one's events meanwhile.
  useEffect(() => {
    setEvents(null);
    setHubEvents(new Map());
  }, [business]);

  useEffect(() => {
    if (!conn || conn.lastError) return;
    let cancelled = false;
    setError('');
    fetchEvents(business, `${from}T00:00`, `${to}T00:00`)
      .then(async (r) => {
        if (cancelled) return;
        setEvents(r.events);
        const ids = r.events.map((e) => e.id);
        if (!ids.length) return setHubEvents(new Map());
        const { data } = await supabase.from('meetings').select('outlook_event_id, contact_id').in('outlook_event_id', ids).eq('status', 'scheduled');
        if (!cancelled) setHubEvents(new Map((data ?? []).map((m) => [m.outlook_event_id as string, m.contact_id as string])));
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [conn, business, from, to, reloadKey]);

  // Keep it fresh when you come back to the tab (e.g. after accepting something in Outlook).
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [reload]);

  // Teammates are on lots of invites; their addresses (and connected mailboxes) are never matched to contact records.
  const teamEmails = useMemo(
    () => new Set([...people.map((p) => p.email.toLowerCase()), ...(connections ?? []).map((c) => c.mailbox.toLowerCase())]),
    [people, connections],
  );
  const byEmail = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) if (c.email && !teamEmails.has(c.email.toLowerCase())) map.set(c.email.toLowerCase(), c);
    return map;
  }, [contacts, teamEmails]);
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const contactsFor = useCallback(
    (e: OutlookEvent): Contact[] => {
      const found: Contact[] = [];
      const hubContact = byId.get(hubEvents.get(e.id) ?? '');
      if (hubContact) found.push(hubContact);
      for (const email of e.emails) {
        const c = byEmail.get(email);
        if (c && !found.includes(c)) found.push(c);
      }
      return found;
    },
    [byEmail, byId, hubEvents],
  );

  // ---- Dialogs ----
  const [selected, setSelected] = useState<OutlookEvent | null>(null);
  const [form, setForm] = useState<{ event?: OutlookEvent; date: string; time: string } | null>(null);
  const [booking, setBooking] = useState<{ contact: Contact; date: string; time: string } | null>(null);

  const newAt = (day: string, minutes = 9 * 60) => {
    const m = Math.min(Math.max(0, Math.round(minutes / 30) * 30), 23 * 60);
    setForm({ date: day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
  };

  // ---- Not connected ----
  if (connections && (!conn || conn.lastError)) {
    return (
      <div className="detail-page calendar-page">
        <header className="page-head">
          <h1>Calendar</h1>
        </header>
        <div className="panel">
          <p>
            <strong>
              {conn?.lastError ? `Your ${business} mailbox connection needs to be renewed.` : `Connect your ${business} mailbox to see its calendar here.`}
            </strong>
          </p>
          <p className="muted small">
            Hub shows your Microsoft 365 calendar, and adds and changes events in it. Nothing is copied out of Outlook. Real Estate and Staging use
            separate mailboxes; switch business in the sidebar to see the other calendar.
          </p>
          <div>
            <button type="button" className="btn primary" onClick={() => connectOutlook(business).catch((e) => setError((e as Error).message))}>
              {conn?.lastError ? `Reconnect ${business} mailbox` : `Connect ${business} mailbox`}
            </button>{' '}
            <Link to="/settings#outlook" className="link-btn">
              Outlook settings
            </Link>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      </div>
    );
  }

  const title = titleFor(view, anchor, days);

  return (
    <div className="calendar-page">
      <header className="cal-head">
        <div className="cal-title">
          <h1>Calendar</h1>
          <span className="muted cal-range">{title}</span>
          {conn && <span className="muted small cal-mailbox" title={`${business} calendar`}>{conn.mailbox}</span>}
        </div>
        <div className="cal-controls">
          <button type="button" className="btn small" onClick={() => go({ date: today })} disabled={days.includes(today) && view !== 'month'}>
            Today
          </button>
          <div className="cal-step">
            <button type="button" className="icon-btn cal-arrow" onClick={() => step(-1)} aria-label="Previous">
              ‹
            </button>
            <button type="button" className="icon-btn cal-arrow" onClick={() => step(1)} aria-label="Next">
              ›
            </button>
          </div>
          <div className="seg small" role="group" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => go({ view: v.id })}>
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn small primary" onClick={() => newAt(days.includes(today) ? today : days[0], Math.min(minutesOfDay(wallFromDate(new Date())) + 60, 17 * 60))}>
            + New event
          </button>
        </div>
      </header>
      {error && <p className="notice warn cal-notice">{error}</p>}

      {events === null && !error ? (
        <p className="muted cal-notice">Loading your calendar…</p>
      ) : view === 'month' ? (
        <MonthGrid days={days} month={anchor.slice(0, 7)} today={today} events={events ?? []} hubEvents={hubEvents} onEvent={setSelected} onDay={(d) => go({ view: 'day', date: d })} onNew={newAt} />
      ) : view === 'list' ? (
        <ListView days={days} today={today} events={events ?? []} hubEvents={hubEvents} contactsFor={contactsFor} onEvent={setSelected} onNew={newAt} />
      ) : (
        <TimeGrid days={days} today={today} events={events ?? []} hubEvents={hubEvents} contactsFor={contactsFor} onEvent={setSelected} onNew={newAt} onDay={(d) => go({ view: 'day', date: d })} />
      )}

      {selected && (
        <EventDetails
          e={selected}
          hubContact={byId.get(hubEvents.get(selected.id) ?? '')}
          contacts={contactsFor(selected)}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setForm({ event: selected, date: selected.start.slice(0, 10), time: selected.start.slice(11, 16) });
            setSelected(null);
          }}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
      {form && (
        <EventForm
          event={form.event}
          date={form.date}
          time={form.time}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
          onWithContact={(contact, date, time) => {
            setForm(null);
            setBooking({ contact, date, time });
          }}
        />
      )}
      {booking && (
        <ScheduleDialog
          contact={booking.contact}
          initialDate={booking.date}
          initialTime={booking.time}
          onClose={() => setBooking(null)}
          onScheduled={() => {
            setBooking(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

interface GridProps {
  days: string[];
  today: string;
  events: OutlookEvent[];
  hubEvents: Map<string, string>;
  contactsFor: (e: OutlookEvent) => Contact[];
  onEvent: (e: OutlookEvent) => void;
  onNew: (day: string, minutes?: number) => void;
  onDay: (day: string) => void;
}

/** Day and week views: an hour grid with all-day events on top and a line at the current time. */
function TimeGrid({ days, today, events, hubEvents, contactsFor, onEvent, onNew, onDay }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => minutesOfDay(wallFromDate(new Date())));
  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesOfDay(wallFromDate(new Date()))), 60_000);
    return () => clearInterval(t);
  }, []);
  // Open at 7 a.m. (or an hour before now, if that's later and it's today).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Today: keep "now" about a third of the way down; other days start at 7 a.m.
    const visible = (el.clientHeight / HOUR_PX) * 60;
    const start = days.includes(today) ? Math.max(7 * 60, nowMin - visible / 3) : 7 * 60;
    el.scrollTop = (start / 60) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join()]);

  const allDay = (d: string) => events.filter((e) => e.allDay && touchesDay(e, d));
  const timed = (d: string) => events.filter((e) => !e.allDay && touchesDay(e, d));
  const hasAllDay = days.some((d) => allDay(d).length);
  const single = days.length === 1;

  return (
    <div className={`cal-grid ${single ? 'single' : ''}`} style={{ ['--cols' as string]: days.length }}>
      <div className="cal-days">
        <div className="cal-gutter" />
        {days.map((d) => (
          <button key={d} type="button" className={`cal-dayhead ${d === today ? 'today' : ''}`} onClick={() => onDay(d)} disabled={single}>
            <span className="dow">{dayLabel(d, { weekday: 'short' })}</span>
            <span className="dnum">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="cal-allday">
          <div className="cal-gutter small muted">All day</div>
          {days.map((d) => (
            <div key={d} className="cal-allday-cell">
              {allDay(d).map((e) => (
                <button key={e.id} type="button" className={eventClass(e, hubEvents.has(e.id))} onClick={() => onEvent(e)}>
                  {e.subject}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="cal-body" ref={scroller}>
        <div className="cal-hours" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour-label" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : formatWallTime(`2000-01-01T${String(h).padStart(2, '0')}:00`).replace(':00', '')}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={`cal-col ${d === today ? 'today' : ''}`}
              onClick={(ev) => {
                if (ev.target !== ev.currentTarget) return;
                const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                onNew(d, Math.floor(((y / HOUR_PX) * 60) / 30) * 30);
              }}
              title="Click to add an event"
            >
              {layoutDay(timed(d), d).map(({ e, top, bottom, col, cols }) => {
                const who = contactsFor(e)[0];
                const short = bottom - top < 45;
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`${eventClass(e, hubEvents.has(e.id))} timed ${short ? 'short' : ''}`}
                    style={{ top: (top / 60) * HOUR_PX, height: ((bottom - top) / 60) * HOUR_PX - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                    onClick={() => onEvent(e)}
                    title={`${e.subject} · ${formatWallTime(e.start)}–${formatWallTime(e.end)}${e.location ? ` · ${e.location}` : ''}`}
                  >
                    <span className="ev-title">{e.subject}</span>
                    {!short && (
                      <span className="ev-meta">
                        {formatWallTime(e.start)}
                        {who ? ` · ${displayName(who)}` : e.location ? ` · ${e.location}` : ''}
                      </span>
                    )}
                  </button>
                );
              })}
              {d === today && <div className="cal-now" style={{ top: (nowMin / 60) * HOUR_PX }} aria-hidden="true" />}
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="cal-line" style={{ top: h * HOUR_PX }} aria-hidden="true" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Month view: each day with its first few events; click the date to open the day. */
function MonthGrid({
  days,
  month,
  today,
  events,
  hubEvents,
  onEvent,
  onDay: openDay,
  onNew,
}: Omit<GridProps, 'contactsFor'> & { month: string }) {
  const MAX = 3;
  return (
    <div className="cal-month">
      {days.slice(0, 7).map((d) => (
        <div key={d} className="cal-month-dow muted small">
          {dayLabel(d, { weekday: 'short' })}
        </div>
      ))}
      {days.map((d) => {
        const list = events.filter((e) => touchesDay(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
        return (
          <div key={d} className={`cal-month-cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''}`} onClick={(ev) => ev.target === ev.currentTarget && onNew(d)}>
            <button type="button" className="cal-month-num" onClick={() => openDay(d)} aria-label={`Open ${dayLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
              {Number(d.slice(8))}
            </button>
            {list.slice(0, MAX).map((e) => (
              <button key={e.id} type="button" className={`${eventClass(e, hubEvents.has(e.id))} chip`} onClick={() => onEvent(e)} title={e.subject}>
                {!e.allDay && <span className="ev-time">{formatWallTime(e.start).replace(':00', '').replace(/\s?[ap]\.m\./, (m) => m.trim()[0])}</span>} {e.subject}
              </button>
            ))}
            {list.length > MAX && (
              <button type="button" className="link-btn small cal-more" onClick={() => openDay(d)}>
                +{list.length - MAX} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** List view: the next two weeks, day by day. Best on a phone. */
function ListView({ days, today, events, hubEvents, contactsFor, onEvent, onNew }: Omit<GridProps, 'onDay'>) {
  return (
    <div className="cal-list">
      {days.map((d) => {
        const list = events.filter((e) => touchesDay(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
        return (
          <section key={d} className={`cal-list-day ${d === today ? 'today' : ''}`}>
            <div className="cal-list-head">
              <h2>{d === today ? 'Today' : dayLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
              <button type="button" className="link-btn small" onClick={() => onNew(d)}>
                + Add
              </button>
            </div>
            {list.length === 0 ? (
              <p className="muted small">Nothing scheduled</p>
            ) : (
              <ul>
                {list.map((e) => {
                  const who = contactsFor(e);
                  return (
                    <li key={e.id}>
                      <button type="button" className={`${eventClass(e, hubEvents.has(e.id))} row`} onClick={() => onEvent(e)}>
                        <span className="ev-when">{e.allDay ? 'All day' : `${formatWallTime(e.start)} – ${formatWallTime(e.end)}`}</span>
                        <span className="ev-title">{e.subject}</span>
                        {(who.length > 0 || e.location) && <span className="ev-meta">{who.length ? who.map(displayName).join(', ') : e.location}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const RESPONSE_LABEL: Record<string, string> = {
  accepted: 'Accepted',
  tentativelyAccepted: 'Tentative',
  declined: 'Declined',
  notResponded: 'No reply yet',
  none: 'No reply yet',
  organizer: 'Organizer',
};

/** One event: when, where, who (linked to Hub contacts), and what you can do with it. */
function EventDetails({
  e,
  hubContact,
  contacts,
  onClose,
  onEdit,
  onChanged,
}: {
  e: OutlookEvent;
  hubContact?: Contact;
  contacts: Contact[];
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { people, business } = useSession();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState('');
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const teammate = (email: string) => people.find((p) => p.email.toLowerCase() === email);
  const isInvite = e.isOrganizer === false;
  const hasAttendees = (e.attendees?.length ?? 0) > 0;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  const when = e.allDay
    ? e.end.slice(0, 10) > addDays(e.start.slice(0, 10), 1)
      ? `${dayLabel(e.start.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })} – ${dayLabel(addDays(e.end.slice(0, 10), -1), { weekday: 'short', month: 'short', day: 'numeric' })} · all day`
      : `${dayLabel(e.start.slice(0, 10), { weekday: 'long', month: 'long', day: 'numeric' })} · all day`
    : `${dayLabel(e.start.slice(0, 10), { weekday: 'long', month: 'long', day: 'numeric' })} · ${formatWallTime(e.start)} – ${formatWallTime(e.end)}${
        e.end.slice(0, 10) !== e.start.slice(0, 10) ? ` (${dayLabel(e.end.slice(0, 10), { month: 'short', day: 'numeric' })})` : ''
      }`;

  return (
    <Dialog
      title={e.subject}
      onClose={onClose}
      footer={
        <div className="cal-actions">
          {isInvite ? (
            <>
              {(['accept', 'tentative', 'decline'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`btn small ${r === 'accept' ? 'primary' : ''} ${(r === 'accept' && e.myResponse === 'accepted') || (r === 'tentative' && e.myResponse === 'tentativelyAccepted') ? 'on' : ''}`}
                  disabled={!!busy}
                  onClick={() => run(r, () => respondToEvent(business, e.id, r))}
                >
                  {busy === r ? '…' : r === 'accept' ? 'Accept' : r === 'tentative' ? 'Tentative' : 'Decline'}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" className="btn small" onClick={onEdit} disabled={!!busy}>
                Edit
              </button>
              <button type="button" className="btn small danger-outline" onClick={() => setConfirming(true)} disabled={!!busy}>
                {hasAttendees ? 'Cancel meeting' : 'Delete'}
              </button>
            </>
          )}
          <a className="link-btn small" href={e.webLink} target="_blank" rel="noopener noreferrer">
            Open in Outlook
          </a>
        </div>
      }
    >
      <div className="ev-details">
        <p className="ev-when-line">
          <strong>{when}</strong>
          {e.recurring && <span className="tag">Repeats</span>}
          {e.showAs === 'free' && <span className="tag">Shown as free</span>}
          {isInvite && e.myResponse && <span className="tag">{RESPONSE_LABEL[e.myResponse] ?? e.myResponse}</span>}
        </p>
        {e.location && <p className="small">📍 {e.location}</p>}
        {e.joinUrl && (
          <p>
            <a className="btn small primary" href={e.joinUrl} target="_blank" rel="noopener noreferrer">
              Join Teams meeting
            </a>
          </p>
        )}
        {(hubContact || contacts.length > 0) && (
          <div className="ev-contacts">
            <span className="muted small">{hubContact ? 'Booked in Hub with' : 'Hub contacts on this'}</span>
            {(hubContact ? [hubContact, ...contacts.filter((c) => c !== hubContact)] : contacts).map((c) => (
              <Link key={c.id} to={`/contacts/${c.id}`} className="ev-contact">
                <strong>{displayName(c)}</strong>
                {companyLabel(c) && <span className="muted small"> · {companyLabel(c)}</span>}
              </Link>
            ))}
          </div>
        )}
        {e.organizer && !e.isOrganizer && (
          <p className="small">
            <span className="muted">Organizer:</span> {e.organizer.name || e.organizer.email}
          </p>
        )}
        {hasAttendees && (
          <div className="small">
            <span className="muted">Invited</span>
            <ul className="ev-people">
              {e.attendees!.map((a) => {
                const c = byEmail.get(a.email);
                const t = teammate(a.email);
                return (
                  <li key={a.email}>
                    {t ? <span>{t.displayName}</span> : c ? <Link to={`/contacts/${c.id}`}>{displayName(c)}</Link> : <span>{a.name || a.email}</span>}
                    <span className={`muted resp-${a.response}`}> · {RESPONSE_LABEL[a.response] ?? a.response}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {e.preview && <p className="ev-preview small">{e.preview}</p>}
        {confirming && (
          <div className="notice warn small ev-confirm">
            <p>
              {hasAttendees ? 'Cancel this meeting? Everyone invited is sent a cancellation.' : 'Delete this event from your calendar?'}
              {e.recurring && ' Only this occurrence is affected.'}
            </p>
            {hasAttendees && <input value={comment} onChange={(x) => setComment(x.target.value)} placeholder="Message to attendees (optional)" maxLength={500} />}
            <div className="inline-actions">
              <button type="button" className="btn small danger" disabled={!!busy} onClick={() => run('cancel', () => cancelEvent(business, e.id, comment))}>
                {busy === 'cancel' ? 'Working…' : hasAttendees ? 'Cancel meeting' : 'Delete'}
              </button>
              <button type="button" className="link-btn small" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Add an event, or change an existing one's title, time, place and notes. */
function EventForm({
  event,
  date,
  time,
  onClose,
  onSaved,
  onWithContact,
}: {
  event?: OutlookEvent;
  date: string;
  time: string;
  onClose: () => void;
  onSaved: () => void;
  onWithContact: (c: Contact, date: string, time: string) => void;
}) {
  const { profile, people, business } = useSession();
  const { contacts, loading } = useContacts();
  const editing = !!event;
  const startMinutes = event && !event.allDay ? minutesOfDay(event.end) - minutesOfDay(event.start) : 60;
  const [subject, setSubject] = useState(event?.subject ?? '');
  const [day, setDay] = useState(date);
  const [start, setStart] = useState(event && !event.allDay ? event.start.slice(11, 16) : time);
  const [end, setEnd] = useState(event && !event.allDay ? event.end.slice(11, 16) : addMinutes(`${date}T${time}`, 60).slice(11, 16));
  const [endDay, setEndDay] = useState(event?.allDay ? addDays(event.end.slice(0, 10), -1) : (event?.end.slice(0, 10) ?? date));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState('');
  const [notesTouched, setNotesTouched] = useState(false);
  const [mates, setMates] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState('');
  const [teams, setTeams] = useState(false);
  const [free, setFree] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Moving the start keeps the length the same.
  const moveStart = (v: string) => {
    const length = Math.max(15, minutesOfDay(`${day}T${end}`) - minutesOfDay(`${day}T${start}`) || startMinutes);
    setStart(v);
    if (/^\d{2}:\d{2}$/.test(v)) setEnd(addMinutes(`${day}T${v}`, length).slice(11, 16));
  };

  const teammates = people.filter((p) => p.id !== profile.id);
  const matches = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    // This business's contacts: a meeting with one goes in this business's mailbox.
    return contacts.filter((c) => !c.archivedAt && c.business === business && `${displayName(c)} ${c.company} ${c.phone} ${c.email ?? ''}`.toLowerCase().includes(q)).slice(0, 6);
  }, [contactSearch, contacts, business]);

  async function save() {
    setError('');
    if (!subject.trim()) return setError('Add a title.');
    const s = allDay ? `${day}T00:00` : `${day}T${start}`;
    const en = allDay ? `${addDays(endDay < day ? day : endDay, 1)}T00:00` : `${endDay < day ? day : endDay}T${end}`;
    if (!allDay && en <= s) return setError('The end must be after the start.');
    setSaving(true);
    try {
      if (editing) {
        await updateEvent(business, event!.id, { subject, start: s, end: en, allDay, location, ...(notesTouched && { notes }) });
      } else {
        const extra = emails
          .split(/[\s,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        await createEvent(business, { subject, start: s, end: en, allDay, location, notes, teammateIds: [...mates], emails: extra, teams, showAs: free ? 'free' : 'busy' });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={editing ? 'Edit event' : 'New event'}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add to calendar'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field span-2">
          <span>Title</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Lunch with Eric, Council meeting" maxLength={200} autoFocus />
        </label>
        <div className="when-row span-2">
          <label className="field">
            <span>{allDay ? 'From' : 'Date'}</span>
            <input
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                if (endDay < e.target.value || !allDay) setEndDay(e.target.value);
              }}
            />
          </label>
          {allDay ? (
            <label className="field">
              <span>To</span>
              <input type="date" value={endDay} min={day} onChange={(e) => setEndDay(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="field">
                <span>Starts</span>
                <input type="time" value={start} step={900} onChange={(e) => moveStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Ends</span>
                <input type="time" value={end} step={900} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <label className="check-field span-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>All day</span>
        </label>
        <label className="field span-2">
          <span>Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address, office or phone" maxLength={300} />
        </label>

        {!editing && (
          <>
            {teammates.length > 0 && (
              <div className="field span-2">
                <span>Invite teammates</span>
                <div className="chip-group">
                  {teammates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`chip-toggle ${mates.has(t.id) ? 'on' : ''}`}
                      aria-pressed={mates.has(t.id)}
                      onClick={() =>
                        setMates((m) => {
                          const n = new Set(m);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        })
                      }
                    >
                      {t.displayName}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="field span-2">
              <span>Other people to invite (emails)</span>
              <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, other@example.com" inputMode="email" />
            </label>
            {(mates.size > 0 || emails.trim()) && (
              <label className="check-field span-2">
                <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} />
                <span>Add a Teams meeting link</span>
              </label>
            )}
            <label className="check-field span-2">
              <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
              <span>Show me as free (a reminder, not a booking)</span>
            </label>
          </>
        )}
        <label className="field span-2">
          <span>Notes {editing && <span className="muted">(leave empty to keep what's in Outlook)</span>}</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesTouched(true);
            }}
            placeholder={editing ? '' : 'Agenda, directions, what to bring'}
          />
        </label>
        {editing && (event!.attendees?.length ?? 0) > 0 && <p className="muted small span-2">Everyone invited is sent the update. To change who's invited, use Outlook.</p>}
        {editing && event!.recurring && <p className="muted small span-2">This changes only this occurrence.</p>}

        {!editing && (
          <div className="field span-2 with-contact">
            <span>Is this with a Hub contact?</span>
            <input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder={loading ? 'Loading contacts…' : 'Search a name to book it on their timeline'} />
            {matches.length > 0 && (
              <ul className="pick-list">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="pick-row" onClick={() => onWithContact(c, day, start)}>
                      <span>
                        <strong>{displayName(c)}</strong>
                        {companyLabel(c) && <span className="muted"> · {companyLabel(c)}</span>}
                      </span>
                      <span className="link-btn small">Book with them</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className="muted small">Booking with a contact opens the call / meeting / site visit form, which checks free/busy and logs it on their timeline.</span>
          </div>
        )}
        {error && <p className="field-error span-2">{error}</p>}
      </div>
    </Dialog>
  );
}

