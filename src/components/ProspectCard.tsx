import { displayName, initials } from '../lib/filters';
import { formatKm, formatMoney } from '../lib/geo';
import type { Match, Mode } from '../types';

interface Props {
  match: Match;
  mode: Mode;
  searchActive: boolean;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
}

export function ProspectCard({ match, mode, searchActive, selected, hovered, onSelect, onHover }: Props) {
  const { prospect: p, property, distanceKm, alongKm } = match;
  const extra = p.properties.length - 1;

  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button type="button" className="card-hit" onClick={onSelect} aria-label={`Open ${p.firstName} ${p.lastName}`} />
      <header className="card-head">
        <div className={`avatar s-${slug(p.status)}`}>{initials(p)}</div>
        <div className="card-title">
          <h3>
            {displayName(p)}
          </h3>
          <div className="muted">{p.company === 'tbd' ? 'Individual' : p.company}</div>
        </div>
        {p.dealValue && <div className="deal">{formatMoney(p.dealValue)}</div>}
      </header>

      {searchActive && (
        <div className="dist">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 11s4-3.6 4-6.5A4 4 0 0 0 2 4.5C2 7.4 6 11 6 11Z" fill="currentColor" />
          </svg>
          {mode === 'near'
            ? `${formatKm(distanceKm)} away`
            : `${formatKm(distanceKm)} off route · ${formatKm(alongKm ?? 0)} along`}
        </div>
      )}

      <div className="card-prop">
        {property.address}
        {property.acres && <span className="muted"> · {property.acres} ac</span>}
        {extra > 0 && <span className="muted"> · +{extra} more</span>}
      </div>

      <div className="tags">
        <span className={`status s-${slug(p.status)}`}>{p.status}</span>
        {p.customerTypes.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
        {p.followUp && <span className="tag flag">Follow up</span>}
      </div>

      <a className="phone" href={`tel:${p.phone.replace(/[^\d]/g, '')}`} onClick={(e) => e.stopPropagation()}>
        {p.phone}
      </a>
    </article>
  );
}

export const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
