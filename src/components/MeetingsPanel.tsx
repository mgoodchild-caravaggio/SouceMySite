import { useState } from 'react';
import { Confirm } from './Dialog';
import { ScheduleDialog } from './ScheduleDialog';
import { cancelMeeting, formatWallDay, formatWallTime, KIND_NAME, useContactMeetings, wallFromDate, type Meeting } from '../lib/calendar';
import { useSession } from '../lib/session';
import type { Contact } from '../types';

interface Props {
  contact: Contact;
  disabled?: boolean;
  /** Called after scheduling or cancelling, e.g. to refresh the activity timeline. */
  onChanged: (followUpDay?: string | null) => void;
}

/** Meetings scheduled from Hub with this contact, and the Schedule button. */
export function MeetingsPanel({ contact, disabled, onChanged }: Props) {
  const { profile, people } = useSession();
  const { meetings, reload } = useContactMeetings(contact.id);
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState<Meeting | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState('');

  const now = new Date().toISOString();
  const upcoming = meetings.filter((m) => m.status === 'scheduled' && m.endsAt >= now).reverse();
  const past = meetings.filter((m) => !(m.status === 'scheduled' && m.endsAt >= now));
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.displayName ?? 'Someone';

  const row = (m: Meeting) => {
    const start = wallFromDate(new Date(m.startsAt));
    const end = wallFromDate(new Date(m.endsAt));
    return (
      <li key={m.id} className={m.status}>
        <span className="m-date">
          <small>{formatWallDay(start).split(',')[0]}</small>
          {Number(start.slice(8, 10))}
        </span>
        <div>
          <div className="m-title">{m.subject}</div>
          <div className="muted small">
            {KIND_NAME[m.kind]} · {formatWallDay(start)}, {formatWallTime(start)}–{formatWallTime(end)}
            {m.location && ` · ${m.location}`}
          </div>
          <div className="muted small">
            {m.status === 'cancelled' ? 'Cancelled' : `Organised by ${m.organizerId === profile.id ? 'you' : nameOf(m.organizerId)}`}
          </div>
        </div>
        <div className="m-actions">
          {m.teamsUrl && m.status === 'scheduled' && (
            <a className="btn small" href={m.teamsUrl} target="_blank" rel="noreferrer">
              Join Teams
            </a>
          )}
          {m.webLink && m.organizerId === profile.id && (
            <a className="link-btn" href={m.webLink} target="_blank" rel="noreferrer">
              Outlook
            </a>
          )}
          {m.status === 'scheduled' && m.endsAt >= now && m.organizerId === profile.id && !disabled && (
            <button type="button" className="link-btn tl-delete" onClick={() => setCancelling(m)}>
              Cancel
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Meetings</h2>
        {!disabled && (
          <button type="button" className="btn small primary" onClick={() => setScheduling(true)}>
            Schedule
          </button>
        )}
      </div>
      {upcoming.length ? <ul className="meeting-list">{upcoming.map(row)}</ul> : <p className="muted">Nothing scheduled.</p>}
      {past.length > 0 && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
            {showPast ? 'Hide' : 'Show'} past and cancelled ({past.length})
          </button>
          {showPast && <ul className="meeting-list">{past.map(row)}</ul>}
        </>
      )}
      {error && <p className="field-error">{error}</p>}

      {scheduling && (
        <ScheduleDialog
          contact={contact}
          onClose={() => setScheduling(false)}
          onScheduled={(_, followUpDay) => {
            reload();
            onChanged(followUpDay);
          }}
        />
      )}
      {cancelling && (
        <Confirm
          title="Cancel this meeting?"
          message={`“${cancelling.subject}” will be removed from your Outlook calendar, and anyone invited will get a cancellation.`}
          confirmLabel="Cancel meeting"
          danger
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            const m = cancelling;
            setCancelling(null);
            try {
              await cancelMeeting(m.id);
              await reload();
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
    </section>
  );
}
