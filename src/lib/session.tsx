import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Business } from '../types';

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  currentBusiness: Business;
}

interface SessionValue {
  session: Session;
  profile: Profile;
  /** Everyone's profiles, for "assigned to" and "by whom". */
  people: Profile[];
  business: Business;
  setBusiness: (b: Business) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  current_business: Business;
}

const fromRow = (r: ProfileRow): Profile => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name || r.email,
  role: r.role,
  currentBusiness: r.current_business,
});

/** Loads the signed-in user's profile and the team list, and remembers the business switch per user. */
export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [business, setBusinessState] = useState<Business>('Real Estate');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, email, display_name, role, current_business')
      .order('display_name')
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const list = (data as ProfileRow[]).map(fromRow);
        setPeople(list);
        const me = list.find((p) => p.id === session.user.id);
        if (me) setBusinessState(me.currentBusiness);
      });
  }, [session.user.id]);

  const setBusiness = useCallback(
    (b: Business) => {
      setBusinessState(b);
      supabase.from('profiles').update({ current_business: b }).eq('id', session.user.id).then(() => {});
    },
    [session.user.id],
  );

  if (error) {
    return (
      <div className="auth-screen">
        <p className="auth-error">Couldn't load your profile: {error}</p>
      </div>
    );
  }
  if (!people) {
    return (
      <div className="auth-screen">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  // A brand-new user's profile is created by the database; fall back to the session until it appears.
  const profile = people.find((p) => p.id === session.user.id) ?? {
    id: session.user.id,
    email: session.user.email ?? '',
    displayName: session.user.email ?? '',
    role: 'member' as const,
    currentBusiness: business,
  };

  return (
    <SessionContext.Provider value={{ session, profile, people, business, setBusiness }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
