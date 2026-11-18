import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { SessionProvider, useSession } from './lib/session';
import { ContactsProvider } from './lib/store';
import { supabase } from './lib/supabase';
import MapPage from './pages/MapPage';
import { ComingSoon } from './pages/ComingSoon';
import { BUSINESSES } from './types';

export default function App({ session }: { session: Session }) {
  const [error, setError] = useState('');
  const reportError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <SessionProvider session={session}>
      <ContactsProvider onError={reportError}>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<ComingSoon page="dashboard" />} />
              <Route path="map" element={<MapPage />} />
              <Route path="prospects" element={<ComingSoon page="prospects" />} />
              <Route path="contacts" element={<ComingSoon page="contacts" />} />
              <Route path="contacts/:id" element={<ComingSoon page="contacts" />} />
              <Route path="archive" element={<ComingSoon page="archive" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        {error && (
          <div className="toast app-toast" role="alert">
            {error}
          </div>
        )}
      </ContactsProvider>
    </SessionProvider>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z' },
  { to: '/map', label: 'Map', icon: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9.4a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z' },
  { to: '/prospects', label: 'Prospects', icon: 'M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Z' },
  { to: '/contacts', label: 'Contacts', icon: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 1c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4Zm-8 .1C5.6 13.3 1 14.5 1 17v3h5v-3c0-1.5.8-2.8 2-3.9Z' },
  { to: '/archive', label: 'Archive', icon: 'M20 6H4V4h16v2Zm-1 2H5v12h14V8Zm-9 3h4v2h-4v-2Z' },
];

/** Sidebar (bottom bar on phones) with the business switch, around every page. */
function Shell() {
  const { profile, business, setBusiness } = useSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor" />
              <circle cx="12" cy="10" r="2.6" fill="#fff" />
            </svg>
          </span>
          <span>Hub</span>
        </div>

        <div className="business-switch" role="radiogroup" aria-label="Business">
          {BUSINESSES.map((b) => (
            <button key={b} role="radio" aria-checked={business === b} className={business === b ? 'on' : ''} onClick={() => setBusiness(b)}>
              {b}
            </button>
          ))}
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d={n.icon} fill="currentColor" />
              </svg>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="who">
            <span className="name">{profile.displayName}</span>
            <span className="muted small">{profile.role === 'admin' ? 'Admin' : 'Member'}</span>
          </div>
          <button type="button" className="btn small" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
