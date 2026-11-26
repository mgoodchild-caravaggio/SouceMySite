import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDayActivity, type ActivityKind, type DayItem } from '../lib/activities';
import { useSession } from '../lib/session';

const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const TIME = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

/** How each kind of work is counted at the top, in this order. */
const TALLY: { kinds: ActivityKind[]; one: string; many: string }[] = [
  { kinds: ['follow_up_done'], one: 'follow-up done', many: 'follow-ups done' },
  { kinds: ['call'], one: 'call', many: 'calls' },
  { kinds: ['email'], one: 'email', many: 'emails' },
  { kinds: ['meeting'], one: 'meeting', many: 'meetings' },
  { kinds: ['note'], one: 'note', many: 'notes' },
  { kinds: ['status_change'], one: 'status change', many: 'status changes' },
  { kinds: ['created'], one: 'contact added', many: 'contacts added' },
  { kinds: ['property_added'], one: 'property added', many: 'properties added' },
  { kinds: ['opportunity_added'], one: 'listing/requirement added', many: 'listings/requirements added' },
  { kinds: ['file_added'], one: 'file attached', many: 'files attached' },
  { kinds: ['match_added'], one: 'match added', many: 'matches added' },
  { kinds: ['campaign_stage'], one: 'campaign update', many: 'campaign updates' },
  { kinds: ['campaign_sent'], one: 'campaign email', many: 'campaign emails' },
  { kinds: ['archived', 'restored', 'file_removed'], one: 'other change', many: 'other changes' },
];

const VERB: Partial<Record<ActivityKind, string>> = {
  follow_up_done: 'Completed follow-up',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  status_change: 'Status',
  created: 'Added',
  archived: 'Archived',
  restored: 'Restored',
  file_added: 'Attached',
  file_removed: 'Removed file',
  match_added: 'Match',
  property_added: 'Property',
  opportunity_added: 'Listing/requirement',
  campaign_stage: 'Campaign',
};

const firstLine = (s: string) => s.split('\n')[0].slice(0, 140);

/** The signed-in person's own work for a day: what they completed, logged and changed in Hub. */
export function DaySummary() {
  const { profile, business } = useSession();
  const today = localDay();
  const [day, setDay] = useState(today);
  const { items, error } = useDayActivity(profile.id, day);
  const [copied, setCopied] = useState(false);

  const tally = useMemo(
    () =>
      TALLY.map((t) => ({ ...t, n: (items ?? []).filter((i) => t.kinds.includes(i.kind)).length })).filter((t) => t.n > 0),
    [items],
  );
  // Campaign emails are one line per campaign, not one per recipient.
  const rows = useMemo(() => {
    const out: (DayItem & { count?: number })[] = [];
    const campaigns = new Map<string, DayItem & { count: number }>();
    for (const i of items ?? []) {
      if (i.kind !== 'campaign_sent') {
        out.push(i);
        continue;
      }
      const name = i.body.match(/^Campaign “([^”]+)”/)?.[1] ?? 'campaign';
      const c = campaigns.get(name);
      if (c) c.count++;
      else {
        const row = { ...i, body: name, count: 1 };
        campaigns.set(name, row);
        out.push(row);
      }
    }
    return out;
  }, [items]);

  const who = (i: DayItem) => i.contactName || i.contactCompany || 'a contact';
  const line = (i: DayItem & { count?: number }) =>
    i.kind === 'campaign_sent'
      ? `Sent “${i.body}” to ${i.count} ${i.count === 1 ? 'person' : 'people'}`
      : `${VERB[i.kind] ?? i.kind}: ${who(i)}${i.body ? ` (${firstLine(i.body)})` : ''}`;

  async function copy() {
    const text = [
      `${profile.displayName}: ${DAY.format(new Date(`${day}T12:00:00`))}`,
      tally.map((t) => `${t.n} ${t.n === 1 ? t.one : t.many}`).join(', '),
      '',
      ...rows.map((i) => `${TIME.format(new Date(i.occurredAt))}  ${line(i)}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  }

  return (
    <section className="panel day-summary">
      <div className="panel-head">
        <h2>{day === today ? 'Your day' : day === shiftDay(today, -1) ? 'Yesterday' : DAY.format(new Date(`${day}T12:00:00`))}</h2>
        <div className="day-nav">
          <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
            ‹
          </button>
          {day !== today && (
            <button type="button" className="btn small" onClick={() => setDay(today)}>
              Today
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Next day" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>
            ›
          </button>
        </div>
      </div>
      {error ? (
        <p className="field-error">Couldn't load your day: {error}</p>
      ) : !items ? (
        <p className="muted">Loading…</p>
      ) : !items.length ? (
        <div className="empty compact">
          <strong>{day === today ? 'Nothing done in Hub yet today.' : 'Nothing done in Hub that day.'}</strong>
          <span>Follow-ups you complete, and calls, emails, notes, meetings and changes you make, are summed up here.</span>
        </div>
      ) : (
        <>
          <ul className="day-tally">
            {tally.map((t) => (
              <li key={t.one}>
                <strong>{t.n}</strong> {t.n === 1 ? t.one : t.many}
              </li>
            ))}
          </ul>
          <ol className="day-list">
            {rows.map((i) => (
              <li key={i.id} className={`tl-${i.kind}`}>
                <span className="day-time muted small">{TIME.format(new Date(i.occurredAt))}</span>
                <span className="day-what">
                  {i.kind === 'campaign_sent' ? (
                    line(i)
                  ) : (
                    <>
                      <span className="muted">{VERB[i.kind] ?? i.kind}</span>{' '}
                      <Link to={`/contacts/${i.contactId}`}>{who(i)}</Link>
                      {i.business !== business && <span className="tag small-tag">{i.business}</span>}
                      {i.body && <span className="day-body muted"> · {firstLine(i.body)}</span>}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="link-btn small panel-foot" onClick={copy}>
            {copied ? 'Copied' : 'Copy summary'}
          </button>
        </>
      )}
    </section>
  );
}
