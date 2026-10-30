import { formatKm, haversineKm } from '../lib/geo';
import { STATUSES, type LatLng, type Property, type Prospect, type Status } from '../types';
import { slug } from './ProspectCard';

interface Props {
  prospect: Prospect;
  from: LatLng | null;
  onClose: () => void;
  onUpdate: (patch: Partial<Pick<Prospect, 'status' | 'followUp' | 'notes'>>) => void;
  onRouteTo: (p: Property) => void;
}

export function ProspectDetail({ prospect: p, from, onClose, onUpdate, onRouteTo }: Props) {
  return (
    <aside className="detail" aria-label={`${p.firstName} ${p.lastName}`}>
      <div className="detail-top">
        <button type="button" className="back-btn" onClick={onClose}>
          ← Back to results
        </button>
        <span className="muted mono">{p.id}</span>
      </div>

      <div className="detail-head">
        <div className={`avatar lg s-${slug(p.status)}`}>{p.firstName[0] + p.lastName[0]}</div>
        <div>
          <h2>
            {p.firstName} {p.lastName}
          </h2>
          <div className="muted">{p.company === 'tbd' ? 'Individual (company tbd)' : p.company}</div>
        </div>
      </div>

      <div className="actions">
        <a className="btn primary" href={`tel:${p.phone.replace(/[^\d]/g, '')}`}>
          Call {p.phone}
        </a>
        {p.email && (
          <a className="btn" href={`mailto:${p.email}`}>
            Email
          </a>
        )}
      </div>

      <div className="field-row">
        <label className="field">
          <span>Status</span>
          <select value={p.status} onChange={(e) => onUpdate({ status: e.target.value as Status })}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={p.followUp} onChange={(e) => onUpdate({ followUp: e.target.checked })} />
          <span>Follow up</span>
        </label>
      </div>

      <dl className="facts">
        <dt>Est. gross deal value</dt>
        <dd>{p.dealValue ? `$${p.dealValue.toLocaleString()}` : '—'}</dd>
        <dt>Email</dt>
        <dd>{p.email ?? '—'}</dd>
        <dt>Lead source</dt>
        <dd>{p.leadSource}</dd>
        <dt>Customer type</dt>
        <dd className="tags">{p.customerTypes.map((t) => <span key={t} className="tag">{t}</span>)}</dd>
        <dt>Regions</dt>
        <dd className="tags">{p.regions.map((t) => <span key={t} className="tag">{t}</span>)}</dd>
        <dt>Categories</dt>
        <dd className="tags">{p.categories.map((t) => <span key={t} className="tag">{t}</span>)}</dd>
        <dt>Campaigns</dt>
        <dd className="tags">
          {p.campaigns.length ? p.campaigns.map((t) => <span key={t} className="tag camp">{t}</span>) : '—'}
        </dd>
      </dl>

      <h4>Properties ({p.properties.length})</h4>
      <ul className="props">
        {p.properties.map((prop) => (
          <li key={prop.id}>
            <div>
              <div className="prop-addr">{prop.address}</div>
              <div className="muted small">
                {prop.relation} · {prop.category}
                {prop.acres ? ` · ${prop.acres} acres` : ''}
                {from ? ` · ${formatKm(haversineKm(from, prop))} straight-line` : ''}
              </div>
            </div>
            <button type="button" className="btn small" onClick={() => onRouteTo(prop)}>
              Route here
            </button>
          </li>
        ))}
      </ul>

      <label className="field">
        <span>Notes</span>
        <textarea
          rows={4}
          defaultValue={p.notes}
          key={p.id}
          placeholder="Call notes, next steps…"
          onBlur={(e) => e.target.value !== p.notes && onUpdate({ notes: e.target.value })}
        />
      </label>
    </aside>
  );
}
