import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from './Dialog';
import {
  addMinutes,
  fetchFreeBusy,
  formatWallTime,
  KIND_NAME,
  minutesOfDay,
  scheduleMeeting,
  wallFromDate,
  type BusyBlock,
  type Meeting,
  type MeetingKind,
} from '../lib/calendar';
import { displayName } from '../lib/filters';
import { connectionFor, useOutlookConnections } from '../lib/outlook';
import { useSession } from '../lib/session';
import type { Contact } from '../types';

const DAY_START = 7 * 60; // 7 a.m.
const DAY_END = 19 * 60; // 7 p.m.
const DURATIONS = [15, 30, 45, 60, 90, 120];

interface Props {
  contact: Contact;
  /** Start on this day and time (Toronto, "YYYY-MM-DD" and "HH:mm"), e.g. a slot clicked on the Calendar. */
  initialDate?: string;
  initialTime?: string;
  onClose: () => void;
  onScheduled: (m: Meeting, followUpDay: string | null) => void;
}

/** Book a call, meeting or site visit into Outlook, checking your and teammates' free/busy. */
export function ScheduleDialog({ contact, initialDate, initialTime, onClose, onScheduled }: Props) {
  const { profile, people } = useSession();
  const { connections } = useOutlookConnections();
  // The meeting goes in the mailbox of the contact's business (Real Estate and Staging have separate mailboxes).
  const business = contact.business;
  const conn = connectionFor(connections, profile.id, business);
  const connected = !!conn && !conn.lastError;
  const myEmail = (conn?.mailbox ?? profile.email).toLowerCase();

  const tomorrow = wallFromDate(new Date(Date.now() + 86_400_000)).slice(0, 10);
  const [kind, setKind] = useState<MeetingKind>(contact.properties.length ? 'site_visit' : 'call');
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(initialDate ?? tomorrow);
  const [time, setTime] = useState(initialTime ?? '10:00');
  const [duration, setDuration] = useState(60);
  const [propertyId, setPropertyId] = useState(contact.properties[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [locationEdited, setLocationEdited] = useState(false);
  const [inviteContact, setInviteContact] = useState(!!contact.email);
  const [mates, setMates] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState(false);
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState(true);
  const [busy, setBusy] = useState<Record<string, BusyBlock[]>>({});
  const [busyError, setBusyError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const name = displayName(contact);
  const property = contact.properties.find((p) => p.id === propertyId);

  // Sensible defaults that follow the meeting type until the person edits them.
  useEffect(() => {
    if (!subjectEdited) setSubject(`${KIND_NAME[kind]}: ${name}`);
    if (!locationEdited) setLocation(kind === 'site_visit' ? property?.address ?? '' : kind === 'call' ? contact.phone : '');
    if (kind === 'call' && duration > 30 && !subjectEdited) setDuration(30);
    if (kind === 'site_visit' && duration < 60) setDuration(60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, propertyId]);

  const teammates = people.filter((p) => p.id !== profile.id);
  const calendars = useMemo(
    () => [
      { id: profile.id, email: myEmail, name: 'You' },
      ...teammates.filter((t) => mates.has(t.id)).map((p) => ({ id: p.id, email: p.email.toLowerCase(), name: p.displayName })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.id, myEmail, mates, people],
  );

  // Free/busy for the chosen day.
  useEffect(() => {
    if (!connected || !date) return;
    let cancelled = false;
    setBusyError('');
    fetchFreeBusy(
      business,
      calendars.map((c) => c.email),
      `${date}T00:00`,
      `${date}T23:59`,
    )
      .then((r) => !cancelled && setBusy(Object.fromEntries(r.people.map((p) => [p.email, p.busy]))))
      .catch((e) => !cancelled && setBusyError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [connected, business, date, calendars]);

  const start = `${date}T${time}`;
  const end = addMinutes(start, duration);
  const conflicts = calendars.filter((c) => (busy[c.email] ?? []).some((b) => b.start < end && b.end > start));

  async function submit() {
    setError('');
    if (!subject.trim()) return setError('Add a title.');
    if (start < wallFromDate(new Date())) return setError('Pick a time in the future.');
    setSaving(true);
    try {
      const meeting = await scheduleMeeting({
        contactId: contact.id,
        kind,
        subject: subject.trim(),
        start,
        end,
        location: location.trim(),
        propertyId: kind === 'site_visit' ? propertyId || undefined : undefined,
        inviteContact: inviteContact && !!contact.email,
        teammateIds: [...mates],
        teams,
        notes,
      });
      onScheduled(meeting, followUp ? addMinutes(`${date}T00:00`, 24 * 60).slice(0, 10) : null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const pct = (min: number) => `${((min - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
  const clamp = (m: number) => Math.max(DAY_START, Math.min(DAY_END, m));

  return (
    <Dialog
      title={`Schedule with ${name}`}
      onClose={onClose}
      wide
      footer={
        connected ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={submit} disabled={saving}>
              {saving ? 'Sending invite…' : inviteContact || mates.size ? 'Schedule and send invite' : 'Add to my calendar'}
            </button>
          </>
        ) : undefined
      }
    >
      {connections === null ? (
        <p className="muted">Checking your Outlook connection…</p>
      ) : !connected ? (
        <div className="notice warn">
          Connect your {business} mailbox first so Hub can check your calendar and send the invite.{' '}
          <Link to="/settings#outlook" onClick={onClose}>
            Go to Settings →
          </Link>
        </div>
      ) : (
        <div className="schedule-form">
          <div className="seg" role="group" aria-label="Type">
            {(Object.keys(KIND_NAME) as MeetingKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {KIND_NAME[k]}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Title</span>
            <input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setSubjectEdited(true);
              }}
            />
          </label>

          <div className="form-grid three">
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} min={wallFromDate(new Date()).slice(0, 10)} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Start</span>
              <input type="time" step={900} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
            </label>
            <label className="field">
              <span>Length</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? 's' : ''}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="freebusy" aria-label="Free and busy times">
            <div className="fb-scale" aria-hidden="true">
              {[8, 10, 12, 14, 16, 18].map((h) => (
                <span key={h} style={{ left: pct(h * 60) }}>
                  {h <= 12 ? h : h - 12}
                  {h < 12 ? 'a' : 'p'}
                </span>
              ))}
            </div>
            {calendars.map((c) => (
              <div className="fb-row" key={c.email}>
                <span className="fb-name">{c.name}</span>
                <button
                  type="button"
                  className="fb-track"
                  aria-label={`Pick a start time from ${c.name}'s day`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const m = DAY_START + ((e.clientX - r.left) / r.width) * (DAY_END - DAY_START);
                    const snapped = Math.round(m / 15) * 15;
                    setTime(`${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`);
                  }}
                >
                  {(busy[c.email] ?? []).map((b, i) => {
                    const s = clamp(b.start.slice(0, 10) < date ? DAY_START : minutesOfDay(b.start));
                    const en = clamp(b.end.slice(0, 10) > date ? DAY_END : minutesOfDay(b.end));
                    return en > s ? (
                      <span
                        key={i}
                        className={`fb-busy ${b.status}`}
                        style={{ left: pct(s), width: `calc(${pct(en)} - ${pct(s)})` }}
                        title={`${b.status === 'tentative' ? 'Tentative' : b.status === 'oof' ? 'Away' : 'Busy'} ${formatWallTime(b.start)}–${formatWallTime(b.end)}`}
                      />
                    ) : null;
                  })}
                  <span
                    className={`fb-pick ${conflicts.length ? 'clash' : ''}`}
                    style={{ left: pct(clamp(minutesOfDay(start))), width: `calc(${pct(clamp(minutesOfDay(start) + duration))} - ${pct(clamp(minutesOfDay(start)))})` }}
                  />
                </button>
              </div>
            ))}
            <p className={`small ${conflicts.length ? 'due-overdue' : 'muted'}`} role="status">
              {busyError
                ? `Couldn't load free/busy: ${busyError}`
                : conflicts.length
                  ? `${conflicts.map((c) => c.name).join(' and ')} ${conflicts.length === 1 && conflicts[0].name === 'You' ? 'are' : conflicts.length > 1 ? 'are' : 'is'} busy then.`
                  : `${formatWallTime(start)}–${formatWallTime(end)} is free. Click a timeline to pick another time.`}
            </p>
          </div>

          {kind === 'site_visit' && contact.properties.length > 1 && (
            <label className="field">
              <span>Property</span>
              <select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setLocationEdited(false);
                }}
              >
                {contact.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Location</span>
            <input
              value={location}
              placeholder={kind === 'meeting' ? 'Office, address, or leave blank for Teams' : ''}
              onChange={(e) => {
                setLocation(e.target.value);
                setLocationEdited(true);
              }}
            />
          </label>

          <fieldset className="schedule-who">
            <legend>Who</legend>
            <label className="check-field">
              <input type="checkbox" checked={inviteContact} disabled={!contact.email} onChange={(e) => setInviteContact(e.target.checked)} />
              <span>
                Invite {name}
                {contact.email ? ` (${contact.email})` : ' (no email on file)'}
              </span>
            </label>
            {teammates.map((t) => (
              <label key={t.id} className="check-field">
                <input
                  type="checkbox"
                  checked={mates.has(t.id)}
                  onChange={() =>
                    setMates((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                />
                <span>Add {t.displayName}</span>
              </label>
            ))}
            <label className="check-field">
              <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} />
              <span>Add a Teams link</span>
            </label>
          </fieldset>

          <label className="field">
            <span>Notes in the invite (optional)</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="check-field">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            <span>Set a follow-up for the day after</span>
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
