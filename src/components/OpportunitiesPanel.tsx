import { useState } from 'react';
import { Confirm } from './Dialog';
import { OpportunityEditor } from './OpportunityEditor';
import { formatDate } from '../lib/filters';
import {
  formatPrice,
  rangeLabel,
  SERVICING_LABEL,
  statusLabel,
  useOpportunities,
  type Opportunity,
  type OpportunityKind,
} from '../lib/opportunities';
import type { Contact } from '../types';

/** A contact's listings (land being shopped) and requirements (what they want to buy). */
export function OpportunitiesPanel({ contact, disabled }: { contact: Contact; disabled?: boolean }) {
  const { opportunities, remove } = useOpportunities();
  const [editing, setEditing] = useState<{ kind: OpportunityKind; opportunity?: Opportunity } | null>(null);
  const [deleting, setDeleting] = useState<Opportunity | null>(null);
  const [error, setError] = useState('');
  const mine = opportunities.filter((o) => o.contactId === contact.id);
  const listings = mine.filter((o) => o.kind === 'listing');
  const requirements = mine.filter((o) => o.kind === 'requirement');

  const facts = (o: Opportunity) => {
    const property = contact.properties.find((p) => p.id === o.propertyId);
    return [
      o.kind === 'listing' ? (o.listingType === 'listed' ? 'Listed' : 'Off-market') : '',
      property?.address ?? '',
      o.categories.join(', '),
      o.kind === 'listing' ? (o.acresMin != null ? `${o.acresMin} ac` : '') : rangeLabel(o.acresMin, o.acresMax, 'ac'),
      o.kind === 'listing'
        ? o.priceMin != null
          ? `asking ${formatPrice(o.priceMin)}`
          : ''
        : rangeLabel(o.priceMin, o.priceMax, 'budget', formatPrice),
      o.zoning.join(', '),
      o.servicing !== 'unknown' ? (o.kind === 'listing' ? SERVICING_LABEL[o.servicing] : o.servicing === 'available' ? 'Needs servicing' : 'Servicing planned is fine') : '',
      o.kind === 'requirement' && o.areaRadiusKm ? `within ${o.areaRadiusKm} km${o.areaLabel ? ` of ${o.areaLabel}` : ''}` : '',
      o.kind === 'requirement' && o.regions.length ? o.regions.join(', ') : '',
      o.assemblyWanted ? `Assembly${o.assemblyMinAcres ? ` (${o.assemblyMinAcres}+ ac total)` : ''}` : '',
      o.targetDate ? `by ${formatDate(o.targetDate)}` : '',
    ].filter(Boolean);
  };

  const card = (o: Opportunity) => (
    <li key={o.id} className={`opp-card ${o.status !== 'open' ? 'closed' : ''}`}>
      <div className="opp-head">
        <strong>{o.title || (o.kind === 'listing' ? 'Listing' : 'Requirement')}</strong>
        <span className={`tag opp-${o.status}`}>{statusLabel(o.status)}</span>
        {o.needsDetail && <span className="tag needs-detail">Needs detail</span>}
      </div>
      <div className="muted small opp-facts">{facts(o).join(' · ')}</div>
      {o.notes && !o.needsDetail && <p className="opp-notes">{o.notes}</p>}
      {!disabled && (
        <div className="inline-actions">
          <button type="button" className="btn small" onClick={() => setEditing({ kind: o.kind, opportunity: o })}>
            {o.needsDetail ? 'Add details' : 'Edit'}
          </button>
          <button type="button" className="link-btn tl-delete" onClick={() => setDeleting(o)}>
            Delete
          </button>
        </div>
      )}
    </li>
  );

  return (
    <section className="panel" id="opportunities">
      <div className="panel-head">
        <h2>Opportunities</h2>
        {!disabled && (
          <div className="inline-actions">
            <button
              type="button"
              className="btn small"
              disabled={!contact.properties.length}
              title={contact.properties.length ? 'A property this contact is selling or you are shopping' : 'Add a property first'}
              onClick={() => setEditing({ kind: 'listing' })}
            >
              + Listing
            </button>
            <button type="button" className="btn small" onClick={() => setEditing({ kind: 'requirement' })}>
              + Requirement
            </button>
          </div>
        )}
      </div>
      {!mine.length && (
        <p className="muted small">
          No listings or requirements yet. Add a <strong>listing</strong> for land this contact is selling, or a <strong>requirement</strong> for what they want to buy,
          so Hub can match them with others.
        </p>
      )}
      {listings.length > 0 && (
        <>
          <h3 className="opp-group">Listings</h3>
          <ul className="opp-list">{listings.map(card)}</ul>
        </>
      )}
      {requirements.length > 0 && (
        <>
          <h3 className="opp-group">Requirements</h3>
          <ul className="opp-list">{requirements.map(card)}</ul>
        </>
      )}
      {error && <p className="field-error">{error}</p>}

      {editing && <OpportunityEditor contact={contact} kind={editing.kind} opportunity={editing.opportunity} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm
          title={`Delete this ${deleting.kind}?`}
          message={`“${deleting.title}” will be removed. Campaigns built on it later would lose it too.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const o = deleting;
            setDeleting(null);
            const err = await remove(o.id);
            if (err) setError(err);
          }}
        />
      )}
    </section>
  );
}
