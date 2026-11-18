import { useEffect, useState } from 'react';
import { Confirm } from './Dialog';
import { CONSENT_LABEL, consentState, formatDate, impliedExpiry, todayIso } from '../lib/filters';
import { useSession } from '../lib/session';
import type { ContactPatch } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { ConsentType, Contact } from '../types';

const SOURCES = ['Past client: closed deal', 'Inquiry', 'Referral', 'Signed up at open house', 'Agreed on a call', 'Website form'];

/** Email consent under CASL: who may receive marketing email from Hub, since when, and why. */
export function ConsentPanel({ contact, disabled, onChange }: { contact: Contact; disabled?: boolean; onChange: (p: ContactPatch) => Promise<void> }) {
  const { profile } = useSession();
  const [confirm, setConfirm] = useState<'unsubscribe' | 'resubscribe' | null>(null);
  const [error, setError] = useState('');
  const state = consentState(contact);
  const locked = disabled || !!contact.unsubscribedAt;

  const setType = (t: ConsentType) => {
    if (t === 'none') return onChange({ emailConsent: 'none', consentExpiresOn: undefined });
    const date = contact.consentDate ?? todayIso();
    onChange({
      emailConsent: t,
      consentDate: date,
      // Express consent doesn't lapse; implied consent does.
      consentExpiresOn: t === 'express' ? undefined : impliedExpiry(date, contact.consentSource),
    });
  };

  const [sourceDraft, setSourceDraft] = useState(contact.consentSource);
  useEffect(() => setSourceDraft(contact.consentSource), [contact.consentSource]);
  const saveSource = (value: string) => {
    const v = value.trim();
    if (v !== contact.consentSource) setDateOrSource({ consentSource: v });
  };

  const setDateOrSource = (patch: { consentDate?: string; consentSource?: string }) => {
    const date = patch.consentDate ?? contact.consentDate;
    const source = patch.consentSource ?? contact.consentSource;
    onChange({
      ...patch,
      ...(contact.emailConsent === 'implied' && date && { consentExpiresOn: impliedExpiry(date, source) }),
    });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Email consent</h2>
        <span className={`consent-badge c-${state}`}>{CONSENT_LABEL[state]}</span>
      </div>

      {contact.unsubscribedAt ? (
        <p className="notice warn">
          Unsubscribed {formatDate(contact.unsubscribedAt)}. Hub won't send this person marketing email.
          {profile.role === 'admin' && " Only resubscribe them if they've asked to receive email again."}
        </p>
      ) : state === 'expired' ? (
        <p className="notice warn">Implied consent ended {formatDate(contact.consentExpiresOn!)}. Ask them to opt in before emailing marketing.</p>
      ) : state === 'none' ? (
        <p className="muted small">Marketing emails need consent under Canada's anti-spam law (CASL). One-to-one emails about a specific deal are fine.</p>
      ) : null}

      <div className="form-grid">
        <label className="field">
          <span>Consent</span>
          <select disabled={locked} value={contact.emailConsent} onChange={(e) => setType(e.target.value as ConsentType)}>
            <option value="none">None</option>
            <option value="implied">Implied (deal or inquiry)</option>
            <option value="express">Express (they agreed)</option>
          </select>
        </label>
        {contact.emailConsent !== 'none' && (
          <>
            <label className="field">
              <span>{contact.emailConsent === 'express' ? 'Agreed on' : 'Deal or inquiry date'}</span>
              <input type="date" disabled={locked} max={todayIso()} value={contact.consentDate ?? ''} onChange={(e) => e.target.value && setDateOrSource({ consentDate: e.target.value })} />
            </label>
            <label className="field">
              <span>How</span>
              <input
                list="consent-sources"
                disabled={locked}
                value={sourceDraft}
                onChange={(e) => {
                  setSourceDraft(e.target.value);
                  // Picking a suggestion saves straight away.
                  if (SOURCES.includes(e.target.value)) saveSource(e.target.value);
                }}
                onBlur={() => saveSource(sourceDraft)}
                onKeyDown={(e) => e.key === 'Enter' && saveSource(sourceDraft)}
              />
              <datalist id="consent-sources">
                {SOURCES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            {contact.emailConsent === 'implied' && (
              <label className="field">
                <span>Lapses on</span>
                <input type="date" disabled={locked} value={contact.consentExpiresOn ?? ''} onChange={(e) => onChange({ consentExpiresOn: e.target.value || undefined })} />
              </label>
            )}
          </>
        )}
      </div>

      {!disabled && contact.email && (
        <div className="inline-actions">
          {!contact.unsubscribedAt ? (
            <button type="button" className="btn small danger-outline" onClick={() => setConfirm('unsubscribe')}>
              Mark unsubscribed
            </button>
          ) : (
            profile.role === 'admin' && (
              <button type="button" className="btn small" onClick={() => setConfirm('resubscribe')}>
                Resubscribe
              </button>
            )
          )}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}

      {confirm === 'unsubscribe' && (
        <Confirm
          title="Mark as unsubscribed?"
          message={`${contact.email} will be added to the do-not-email list and won't receive marketing email from Hub. Only an admin can undo this.`}
          confirmLabel="Mark unsubscribed"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await onChange({ unsubscribedAt: new Date().toISOString() });
          }}
        />
      )}
      {confirm === 'resubscribe' && (
        <Confirm
          title="Resubscribe this contact?"
          message="Only do this if they've asked to receive email again. Record their consent below afterwards."
          confirmLabel="Resubscribe"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            const { error: e } = await supabase.from('email_suppressions').delete().eq('email', contact.email!.toLowerCase());
            if (e) return setError(`Couldn't remove from the do-not-email list: ${e.message}`);
            await onChange({ unsubscribedAt: undefined, emailConsent: 'none', consentExpiresOn: undefined });
          }}
        />
      )}
    </section>
  );
}
