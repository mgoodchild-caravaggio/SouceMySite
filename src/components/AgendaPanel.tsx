import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addMinutes, fetchCombinedEvents, formatWallDay, formatWallTime, wallFromDate, type OutlookEvent } from '../lib/calendar';
import { displayName } from '../lib/filters';
import { connectionFor, useOutlookConnections, workingConnections } from '../lib/outlook';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { Business, Contact } from '../types';

/**
 * Your Outlook meetings for today and the next few days, from every mailbox you've connected (Real Estate and
 * Staging together, each marked when there are two). Each one is linked to its Hub contact:
 * meetings scheduled from Hub by the meeting itself, others by matching attendee email addresses.
 * Clicking a linked meeting opens that contact's Meetings panel, where it can be cancelled.
 */
export function AgendaPanel({ days = 4, refreshKey = 0 }: { days?: number; refreshKey?: number }) {
  const { profile, people, business } = useSession();
  const { contacts } = useContacts();
  const { connections } = useOutlookConnections();
  const navigate = useNavigate();
  const conn = connectionFor(connections, profile.id, business);
  const mine = useMemo(() => workingConnections(connections, profile.id), [connections, profile.id]);
  const mineKey = mine.map((c) => c.business).join('|');
  const overlay = mine.length > 1;
  const [events, setEvents] = useState<OutlookEvent[] | null>(null);
  // Outlook event id → contact id, for meetings booked through Hub.
  const [hubEvents, setHubEvents] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mineKey) return;
    const today = wallFromDate(new Date()).slice(0, 10);
    let cancelled = false;
    fetchCombinedEvents(mineKey.split('|') as Business[], `${today}T00:00`, addMinutes(`${today}T00:00`, days * 24 * 60))
      .then(async ({ events: all, problems }) => {
        if (cancelled) return;
        setError(problems.join(' · '));
        setEvents(all);
        const ids = all.map((e) => e.id);
        if (!ids.length) return;
        const { data } = await supabase.from('meetings').select('outlook_event_id, contact_id').in('outlook_event_id', ids).eq('status', 'scheduled');
        if (!cancelled) setHubEvents(new Map((data ?? []).map((m) => [m.outlook_event_id as string, m.contact_id as string])));
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [mineKey, days, refreshKey]);

  // Teammates are on lots of invites; their addresses (and connected mailboxes) are never matched to contact records.
  const byEmail = useMemo(() => {
    const team = new Set([...people.map((p) => p.email.toLowerCase()), ...(connections ?? []).map((c) => c.mailbox.toLowerCase())]);
    const map = new Map<string, Contact>();
    for (const c of contacts) if (c.email && !team.has(c.email.toLowerCase())) map.set(c.email.toLowerCase(), c);
    return map;
  }, [contacts, people, connections]);
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  /** The contacts a meeting belongs to: the Hub booking's contact first, then any attendee matches. */
  const contactsFor = (e: OutlookEvent): Contact[] => {
    const found: Contact[] = [];
    const hubContact = hubEvents.get(e.id);
    if (hubContact && byId.get(hubContact)) found.push(byId.get(hubContact)!);
    for (const email of e.emails) {
      const c = byEmail.get(email);
      if (c && !found.includes(c)) found.push(c);
    }
    return found;
  };

  const now = wallFromDate(new Date());
  const upcoming = (events ?? []).filter((e) => e.allDay || e.end > now);
  const groups = upcoming.reduce<Record<string, OutlookEvent[]>>((acc, e) => {
    (acc[e.start.slice(0, 10)] ??= []).push(e);
    return acc;
  }, {});
  const today = now.slice(0, 10);
  const tomorrow = addMinutes(`${today}T00:00`, 1440).slice(0, 10);
  const contactUrl = (c: Contact) => `/contacts/${c.id}#meetings`;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Upcoming meetings</h2>
        {mine.length > 0 && (
          <span className="muted small">
            Next {days} days · {overlay ? 'Real Estate and Staging' : mine[0].mailbox}
          </span>
        )}
      </div>
      {events && error && <p className="notice warn small">Couldn't load your {error}</p>}
      {connections === null ? (
        <p className="muted">Loading…</p>
      ) : !mine.length ? (
        conn?.lastError ? (
          <p className="notice warn">
            Your {business} mailbox needs reconnecting. <Link to="/settings#outlook">Go to Settings →</Link>
          </p>
        ) : (
          <p className="muted">
            <Link to="/settings#outlook">Connect your {business} mailbox</Link> to see its meetings here and schedule from Hub.
          </p>
        )
      ) : !events ? (
        error ? <p className="field-error">Couldn't load your calendar: {error}</p> : <p className="muted">Loading your calendar…</p>
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
                const linked = contactsFor(e);
                const primary = linked[0];
                return (
                  <li
                    key={e.id}
                    className={primary ? 'linked' : ''}
                    // The whole row opens the contact; inner links keep their own targets.
                    onClick={(ev) => primary && !(ev.target as HTMLElement).closest('a') && navigate(contactUrl(primary))}
                  >
                    <span className="a-time">
                      {overlay && e.business && <span className={`cal-dot ${e.business === 'Staging' ? 'cal-st' : 'cal-re'}`} title={`${e.business} calendar`} />}
                      {e.allDay ? 'All day' : formatWallTime(e.start)}
                    </span>
                    <div>
                      {primary ? (
                        <Link className="a-title" to={contactUrl(primary)}>
                          {e.subject}
                        </Link>
                      ) : (
                        <div className="a-title">{e.subject}</div>
                      )}
                      {e.location && <div className="muted small">{e.location}</div>}
                      <div className="a-links">
                        {linked.map((c) => (
                          <Link key={c.id} to={contactUrl(c)} className="a-contact">
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
                    {primary && (
                      <span className="a-go" aria-hidden="true">
                        ›
                      </span>
                    )}
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
