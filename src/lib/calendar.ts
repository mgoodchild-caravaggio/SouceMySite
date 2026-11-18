import { useCallback, useEffect, useState } from 'react';
import { callFunction } from './outlook';
import { supabase } from './supabase';

export type MeetingKind = 'call' | 'meeting' | 'site_visit';
export const KIND_NAME: Record<MeetingKind, string> = { call: 'Call', meeting: 'Meeting', site_visit: 'Site visit' };

/** A meeting scheduled from Hub. */
export interface Meeting {
  id: string;
  contactId: string;
  organizerId?: string;
  kind: MeetingKind;
  subject: string;
  startsAt: string;
  endsAt: string;
  location: string;
  teamsUrl?: string;
  webLink?: string;
  attendees: string[];
  status: 'scheduled' | 'cancelled';
}

interface MeetingRow {
  id: string;
  contact_id: string;
  organizer_id: string | null;
  kind: MeetingKind;
  subject: string;
  starts_at: string;
  ends_at: string;
  location: string;
  teams_url: string | null;
  web_link: string | null;
  attendees: string[];
  status: 'scheduled' | 'cancelled';
}

export const meetingFromRow = (r: MeetingRow): Meeting => ({
  id: r.id,
  contactId: r.contact_id,
  organizerId: r.organizer_id ?? undefined,
  kind: r.kind,
  subject: r.subject,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  location: r.location,
  teamsUrl: r.teams_url ?? undefined,
  webLink: r.web_link ?? undefined,
  attendees: r.attendees,
  status: r.status,
});

/** Hub-scheduled meetings with one contact, newest first. */
export function useContactMeetings(contactId: string) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('meetings').select('*').eq('contact_id', contactId).order('starts_at', { ascending: false });
    setMeetings(((data ?? []) as MeetingRow[]).map(meetingFromRow));
  }, [contactId]);
  useEffect(() => {
    load();
  }, [load]);
  return { meetings, reload: load };
}

/** An event in the signed-in person's Outlook calendar. Times are Toronto wall times ("YYYY-MM-DDTHH:mm"). */
export interface OutlookEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  allDay: boolean;
  showAs: string;
  location: string;
  emails: string[];
  joinUrl: string | null;
  webLink: string;
}

export interface BusyBlock {
  start: string;
  end: string;
  status: string;
}

export const fetchEvents = (start: string, end: string) => callFunction<{ events: OutlookEvent[] }>('calendar-events', { start, end });

export const fetchFreeBusy = (emails: string[], start: string, end: string) =>
  callFunction<{ people: { email: string; error: string | null; busy: BusyBlock[] }[] }>('calendar-freebusy', { emails, start, end });

export interface ScheduleInput {
  contactId: string;
  kind: MeetingKind;
  subject: string;
  start: string;
  end: string;
  location: string;
  propertyId?: string;
  inviteContact: boolean;
  teammateIds: string[];
  teams: boolean;
  notes: string;
}

export const scheduleMeeting = (input: ScheduleInput) =>
  callFunction<{ meeting: MeetingRow }>('calendar-schedule', { ...input }).then((r) => meetingFromRow(r.meeting));

export const cancelMeeting = (meetingId: string, comment = '') => callFunction('calendar-cancel', { meetingId, comment });

// ---- Toronto wall-time helpers (Hub is used in Ontario) ----
const TZ = 'America/Toronto';

/** "YYYY-MM-DDTHH:mm" in Toronto for a Date. */
export function wallFromDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export const addMinutes = (wall: string, minutes: number) => {
  const [d, t] = wall.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const x = new Date(Date.UTC(y, mo - 1, da, h, mi + minutes));
  return x.toISOString().slice(0, 16);
};

export const minutesOfDay = (wall: string) => {
  const [h, m] = wall.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

const TIME_FMT = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' });
/** "10:30 a.m." for a wall time. */
export const formatWallTime = (wall: string) => TIME_FMT.format(new Date(`2000-01-01T${wall.slice(11, 16)}:00`));
/** "Thu, Nov 20" for a wall time or date. */
export const formatWallDay = (wall: string) =>
  new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${wall.slice(0, 10)}T12:00:00`));
