import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';

const PAGES = {
  dashboard: {
    title: 'Dashboard',
    next: 'Follow-ups due, pipeline counts, recent activity and a map snapshot are coming next.',
  },
  prospects: {
    title: 'Prospects',
    next: 'A sortable, filterable table of prospects with add, edit and archive is coming next.',
  },
  contacts: {
    title: 'Contacts',
    next: 'A table of everyone, with tabs for prospects and other contacts, plus a page for each contact, is coming next.',
  },
  archive: {
    title: 'Archive',
    next: 'Archived contacts will appear here, ready to restore. Admins will also be able to delete them permanently.',
  },
};

/** Placeholder for pages planned in docs/ROADMAP.md, showing a little live data so it isn't empty. */
export function ComingSoon({ page }: { page: keyof typeof PAGES }) {
  const { business, profile } = useSession();
  const { contacts, loading } = useContacts();
  const inBusiness = contacts.filter((c) => c.business === business);
  const prospects = inBusiness.filter((c) => c.isProspect).length;
  const { title, next } = PAGES[page];

  return (
    <div className="placeholder-page">
      <header className="page-head">
        <h1>{page === 'dashboard' ? `Welcome, ${profile.displayName.split(' ')[0]}` : title}</h1>
        <span className="muted">{business}</span>
      </header>
      <div className="placeholder-card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <p className="stat-line">
            <strong>{prospects}</strong> prospects and <strong>{inBusiness.length - prospects}</strong> other contacts in {business}.
          </p>
        )}
        <p className="muted">{next}</p>
        <Link className="btn primary" to="/map">
          Open the map
        </Link>
      </div>
    </div>
  );
}
