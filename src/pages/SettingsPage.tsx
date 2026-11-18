import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate } from '../lib/filters';
import { callFunction, connectOutlook, useOutlookConnections } from '../lib/outlook';
import { useSession } from '../lib/session';

interface CheckResult {
  mailbox: string;
  name: string;
  nextMeeting: { subject: string; start: string } | null;
}

/** Your profile, your Outlook connection, and (for everyone) who's on the team. */
export default function SettingsPage() {
  const { profile, people, rename } = useSession();
  const { connections, reload } = useOutlookConnections();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(profile.displayName);
  const [nameMsg, setNameMsg] = useState('');
  const [busy, setBusy] = useState<'' | 'connect' | 'check' | 'disconnect'>('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const mine = connections?.find((c) => c.userId === profile.id);
  const byUser = useMemo(() => Object.fromEntries((connections ?? []).map((c) => [c.userId, c])), [connections]);

  // Result of the Microsoft round trip (?outlook=connected or ?outlook=error:…).
  useEffect(() => {
    const result = params.get('outlook');
    if (!result) return;
    setMessage(
      result === 'connected'
        ? { kind: 'ok', text: 'Outlook is connected.' }
        : { kind: 'error', text: `Outlook wasn't connected: ${result.replace(/^error:/, '')}` },
    );
    const next = new URLSearchParams(params);
    next.delete('outlook');
    setParams(next, { replace: true });
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const err = await rename(name.trim());
    setNameMsg(err ? `Couldn't save: ${err}` : 'Saved.');
  }

  async function run(kind: 'connect' | 'check' | 'disconnect') {
    setBusy(kind);
    setMessage(null);
    setCheck(null);
    try {
      if (kind === 'connect') {
        await connectOutlook(); // leaves the page
        return;
      }
      if (kind === 'check') setCheck(await callFunction<CheckResult>('outlook-check'));
      if (kind === 'disconnect') {
        await callFunction('outlook-disconnect');
        setMessage({ kind: 'ok', text: 'Outlook is disconnected from Hub.' });
      }
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
      await reload();
    }
    setBusy('');
  }

  return (
    <div className="detail-page settings-page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="panel">
        <h2>Your profile</h2>
        <form className="form-grid" onSubmit={saveName}>
          <label className="field">
            <span>Name shown to the team</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setNameMsg(''); }} />
          </label>
          <div className="field">
            <span>Email and role</span>
            <div className="static-field">
              {profile.email} · {profile.role === 'admin' ? 'Admin' : 'Member'}
            </div>
          </div>
          <div className="span-2 inline-actions">
            <button type="submit" className="btn small primary" disabled={name.trim() === profile.displayName}>
              Save name
            </button>
            {nameMsg && <span className="muted small" role="status">{nameMsg}</span>}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Outlook</h2>
        <p className="muted">
          Connect your Microsoft 365 account so Hub can show your calendar, schedule meetings with contacts, and send emails from your
          own mailbox. Hub keeps the connection encrypted and you can disconnect at any time.
        </p>
        {message && (
          <p className={`notice ${message.kind === 'error' ? 'warn' : 'ok'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
        {connections === null ? (
          <p className="muted">Checking…</p>
        ) : mine ? (
          <>
            <div className="connection-row">
              <span className={`conn-dot ${mine.lastError ? 'bad' : 'good'}`} aria-hidden="true" />
              <div>
                <strong>{mine.lastError ? 'Needs reconnecting' : 'Connected'}</strong> as {mine.mailbox}
                <div className="muted small">Since {formatDate(mine.connectedAt)}</div>
                {mine.lastError && <div className="field-error">{mine.lastError}</div>}
              </div>
            </div>
            {check && (
              <p className="notice ok" role="status">
                Working: signed in to Outlook as {check.name} ({check.mailbox}).{' '}
                {check.nextMeeting
                  ? `Your next meeting is “${check.nextMeeting.subject}” on ${formatDate(check.nextMeeting.start)}.`
                  : 'No meetings in the next 7 days.'}
              </p>
            )}
            <div className="inline-actions">
              <button type="button" className="btn small" onClick={() => run('check')} disabled={!!busy}>
                {busy === 'check' ? 'Checking…' : 'Test connection'}
              </button>
              <button type="button" className="btn small" onClick={() => run('connect')} disabled={!!busy}>
                Reconnect
              </button>
              <button type="button" className="btn small danger-outline" onClick={() => run('disconnect')} disabled={!!busy}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className="inline-actions">
            <button type="button" className="btn primary" onClick={() => run('connect')} disabled={!!busy}>
              {busy === 'connect' ? 'Opening Microsoft…' : 'Connect Outlook'}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Team</h2>
        <ul className="team-list">
          {people.map((p) => {
            const c = byUser[p.id];
            return (
              <li key={p.id}>
                <div>
                  <strong>{p.displayName}</strong>
                  <div className="muted small">{p.email}</div>
                </div>
                <span className="tag">{p.role === 'admin' ? 'Admin' : 'Member'}</span>
                <span className="muted small">
                  {c ? (c.lastError ? 'Outlook needs reconnecting' : 'Outlook connected') : 'Outlook not connected'}
                </span>
              </li>
            );
          })}
        </ul>
        {profile.role === 'admin' && (
          <p className="muted small">To invite someone or change a role, use the Supabase dashboard (Authentication → Users, and the profiles table).</p>
        )}
      </section>
    </div>
  );
}
