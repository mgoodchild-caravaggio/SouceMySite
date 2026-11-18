import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createCampaign, useCampaigns, type CampaignStatus } from '../lib/campaigns';
import { formatDate } from '../lib/filters';
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
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.displayName ?? '';

  async function create() {
    setCreating(true);
    try {
      navigate(`/campaigns/${await createCampaign(business, profile.id)}`);
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
            Marketing email to contacts with consent · {business}
            {profile.role !== 'admin' && ' · You can draft; an admin sends'}
          </span>
        </div>
        <button type="button" className="btn primary" onClick={create} disabled={creating}>
          + New campaign
        </button>
      </header>
      {(error || createError) && <p className="notice warn">{error || createError}</p>}

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
            {campaigns?.map((c) => {
              const s = c.stats;
              const when = c.status === 'scheduled' && c.scheduledFor ? `for ${formatDate(c.scheduledFor)}` : c.finishedAt ? formatDate(c.finishedAt) : c.startedAt ? formatDate(c.startedAt) : `edited ${formatDate(c.updatedAt)}`;
              return (
                <tr key={c.id} onClick={() => navigate(`/campaigns/${c.id}`)}>
                  <td>
                    <Link to={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{c.name}</strong>
                    </Link>
                    <div className="muted small">{c.subject || '(no subject yet)'}</div>
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
        {campaigns?.length === 0 && (
          <div className="empty">
            <strong>No campaigns in {business} yet.</strong>
            <span>Start one with “New campaign”. Only contacts with email consent will receive it.</span>
          </div>
        )}
        {!campaigns && !error && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
      </div>
    </div>
  );
}
