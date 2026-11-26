import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { TemplateManager } from '../components/TemplateManager';
import { footerReady, useOrgSettings } from '../lib/campaigns';
import { formatDate } from '../lib/filters';
import { callFunction, connectionFor, connectOutlook, useOutlookConnections, type OutlookConnection } from '../lib/outlook';
import { aiAdmin, useAiStatus } from '../lib/askHub';
import { signatureFor, useSession } from '../lib/session';
import { BUSINESSES, type Business } from '../types';
import { supabase } from '../lib/supabase';

interface CheckResult {
  mailbox: string;
  name: string;
  nextMeeting: { subject: string; start: string } | null;
}

/** Your profile, your Outlook mailboxes and signatures (one per business), and (for everyone) who's on the team. */
export default function SettingsPage() {
  const { profile, people, rename } = useSession();
  const { hash } = useLocation();
  const { connections, reload } = useOutlookConnections();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(profile.displayName);
  const [nameMsg, setNameMsg] = useState('');
  // Result of the Microsoft round trip (?outlook=connected or ?outlook=error:…, and which mailbox).
  const [returned, setReturned] = useState<{ business: Business; kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const result = params.get('outlook');
    if (!result) return;
    const business = (BUSINESSES as readonly string[]).includes(params.get('mailbox') ?? '') ? (params.get('mailbox') as Business) : 'Real Estate';
    setReturned(
      result === 'connected'
        ? { business, kind: 'ok', text: `Your ${business} mailbox is connected.` }
        : { business, kind: 'error', text: `Your ${business} mailbox wasn't connected: ${result.replace(/^error:/, '')}` },
    );
    const next = new URLSearchParams(params);
    next.delete('outlook');
    next.delete('mailbox');
    setParams(next, { replace: true });
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Links like /settings#signature jump to that section.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const err = await rename(name.trim());
    setNameMsg(err ? `Couldn't save: ${err}` : 'Saved.');
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
            {/* On phones the top bar has no room for Sign out, so it lives here. */}
            <button type="button" className="btn small mobile-only" style={{ marginLeft: 'auto' }} onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </form>
      </section>

      <section className="panel" id="outlook">
        <h2>Outlook</h2>
        <p className="muted">
          Connect your Microsoft 365 mailboxes so Hub can show your calendar, schedule meetings with contacts, and send emails from your own
          mailbox. Real Estate and Staging each use their own mailbox: the business switch in the sidebar decides which calendar you see, and
          emails and meetings with a contact go from the mailbox of that contact's business. Hub keeps the connections encrypted and you can
          disconnect at any time.
        </p>
        {connections === null ? (
          <p className="muted">Checking…</p>
        ) : (
          <div className="mailbox-list">
            {BUSINESSES.map((b) => (
              <MailboxCard
                key={b}
                business={b}
                conn={connectionFor(connections, profile.id, b)}
                returned={returned?.business === b ? returned : null}
                reload={reload}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel" id="signature">
        <h2>Email signatures</h2>
        <p className="muted small">Added to the end of emails you send from Hub (Outlook doesn't add its own signature to these).</p>
        {BUSINESSES.map((b) => (
          <SignatureForm key={b} business={b} />
        ))}
      </section>

      <section className="panel" id="brokerage">
        <h2>Company details for marketing email</h2>
        <p className="muted small">
          Canada's anti-spam law requires the sender's name, mailing address and a way to reach them at the bottom of every campaign email,
          next to the unsubscribe link. Each business sends from its own domain.
        </p>
        {BUSINESSES.map((b) => (
          <BrokerageDetails key={b} business={b} isAdmin={profile.role === 'admin'} />
        ))}
      </section>

      <AskHubSettings isAdmin={profile.role === 'admin'} />

      <TemplateManager />

      <section className="panel">
        <h2>Team</h2>
        <ul className="team-list">
          {people.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.displayName}</strong>
                <div className="muted small">{p.email}</div>
              </div>
              <span className="tag">{p.role === 'admin' ? 'Admin' : 'Member'}</span>
              <span className="muted small">
                {BUSINESSES.map((b) => {
                  const c = connectionFor(connections, p.id, b);
                  return `${b}: ${c ? (c.lastError ? 'needs reconnecting' : 'connected') : 'not connected'}`;
                }).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {profile.role === 'admin' && (
          <p className="muted small">To invite someone or change a role, use the Supabase dashboard (Authentication → Users, and the profiles table).</p>
        )}
      </section>
    </div>
  );
}

/** One business's mailbox: connect, test, reconnect or disconnect it. */
function MailboxCard({
  business,
  conn,
  returned,
  reload,
}: {
  business: Business;
  conn: OutlookConnection | undefined;
  returned: { kind: 'ok' | 'error'; text: string } | null;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'' | 'connect' | 'check' | 'disconnect'>('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(returned);
  useEffect(() => setMessage(returned), [returned]);

  async function run(kind: 'connect' | 'check' | 'disconnect') {
    setBusy(kind);
    setMessage(null);
    setCheck(null);
    try {
      if (kind === 'connect') {
        await connectOutlook(business); // leaves the page
        return;
      }
      if (kind === 'check') setCheck(await callFunction<CheckResult>('outlook-check', { business }));
      if (kind === 'disconnect') {
        await callFunction('outlook-disconnect', { business });
        setMessage({ kind: 'ok', text: `Your ${business} mailbox is disconnected from Hub.` });
      }
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
      await reload();
    }
    setBusy('');
  }

  return (
    <div className="mailbox-card">
      <h3>{business} mailbox</h3>
      {message && (
        <p className={`notice ${message.kind === 'error' ? 'warn' : 'ok'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {conn ? (
        <>
          <div className="connection-row">
            <span className={`conn-dot ${conn.lastError ? 'bad' : 'good'}`} aria-hidden="true" />
            <div>
              <strong>{conn.lastError ? 'Needs reconnecting' : 'Connected'}</strong> as {conn.mailbox}
              <div className="muted small">Since {formatDate(conn.connectedAt)}</div>
              {conn.lastError && <div className="field-error">{conn.lastError}</div>}
            </div>
          </div>
          {check && (
            <p className="notice ok" role="status">
              Working: signed in to Outlook as {check.name} ({check.mailbox}).{' '}
              {check.nextMeeting
                ? `The next meeting is “${check.nextMeeting.subject}” on ${formatDate(check.nextMeeting.start)}.`
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
        <>
          {business === 'Staging' && (
            <p className="muted small">
              Microsoft will ask which account to use: choose your Staging mailbox, or “Use another account” and sign in with it.
            </p>
          )}
          <div className="inline-actions">
            <button type="button" className="btn primary" onClick={() => run('connect')} disabled={!!busy}>
              {busy === 'connect' ? 'Opening Microsoft…' : `Connect ${business} mailbox`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The signature for one business's emails. */
function SignatureForm({ business }: { business: Business }) {
  const { profile, saveSignature } = useSession();
  const saved = signatureFor(profile, business);
  const [signature, setSignature] = useState(saved);
  const [msg, setMsg] = useState('');
  return (
    <form
      className="signature-field"
      onSubmit={async (e) => {
        e.preventDefault();
        const err = await saveSignature(signature.trim(), business);
        setMsg(err ? `Couldn't save: ${err}` : 'Saved.');
      }}
    >
      <label className="field">
        <span>{business} emails</span>
        <textarea
          rows={5}
          value={signature}
          placeholder={`${profile.displayName}\n${business === 'Staging' ? 'Infrastructure Staging Solutions' : 'Caravaggio Real Estate'}\n905 555 0100`}
          onChange={(e) => {
            setSignature(e.target.value);
            setMsg('');
          }}
        />
      </label>
      <div className="inline-actions">
        <button type="submit" className="btn small primary" disabled={signature.trim() === saved}>
          Save {business} signature
        </button>
        {msg && <span className="muted small" role="status">{msg}</span>}
      </div>
    </form>
  );
}

/** One business's details every marketing email must show (CASL), and its sending domain. Admins edit; everyone can see them. */
function BrokerageDetails({ business, isAdmin }: { business: Business; isAdmin: boolean }) {
  const { org, save } = useOrgSettings(business);
  const [draft, setDraft] = useState<typeof org>(null);
  const [msg, setMsg] = useState('');
  const value = draft ?? org;
  if (!value) return null;
  const set = (k: keyof NonNullable<typeof org>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft({ ...value, [k]: e.target.value });
    setMsg('');
  };
  const staging = business === 'Staging';
  return (
    <div className="mailbox-card">
      <div className="panel-head">
        <h3>{business}</h3>
        {!footerReady(org) && <span className="consent-badge c-unsubscribed">Needed before sending</span>}
      </div>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await save(value);
          setMsg(err ? `Couldn't save: ${err}` : 'Saved.');
          if (!err) setDraft(null);
        }}
      >
        <label className="field">
          <span>{staging ? 'Company legal name' : 'Brokerage legal name'}</span>
          <input
            value={value.brokerageName}
            disabled={!isAdmin}
            onChange={set('brokerageName')}
            placeholder={staging ? 'e.g. Infrastructure Staging Solutions Inc.' : 'e.g. Caravaggio Real Estate Inc., Brokerage'}
          />
        </label>
        <label className="field">
          <span>Phone, email or website</span>
          <input value={value.contactLine} disabled={!isAdmin} onChange={set('contactLine')} placeholder="e.g. 905 555 0100 · example.ca" />
        </label>
        <label className="field">
          <span>Mailing address</span>
          <input value={value.mailingAddress} disabled={!isAdmin} onChange={set('mailingAddress')} placeholder="Street, city, province, postal code" />
        </label>
        <label className="field">
          <span>Sending domain</span>
          <input value={value.sendingDomain} disabled={!isAdmin} onChange={set('sendingDomain')} placeholder={staging ? 'e.g. the domain of the Staging mailbox' : 'caravaggiorealestate.ca'} />
        </label>
        {isAdmin ? (
          <div className="span-2 inline-actions">
            <button type="submit" className="btn small primary" disabled={!draft}>
              Save {business} details
            </button>
            {msg && <span className="muted small" role="status">{msg}</span>}
          </div>
        ) : (
          <p className="muted small span-2">Only admins can change these.</p>
        )}
      </form>
    </div>
  );
}

/** Ask Hub: on or off, the Anthropic API key (stored encrypted on the server), the monthly cap and usage. */
function AskHubSettings({ isAdmin }: { isAdmin: boolean }) {
  const { status, reload } = useAiStatus();
  const [key, setKey] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recent, setRecent] = useState<{ created_at: string; question: string; cost_usd: number; error: string | null }[]>([]);

  useEffect(() => {
    supabase
      .from('ai_requests')
      .select('created_at, question, cost_usd, error')
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setRecent((data ?? []) as typeof recent));
  }, [status?.monthSpendUsd]);

  if (!status) return null;
  const run = async (label: string, body: Record<string, unknown>, ok: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await aiAdmin(body);
      setMsg({ ok: true, text: ok });
      setKey('');
      setCap('');
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  const pct = status.monthlyCapUsd ? Math.min(100, Math.round((status.monthSpendUsd / status.monthlyCapUsd) * 100)) : 0;

  return (
    <section className="panel" id="ask-hub">
      <div className="panel-head">
        <h2>Ask Hub (AI assistant)</h2>
        <span className={`tag ${status.enabled && status.keySet ? 'opp-open' : ''}`}>{status.enabled && status.keySet ? 'On' : 'Off'}</span>
      </div>
      <p className="muted small">
        Ask Hub answers questions about contacts, land, buyers and campaigns using Claude ({status.model}). The records it looks up are sent to Anthropic to answer;
        Anthropic doesn't train on API data. It never changes anything without a click. Mention this in Caravaggio's privacy notice before turning it on.
      </p>

      <div className="ai-usage">
        <div>
          <strong>${status.monthSpendUsd.toFixed(2)}</strong> of ${status.monthlyCapUsd.toFixed(0)} this month
        </div>
        <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the monthly cap used">
          <span style={{ width: `${pct}%` }} className={pct >= 90 ? 'hot' : ''} />
        </div>
        <span className="muted small">Questions stop when the cap is reached, until next month or until the cap is raised. A typical question costs 5–15¢.</span>
      </div>

      {isAdmin ? (
        <div className="form-grid">
          <form
            className="field span-2"
            onSubmit={(e) => {
              e.preventDefault();
              run('key', { action: 'set_key', apiKey: key }, 'Key checked with Anthropic and saved.');
            }}
          >
            <span>Anthropic API key {status.keySet && <span className="muted">(saved: ends in {status.keyHint})</span>}</span>
            <div className="inline-actions">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={status.keySet ? 'Paste a new key to replace it' : 'sk-ant-…'}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn small" disabled={!key.trim() || !!busy}>
                {busy === 'key' ? 'Checking…' : status.keySet ? 'Replace' : 'Save key'}
              </button>
              {status.keySet && (
                <button type="button" className="link-btn tl-delete small" disabled={!!busy} onClick={() => run('remove', { action: 'remove_key' }, 'Key removed and Ask Hub switched off.')}>
                  Remove
                </button>
              )}
            </div>
            <span className="muted small">Create one in the Anthropic Console (console.anthropic.com → API keys). It's encrypted on Hub's server and never shown again.</span>
          </form>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              run('cap', { action: 'update', monthlyCapUsd: Number(cap) }, 'Monthly cap saved.');
            }}
          >
            <span>Monthly cap (US$)</span>
            <div className="inline-actions">
              <input type="number" min={0} max={10000} step={5} value={cap} onChange={(e) => setCap(e.target.value)} placeholder={status.monthlyCapUsd.toFixed(0)} />
              <button type="submit" className="btn small" disabled={cap === '' || !!busy}>
                Save
              </button>
            </div>
          </form>
          <div className="field">
            <span>Ask Hub</span>
            <div className="inline-actions">
              <button
                type="button"
                className={`btn small ${status.enabled ? '' : 'primary'}`}
                disabled={!!busy || (!status.enabled && !status.keySet)}
                title={!status.keySet ? 'Add a key first' : undefined}
                onClick={() => run('toggle', { action: 'update', enabled: !status.enabled }, status.enabled ? 'Ask Hub switched off.' : 'Ask Hub switched on.')}
              >
                {status.enabled ? 'Switch off' : 'Switch on'}
              </button>
            </div>
          </div>
          {msg && (
            <p className={`span-2 small ${msg.ok ? 'muted' : 'field-error'}`} role="status">
              {msg.text}
            </p>
          )}
        </div>
      ) : (
        <p className="muted small">Only admins can change these.</p>
      )}

      {recent.length > 0 && (
        <details className="ai-recent">
          <summary className="small">{isAdmin ? 'Recent questions (everyone)' : 'Your recent questions'}</summary>
          <ul>
            {recent.map((r, i) => (
              <li key={i} className="small">
                <span className="muted">{formatDate(r.created_at)}</span> {r.question || '(follow-up step)'} <span className="muted">· ${Number(r.cost_usd).toFixed(3)}</span>
                {r.error && <span className="field-error"> · {r.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
