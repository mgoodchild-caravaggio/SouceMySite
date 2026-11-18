import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addMinutes, fetchEvents, formatWallDay, formatWallTime, wallFromDate, type OutlookEvent } from '../lib/calendar';
import { displayName } from '../lib/filters';
import { useOutlookConnections } from '../lib/outlook';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';

/** Your Outlook meetings for today and the next few days, linked to Hub contacts by email. */
export function AgendaPanel({ days = 4, refreshKey = 0 }: { days?: number; refreshKey?: number }) {
  const { profile } = useSession();
  const { contacts } = useContacts();
  const { connections } = useOutlookConnections();
  const conn = connections?.find((c) => c.userId === profile.id);
  const [events, setEvents] = useState<OutlookEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!conn || conn.lastError) return;
    const today = wallFromDate(new Date()).slice(0, 10);
    let cancelled = false;
    fetchEvents(`${today}T00:00`, addMinutes(`${today}T00:00`, days * 24 * 60))
      .then((r) => !cancelled && setEvents(r.events))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [conn, days, refreshKey]);

  const byEmail = useMemo(() => {
    const map = new Map<string, (typeof contacts)[number]>();
    for (const c of contacts) if (c.email) map.set(c.email.toLowerCase(), c);
    return map;
  }, [contacts]);

  const now = wallFromDate(new Date());
  const upcoming = (events ?? []).filter((e) => e.allDay || e.end > now);
  const groups = upcoming.reduce<Record<string, OutlookEvent[]>>((acc, e) => {
    (acc[e.start.slice(0, 10)] ??= []).push(e);
    return acc;
  }, {});
  const today = now.slice(0, 10);
  const tomorrow = addMinutes(`${today}T00:00`, 1440).slice(0, 10);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Upcoming meetings</h2>
        {conn && !conn.lastError && <span className="muted small">Next {days} days · Outlook</span>}
      </div>
      {connections === null ? (
        <p className="muted">Loading…</p>
      ) : !conn ? (
        <p className="muted">
          <Link to="/settings">Connect Outlook</Link> to see your meetings here and schedule from Hub.
        </p>
      ) : conn.lastError ? (
        <p className="notice warn">
          Outlook needs reconnecting. <Link to="/settings">Go to Settings →</Link>
        </p>
      ) : error ? (
        <p className="field-error">Couldn't load your calendar: {error}</p>
      ) : !events ? (
        <p className="muted">Loading your calendar…</p>
      ) : upcoming.length === 0 ? (
        <div className="empty compact">
          <strong>No meetings in the next {days} days.</strong>
          <span>Use Schedule on a contact or follow-up to book one.</span>
        </div>
      ) : (
        Object.entries(groups).map(([day, list]) => (
          <div key={day}>
            <h3 className="agenda-day">{day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : formatWallDay(day)}</h3>
            <ul className="agenda">
              {list.map((e) => {
                const linked = [...new Set(e.emails)].map((m) => byEmail.get(m)).filter((c): c is NonNullable<typeof c> => !!c);
                return (
                  <li key={e.id}>
                    <span className="a-time">{e.allDay ? 'All day' : `${formatWallTime(e.start)}`}</span>
                    <div>
                      <div className="a-title">{e.subject}</div>
                      {e.location && <div className="muted small">{e.location}</div>}
                      <div className="a-links">
                        {linked.map((c) => (
                          <Link key={c.id} to={`/contacts/${c.id}`}>
                            {displayName(c)}
                          </Link>
                        ))}
                        {e.joinUrl && (
                          <a href={e.joinUrl} target="_blank" rel="noreferrer">
                            Join Teams
                          </a>
                        )}
                        <a href={e.webLink} target="_blank" rel="noreferrer" className="muted">
                          Open in Outlook
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
