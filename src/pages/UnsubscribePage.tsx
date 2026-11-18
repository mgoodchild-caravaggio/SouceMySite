import { useState } from 'react';

/** Public page from the unsubscribe link in campaign emails. No sign-in; the link's token identifies the person. */
export default function UnsubscribePage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'error'>('ready');
  const [detail, setDetail] = useState('');

  async function unsubscribe() {
    setState('working');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong');
      setDetail(body.email);
      setState('done');
    } catch (e) {
      setDetail((e as Error).message);
      setState('error');
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor" />
              <circle cx="12" cy="10" r="2.6" fill="#fff" />
            </svg>
          </span>
          <span>Caravaggio Real Estate</span>
        </div>
        {state === 'done' ? (
          <>
            <h2>You're unsubscribed</h2>
            <p className="muted">{detail} won't receive marketing email from us again. You may still hear from us about a deal you're involved in.</p>
          </>
        ) : state === 'error' ? (
          <>
            <h2>That didn't work</h2>
            <p className="muted">{detail}. Reply to the email you received and we'll take you off the list.</p>
          </>
        ) : !/^[0-9a-f-]{36}$/i.test(token) ? (
          <>
            <h2>Link not recognised</h2>
            <p className="muted">Use the unsubscribe link in the email you received, or reply to it and we'll take you off the list.</p>
          </>
        ) : (
          <>
            <h2>Unsubscribe from marketing email?</h2>
            <p className="muted">You'll stop receiving marketing email from Caravaggio Real Estate.</p>
            <button type="button" className="btn primary" onClick={unsubscribe} disabled={state === 'working'}>
              {state === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
