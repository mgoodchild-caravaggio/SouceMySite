import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/** Shows the sign-in screen until there is a Supabase session, then renders the app. */
export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="auth-screen">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (!session) return <SignIn />;
  // Keyed by user so a different sign-in starts with fresh state.
  return <div key={session.user.id} style={{ display: 'contents' }}>{children(session)}</div>;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Invite-only: never create an account from the sign-in form.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      setState('idle');
      setError(
        /signups? not allowed|user not found/i.test(error.message)
          ? "That email doesn't have access. Ask an administrator to invite you."
          : error.message,
      );
    } else {
      setState('sent');
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor" />
              <circle cx="12" cy="10" r="2.6" fill="#fff" />
            </svg>
          </span>
          <span>Prospect Map</span>
        </div>
        {state === 'sent' ? (
          <>
            <h2>Check your email</h2>
            <p className="muted">
              We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to continue.
            </p>
            <button type="button" className="link-btn" onClick={() => setState('idle')}>
              Use a different email
            </button>
          </>
        ) : (
          <>
            <h2>Sign in</h2>
            <p className="muted">Enter your work email and we'll send you a sign-in link.</p>
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="btn primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
