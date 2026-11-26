import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from './Dialog';
import { consentState, displayName } from '../lib/filters';
import { callFunction, connectionFor, useOutlookConnections } from '../lib/outlook';
import { signatureFor, useSession } from '../lib/session';
import { fillTemplate, MERGE_FIELDS, mergeValues, unknownFields, useTemplates } from '../lib/templates';
import type { Contact } from '../types';

interface Props {
  contact: Contact;
  onClose: () => void;
  /** Called with the logged activity's time after a successful send. */
  onSent: (at: string) => void;
}

/** Write (or start from a template) and send a one-off email from your own Outlook mailbox for the contact's business. */
export function EmailComposer({ contact, onClose, onSent }: Props) {
  const { profile } = useSession();
  const { connections } = useOutlookConnections();
  const { templates } = useTemplates();
  // Real Estate and Staging contacts hear from different mailboxes.
  const conn = connectionFor(connections, profile.id, contact.business);
  const connected = !!conn && !conn.lastError;
  const signature = signatureFor(profile, contact.business);
  const values = useMemo(() => mergeValues(contact, profile.displayName), [contact, profile.displayName]);

  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const unsubscribed = consentState(contact) === 'unsubscribed';
  const fieldLabel = (k: string) => MERGE_FIELDS.find((f) => f.key === k)?.label.toLowerCase() ?? k;

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    const s = fillTemplate(t.subject, values);
    const b = fillTemplate(t.body, values);
    setSubject(s.text);
    setBody(b.text);
    setMissing([...new Set([...s.missing, ...b.missing])]);
  };

  async function send() {
    setError('');
    // Fields typed by hand are filled too.
    const s = fillTemplate(subject, values);
    const b = fillTemplate(body, values);
    const typos = unknownFields(`${s.text}\n${b.text}`);
    if (typos.length) return setError(`Hub doesn't know {{${typos.join('}}, {{')}}}. Fix or remove ${typos.length === 1 ? 'it' : 'them'} before sending.`);
    if (!s.text.trim()) return setError('Add a subject.');
    if (!b.text.trim()) return setError('Write a message.');
    setSending(true);
    try {
      const r = await callFunction<{ activity?: { occurred_at: string } }>('mail-send', {
        contactId: contact.id,
        subject: s.text,
        body: b.text,
        confirmSuppressed: confirmed,
      });
      onSent(r.activity?.occurred_at ?? new Date().toISOString());
      onClose();
    } catch (e) {
      const message = (e as Error).message;
      if (/do-not-email list/.test(message)) setNeedsConfirm(true);
      setError(message);
      setSending(false);
    }
  }

  const mailto = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Dialog
      title={`Email ${displayName(contact)}`}
      onClose={onClose}
      wide
      footer={
        connected ? (
          <>
            <a className="link-btn footer-left" href={mailto}>
              Open in my email app instead
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={send} disabled={sending || (needsConfirm && !confirmed)}>
              {sending ? 'Sending…' : 'Send from Outlook'}
            </button>
          </>
        ) : undefined
      }
    >
      {connections === null ? (
        <p className="muted">Checking your Outlook connection…</p>
      ) : !connected ? (
        <div className="notice warn">
          Connect your {contact.business} mailbox so emails go from it and are logged here.{' '}
          <Link to="/settings#outlook" onClick={onClose}>
            Go to Settings →
          </Link>{' '}
          or <a href={mailto}>open your email app</a> (not logged in Hub).
        </div>
      ) : (
        <div className="composer-form">
          <div className="to-line">
            <span className="muted">To</span> <strong>{contact.email}</strong>
            <span className="muted small"> · from your {contact.business} mailbox ({conn?.mailbox})</span>
          </div>

          {unsubscribed && (
            <p className="notice warn">
              {displayName(contact)} unsubscribed from marketing email. Only send a personal message about a specific deal.
            </p>
          )}

          <label className="field">
            <span>Start from a template</span>
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Blank email</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.shared ? '' : ' (personal)'}
                </option>
              ))}
            </select>
          </label>
          {missing.length > 0 && (
            <p className="notice warn small">
              No {missing.map(fieldLabel).join(' or ')} on file for this contact, so {missing.length === 1 ? 'that spot is' : 'those spots are'} blank. Check the
              wording before sending.
            </p>
          )}

          <label className="field">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea rows={11} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="signature-preview">
            {signature ? (
              <>
                <span className="muted small">Your signature is added below:</span>
                <pre>{signature}</pre>
              </>
            ) : (
              <span className="muted small">
                No signature yet. <Link to="/settings#signature" onClick={onClose}>Add one in Settings</Link>.
              </span>
            )}
          </div>

          {needsConfirm && (
            <label className="check-field">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>This is a personal message about a specific deal, not marketing.</span>
            </label>
          )}
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
