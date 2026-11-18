import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createCampaign, createMatchCampaign, STAGES, useCampaigns, type CampaignStatus, type Stage } from '../lib/campaigns';
import { formatDate } from '../lib/filters';
import { fetchStageCounts } from '../lib/members';
import { useSession } from '../lib/session';

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Stopped',
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

/** All campaigns in the current business, with headline results. */
export default function CampaignsPage() {
  const { business, profile, people } = useSession();
  const { campaigns, error } = useCampaigns(business);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [view, setView] = useState<'match' | 'email'>(() => (sessionStorage.getItem('hub.campaignView') === 'email' ? 'email' : 'match'));
  const [stageCounts, setStageCounts] = useState<Map<string, Partial<Record<Stage, number>>>>(new Map());
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.displayName ?? '';

  useEffect(() => {
    fetchStageCounts().then(setStageCounts);
  }, []);
  const pickView = (v: 'match' | 'email') => {
    setView(v);
    try {
      sessionStorage.setItem('hub.campaignView', v);
    } catch {
      /* storage may be blocked */
    }
  };
  const matching = campaigns?.filter((c) => c.kind === 'match') ?? null;
  const emails = campaigns?.filter((c) => c.kind === 'email') ?? null;
  const parentName = (id?: string) => campaigns?.find((c) => c.id === id)?.name;

  async function create(kind: 'match' | 'email') {
    setCreating(true);
    try {
      navigate(`/campaigns/${kind === 'match' ? await createMatchCampaign(business, 'New matching campaign') : await createCampaign(business, profile.id)}`);
    } catch (e) {
      setCreateError((e as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="list-page">
      <header className="page-head">
        <div>
          <h1>Campaigns</h1>
          <span className="muted">
            {view === 'match' ? 'Find and work the people who fit a listing, a buyer or an area' : 'Marketing email to contacts with consent'} · {business}
            {view === 'email' && profile.role !== 'admin' && ' · You can draft; an admin sends'}
          </span>
        </div>
        <div className="inline-actions">
          <button type="button" className={view === 'match' ? 'btn primary' : 'btn'} onClick={() => create('match')} disabled={creating}>
            + Matching campaign
          </button>
          <button type="button" className={view === 'email' ? 'btn primary' : 'btn'} onClick={() => create('email')} disabled={creating}>
            + Email blast
          </button>
        </div>
      </header>
      {(error || createError) && <p className="notice warn">{error || createError}</p>}

      <div className="tabs page-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'match'} className={view === 'match' ? 'on' : ''} onClick={() => pickView('match')}>
          Matching {matching && `(${matching.length})`}
        </button>
        <button type="button" role="tab" aria-selected={view === 'email'} className={view === 'email' ? 'on' : ''} onClick={() => pickView('email')}>
          Email blasts {emails && `(${emails.length})`}
        </button>
      </div>

      {view === 'match' ? (
        <div className="table-wrap">
          <table className="contact-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th className="num">On the list</th>
                <th className="hide-sm">Stages</th>
                <th className="hide-md">Updated</th>
              </tr>
            </thead>
            <tbody>
              {matching?.map((c) => {
                const counts = stageCounts.get(c.id) ?? {};
                const total = Object.entries(counts).reduce((n, [k, v]) => (k === 'suggested' ? n : n + (v ?? 0)), 0);
                return (
                  <tr key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}>
                    <td>
                      <Link to={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{c.name}</strong>
                      </Link>
                      <div className="muted small">{c.opportunityId ? 'Built on a listing or requirement' : c.criteria.area ? `Area: ${c.criteria.area.label || 'on the map'}` : 'Filters'}</div>
                    </td>
                    <td>
                      <span className={`tag ${c.matchStatus === 'active' ? 'opp-open' : ''}`}>{c.matchStatus === 'active' ? 'Active' : 'Closed'}</span>
                    </td>
                    <td className="num">{total}</td>
                    <td className="hide-sm">
                      <div className="stage-chips">
                        {STAGES.filter((s) => s.id !== 'suggested' && counts[s.id]).map((s) => (
                          <span key={s.id} className={`stage-chip st-${s.id}`}>
                            {counts[s.id]} {s.label.toLowerCase()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="hide-md nowrap">{formatDate(c.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {matching?.length === 0 && (
            <div className="empty">
              <strong>No matching campaigns in {business} yet.</strong>
              <span>Start one here, or from a listing or requirement on a contact's page (“Start a campaign”).</span>
            </div>
          )}
          {!campaigns && !error && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
        </div>
      ) : (

      <div className="table-wrap">
        <table className="contact-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th className="hide-sm">From</th>
              <th className="num">Recipients</th>
              <th className="num hide-sm">Opened</th>
              <th className="num hide-sm">Clicked</th>
              <th className="num hide-md">Unsubscribed</th>
            </tr>
          </thead>
          <tbody>
            {emails?.map((c) => {
              const s = c.stats;
              const when = c.status === 'scheduled' && c.scheduledFor ? `for ${formatDate(c.scheduledFor)}` : c.finishedAt ? formatDate(c.finishedAt) : c.startedAt ? formatDate(c.startedAt) : `edited ${formatDate(c.updatedAt)}`;
              return (
                <tr key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td>
                    <Link to={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{c.name}</strong>
                    </Link>
                    <div className="muted small">
                      {c.subject || '(no subject yet)'}
                      {c.parentId && parentName(c.parentId) && ` · to the “${parentName(c.parentId)}” list`}
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className={`tag camp-status cs-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    <div className="muted small">{when}</div>
                  </td>
                  <td className="hide-sm">{nameOf(c.senderId)}</td>
                  <td className="num">{s?.recipients ?? '—'}</td>
                  <td className="num hide-sm">{s ? pct(s.opened, s.sent + s.bounced) : '—'}</td>
                  <td className="num hide-sm">{s ? pct(s.clicked, s.sent + s.bounced) : '—'}</td>
                  <td className="num hide-md">{s?.unsubscribed ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {emails?.length === 0 && (
          <div className="empty">
            <strong>No email blasts in {business} yet.</strong>
            <span>Start one with “Email blast”, or from a matching campaign's list. Only contacts with email consent will receive it.</span>
          </div>
        )}
        {!campaigns && !error && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
      </div>
      )}
    </div>
  );
}
