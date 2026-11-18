import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const returnUrl = () => window.location.origin + window.location.pathname;

function friendlyError(message: string) {
  return /signups? not allowed|user not found/i.test(message)
    ? "That account doesn't have access. Ask an administrator to invite your email address."
    : message;
}

// A failed Google or Microsoft sign-in comes back with the reason in the URL. Read it once, then tidy the URL.
const redirectError = (() => {
  const params = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1));
  const description = params.get('error_description');
  if (!params.get('error')) return '';
  window.history.replaceState(null, '', returnUrl());
  return friendlyError(description ?? 'Sign-in failed. Please try again.');
})();

/** Which sign-in providers are turned on in Supabase, so only working buttons are shown. */
function useEnabledProviders() {
  const [enabled, setEnabled] = useState({ azure: false, google: false });
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((s) => setEnabled({ azure: !!s.external?.azure, google: !!s.external?.google }))
      .catch(() => {
        // If settings can't be read, the email link still works.
      });
    return () => ac.abort();
  }, []);
  return enabled;
}

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
  const [error, setError] = useState(redirectError);
  const providers = useEnabledProviders();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Invite-only: never create an account from the sign-in form.
      options: { shouldCreateUser: false, emailRedirectTo: returnUrl() },
    });
    if (error) {
      setState('idle');
      setError(friendlyError(error.message));
    } else {
      setState('sent');
    }
  }

  async function signInWith(provider: 'google' | 'azure') {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      // Microsoft needs the email scope to return the user's address.
      options: { redirectTo: returnUrl(), scopes: provider === 'azure' ? 'email' : undefined },
    });
    if (error) setError(friendlyError(error.message));
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
            {error && <p className="auth-error" role="alert">{error}</p>}
            {(providers.azure || providers.google) && (
              <>
                <div className="sso-buttons">
                  {providers.azure && (
                    <button type="button" className="btn sso" onClick={() => signInWith('azure')}>
                      <MicrosoftLogo /> Continue with Microsoft
                    </button>
                  )}
                  {providers.google && (
                    <button type="button" className="btn sso" onClick={() => signInWith('google')}>
                      <GoogleLogo /> Continue with Google
                    </button>
                  )}
                </div>
                <div className="auth-divider"><span>or get a link by email</span></div>
              </>
            )}
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
            <button type="submit" className="btn primary" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
