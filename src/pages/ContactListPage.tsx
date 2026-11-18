import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContactForm } from '../components/ContactForm';
import { Confirm } from '../components/Dialog';
import { MultiSelect } from '../components/MultiSelect';
import {
  activeFilterCount,
  EMPTY_LIST_FILTERS,
  companyLabel,
  displayName,
  filtersFromParams,
  filtersToParams,
  followUpState,
  formatDate,
  initials,
  matchesListFilters,
  type ListFilters,
} from '../lib/filters';
import { formatMoney } from '../lib/geo';
import { useSession } from '../lib/session';
import { exportContacts, useContacts } from '../lib/store';
import { CATEGORIES, CUSTOMER_TYPES, REGIONS, STATUSES, type Contact, type Status } from '../types';
import { slug } from '../components/ProspectCard';

type Kind = 'prospects' | 'contacts';
type Tab = 'all' | 'prospects' | 'other';
type SortKey = 'name' | 'company' | 'status' | 'followUp' | 'value' | 'activity' | 'assigned';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'prospects', label: 'Prospects' },
  { id: 'other', label: 'Other contacts' },
];

/** The Prospects page, and the Contacts page with its All / Prospects / Other contacts tabs. */
export default function ContactListPage({ kind }: { kind: Kind }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile, people, business } = useSession();
  const { contacts, loading, lastActivity, updateMany, archive } = useContacts();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [campaignDraft, setCampaignDraft] = useState('');

  const filters = filtersFromParams(params);
  const tab: Tab = kind === 'prospects' ? 'prospects' : ((params.get('tab') as Tab) ?? 'all');
  const sort = (params.get('sort') as SortKey) ?? 'name';
  const dir = params.get('dir') === 'desc' ? -1 : 1;
  const showProspectColumns = tab === 'prospects';

  const setFilters = (next: ListFilters) => {
    setParams(filtersToParams(next, params), { replace: true });
    setSelected(new Set());
  };
  const set = <K extends keyof ListFilters>(k: K) => (v: ListFilters[K]) => setFilters({ ...filters, [k]: v });
  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    setParams(p, { replace: true });
  };

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const campaigns = useMemo(() => [...new Set(contacts.flatMap((c) => c.campaigns))].sort((a, b) => a.localeCompare(b)), [contacts]);

  const rows = useMemo(() => {
    const inScope = contacts.filter(
      (c) =>
        c.business === business &&
        (tab === 'all' || (tab === 'prospects' ? c.isProspect : !c.isProspect)) &&
        matchesListFilters(c, filters, profile.id),
    );
    const key = (c: Contact): string | number => {
      switch (sort) {
        case 'company':
          return companyLabel(c).toLowerCase() || '￿';
        case 'status':
          return c.isProspect ? STATUSES.indexOf(c.status) : 99;
        case 'followUp':
          return c.followUpOn ?? '￿';
        case 'value':
          return -(c.dealValue ?? -1);
        case 'activity':
          return lastActivity[c.id] ? -Date.parse(lastActivity[c.id]) : Infinity;
        case 'assigned':
          return (c.assignedTo && peopleById[c.assignedTo]?.displayName.toLowerCase()) || '￿';
        default:
          return `${c.lastName} ${c.firstName} ${c.company}`.trim().toLowerCase();
      }
    };
    return inScope.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb));
      return cmp * dir || displayName(a).localeCompare(displayName(b));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, business, tab, params, lastActivity, peopleById, profile.id]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortBy = (key: SortKey) => {
    const p = new URLSearchParams(params);
    p.set('sort', key);
    if (sort === key && dir === 1) p.set('dir', 'desc');
    else p.delete('dir');
    setParams(p, { replace: true });
  };

  const header = (key: SortKey, label: string, className = '') => (
    <th className={className} aria-sort={sort === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => sortBy(key)}>
        {label}
        {sort === key && <span aria-hidden="true">{dir === 1 ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  );

  const title = kind === 'prospects' ? 'Prospects' : 'Contacts';
  const noun = tab === 'prospects' ? 'prospect' : 'contact';
  const filterCount = activeFilterCount(filters);
  const ids = selectedRows.map((r) => r.id);

  return (
    <div className="list-page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <span className="muted">
            {loading ? 'Loading…' : `${rows.length} ${noun}${rows.length === 1 ? '' : 's'} · ${business}`}
          </span>
        </div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          + New {kind === 'prospects' || tab === 'prospects' ? 'prospect' : 'contact'}
        </button>
      </header>

      {kind === 'contacts' && (
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => {
                setParam('tab', t.id === 'all' ? '' : t.id);
                setSelected(new Set());
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="list-filters">
        <label className="search-box">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Name, company, email or phone"
            aria-label="Search"
            value={filters.text}
            onChange={(e) => set('text')(e.target.value)}
          />
        </label>
        {tab !== 'other' && <MultiSelect label="Status" options={STATUSES} value={filters.statuses} onChange={set('statuses')} />}
        <MultiSelect label="Customer type" options={CUSTOMER_TYPES} value={filters.customerTypes} onChange={set('customerTypes')} />
        {tab !== 'other' && (
          <>
            <MultiSelect label="Category" options={CATEGORIES} value={filters.categories} onChange={set('categories')} />
            <MultiSelect label="Region" options={REGIONS} value={filters.regions} onChange={set('regions')} />
            <MultiSelect label="Campaign" options={campaigns} value={filters.campaigns} onChange={set('campaigns')} />
          </>
        )}
        <button
          type="button"
          className={`chip-btn ${filters.followUpOnly ? 'active' : ''}`}
          aria-pressed={filters.followUpOnly}
          onClick={() => set('followUpOnly')(!filters.followUpOnly)}
        >
          Follow up
        </button>
        <select
          className={`chip-select ${filters.assigned ? 'active' : ''}`}
          aria-label="Assigned to"
          value={filters.assigned}
          onChange={(e) => set('assigned')(e.target.value)}
        >
          <option value="">Assigned: anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {people
            .filter((p) => p.id !== profile.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </select>
        {filterCount > 0 && (
          <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_LIST_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      {selectedRows.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <strong>{selectedRows.length} selected</strong>
          {selectedRows.some((r) => r.isProspect) && (
            <select
              aria-label="Set status"
              value=""
              onChange={(e) => e.target.value && updateMany(ids.filter((id) => rows.find((r) => r.id === id)?.isProspect), { status: e.target.value as Status })}
            >
              <option value="">Set status…</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          <select
            aria-label="Assign to"
            value=""
            onChange={(e) => e.target.value && updateMany(ids, { assignedTo: e.target.value === 'none' ? undefined : e.target.value })}
          >
            <option value="">Assign to…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
            <option value="none">Nobody</option>
          </select>
          <form
            className="bulk-campaign"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = campaignDraft.trim();
              if (!name) return;
              // Each contact keeps its own campaigns, so add the new one per row.
              await Promise.all(
                selectedRows
                  .filter((r) => !r.campaigns.includes(name))
                  .map((r) => updateMany([r.id], { campaigns: [...r.campaigns, name] })),
              );
              setCampaignDraft('');
            }}
          >
            <input list="campaign-names" placeholder="Add to campaign…" value={campaignDraft} onChange={(e) => setCampaignDraft(e.target.value)} />
            <datalist id="campaign-names">
              {campaigns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button type="submit" className="btn small" disabled={!campaignDraft.trim()}>
              Add
            </button>
          </form>
          {selectedRows.some((r) => !r.isProspect) && (
            <button type="button" className="btn small" onClick={() => updateMany(selectedRows.filter((r) => !r.isProspect).map((r) => r.id), { isProspect: true })}>
              Make prospect
            </button>
          )}
          <button
            type="button"
            className="btn small"
            onClick={() => exportContacts(selectedRows, `${title.toLowerCase()}-${new Date().toLocaleDateString('en-CA')}.csv`)}
          >
            Export CSV
          </button>
          <button type="button" className="btn small danger-outline" onClick={() => setConfirmArchive(true)}>
            Archive
          </button>
          <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="contact-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  ref={(el) => el && (el.indeterminate = selectedRows.length > 0 && !allSelected)}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              {header('name', 'Name')}
              {header('company', tab === 'prospects' ? 'Company' : 'Title & company', 'hide-sm')}
              <th className="hide-sm">Phone</th>
              {showProspectColumns ? header('status', 'Status') : <th className="hide-md">Email</th>}
              <th className="hide-md">Customer types</th>
              {header('followUp', 'Follow-up')}
              {showProspectColumns && header('value', 'Deal value', 'hide-md num')}
              {header('assigned', 'Assigned', 'hide-md')}
              {header('activity', 'Last activity', 'hide-sm')}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const company = companyLabel(c);
              const assignee = c.assignedTo ? peopleById[c.assignedTo] : undefined;
              const last = lastActivity[c.id];
              return (
                <tr key={c.id} className={selected.has(c.id) ? 'selected' : ''} onClick={() => navigate(`/contacts/${c.id}`)}>
                  <td className="col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${displayName(c)}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td>
                    <div className="name-cell">
                      <span className={`avatar sm ${c.isProspect ? `s-${slug(c.status)}` : 'other'}`}>{initials(c)}</span>
                      <div>
                        <Link to={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()}>
                          {displayName(c)}
                        </Link>
                        <div className="muted small show-sm">{company || c.title}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">
                    {tab === 'prospects' ? company || <span className="muted">Individual</span> : [c.title, company].filter(Boolean).join(' · ')}
                  </td>
                  <td className="hide-sm nowrap">
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/\D/g, '')}`} onClick={(e) => e.stopPropagation()}>
                        {c.phone}
                      </a>
                    )}
                  </td>
                  {showProspectColumns ? (
                    <td>
                      <span className={`tag s-${slug(c.status)}`}>{c.status}</span>
                    </td>
                  ) : (
                    <td className="hide-md">
                      {c.email && (
                        <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>
                          {c.email}
                        </a>
                      )}
                      {tab === 'all' && c.isProspect && <span className="tag prospect-tag">Prospect</span>}
                    </td>
                  )}
                  <td className="hide-md">{c.customerTypes.join(', ')}</td>
                  <td className="nowrap">
                    {c.followUpOn && <span className={`due due-${followUpState(c.followUpOn)}`}>{formatDate(c.followUpOn)}</span>}
                  </td>
                  {showProspectColumns && <td className="hide-md num">{c.dealValue ? formatMoney(c.dealValue) : ''}</td>}
                  <td className="hide-md">{assignee?.displayName ?? ''}</td>
                  <td className="hide-sm muted nowrap">{last ? formatDate(last) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="empty">
            <strong>No {noun}s{filterCount ? ' match these filters' : ` in ${business} yet`}.</strong>
            <span>{filterCount ? 'Try clearing some filters.' : `Add one with “New ${noun}”.`}</span>
          </div>
        )}
      </div>

      {creating && (
        <ContactForm
          initial={{ isProspect: kind === 'prospects' || tab === 'prospects', business }}
          onClose={() => setCreating(false)}
          onSaved={(c) => navigate(`/contacts/${c.id}`)}
        />
      )}
      {confirmArchive && (
        <Confirm
          title={`Archive ${selectedRows.length} ${selectedRows.length === 1 ? noun : `${noun}s`}?`}
          message="They'll be hidden from Hub but can be restored from the Archive page."
          confirmLabel="Archive"
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            setConfirmArchive(false);
            await archive(ids);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
