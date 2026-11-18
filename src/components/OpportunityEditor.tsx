import L from 'leaflet';
import { useEffect, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Dialog } from './Dialog';
import { PlaceSearch } from './PlaceSearch';
import { reverseGeocode } from '../lib/services';
import {
  DRAFT_NOTE,
  LISTING_STATUSES,
  REQUIREMENT_STATUSES,
  SERVICING_LABEL,
  ZONING_SUGGESTIONS,
  useOpportunities,
  type Opportunity,
  type OpportunityInput,
  type OpportunityKind,
  type Servicing,
} from '../lib/opportunities';
import { CATEGORIES, REGIONS, type Category, type Contact, type Region } from '../types';

const SOUTHERN_ONTARIO: L.LatLngBoundsExpression = [
  [42.8, -81.4],
  [44.7, -77.8],
];
const centreIcon = L.divIcon({ className: '', html: '<div class="target-pin"><span></span></div>', iconSize: [0, 0] });

interface Props {
  contact: Contact;
  kind: OpportunityKind;
  opportunity?: Opportunity;
  onClose: () => void;
}

const parseNum = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return v.trim() && Number.isFinite(n) ? n : undefined;
};

/** Add or edit a listing (a property being shopped) or a requirement (what a buyer wants). */
export function OpportunityEditor({ contact, kind, opportunity, onClose }: Props) {
  const { save } = useOpportunities();
  const isListing = kind === 'listing';
  const firstProperty = contact.properties[0];

  const [o, setO] = useState<OpportunityInput>(() =>
    opportunity
      ? { ...opportunity }
      : {
          contactId: contact.id,
          kind,
          listingType: isListing ? 'off_market' : undefined,
          propertyId: isListing ? firstProperty?.id : undefined,
          title: isListing ? (firstProperty ? `Listing: ${firstProperty.address}` : 'Listing') : 'Looking for land',
          status: 'open',
          categories: isListing && firstProperty ? [firstProperty.category] : contact.categories.slice(0, 3),
          acresMin: isListing ? firstProperty?.acres : undefined,
          acresMax: isListing ? firstProperty?.acres : undefined,
          priceMin: isListing ? contact.dealValue : undefined,
          priceMax: undefined,
          zoning: [],
          servicing: 'unknown',
          targetDate: undefined,
          assemblyWanted: false,
          assemblyMinAcres: undefined,
          areaLat: undefined,
          areaLng: undefined,
          areaRadiusKm: undefined,
          areaLabel: '',
          regions: isListing ? [] : contact.regions,
          needsDetail: false,
          notes: '',
        },
  );
  const [zoningDraft, setZoningDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof OpportunityInput>(k: K, v: OpportunityInput[K]) => setO((x) => ({ ...x, [k]: v }));
  const toggle = <T extends string>(k: 'categories' | 'regions', v: T) => {
    const list = o[k] as T[];
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as never);
  };

  // Picking a different property updates the listing's title, category and size, unless already edited.
  const pickProperty = (id: string) => {
    const p = contact.properties.find((x) => x.id === id);
    setO((x) => ({
      ...x,
      propertyId: id,
      title: !opportunity && p ? `Listing: ${p.address}` : x.title,
      categories: p && !x.categories.length ? [p.category] : x.categories,
      acresMin: p?.acres ?? x.acresMin,
      acresMax: p?.acres ?? x.acresMax,
    }));
  };

  const addZoning = (v: string) => {
    const z = v.trim();
    if (z && !o.zoning.includes(z)) set('zoning', [...o.zoning, z]);
    setZoningDraft('');
  };

  async function submit() {
    setError('');
    if (!o.title.trim()) return setError('Add a title.');
    if (isListing && !o.propertyId) return setError('Choose the property being listed. Add one under Properties first if needed.');
    if (o.acresMin != null && o.acresMax != null && o.acresMin > o.acresMax) return setError('Minimum acres is more than the maximum.');
    if (o.priceMin != null && o.priceMax != null && o.priceMin > o.priceMax) return setError('Minimum budget is more than the maximum.');
    if (!isListing && o.areaLat == null && !o.regions.length) return setError('Set where they are looking: click the map or pick regions.');
    setSaving(true);
    // Saving with real details clears the "needs detail" flag on drafts.
    const err = await save({ ...o, needsDetail: false, notes: o.notes.trim() === DRAFT_NOTE ? '' : o.notes }, opportunity?.id);
    setSaving(false);
    if (err) return setError(err);
    onClose();
  }

  return (
    <Dialog
      title={`${opportunity ? 'Edit' : 'New'} ${isListing ? 'listing' : 'requirement'}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="contact-form">
        {opportunity?.needsDetail && (
          <p className="notice warn small">This was drafted from Salesforce tags. Add acres, budget, area and timing, then save.</p>
        )}

        <div className="form-grid">
          <label className="field span-2">
            <span>Title</span>
            <input value={o.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          {isListing && (
            <>
              <label className="field">
                <span>Property</span>
                <select value={o.propertyId ?? ''} onChange={(e) => pickProperty(e.target.value)}>
                  {!contact.properties.length && <option value="">No properties yet</option>}
                  {contact.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Listing type</span>
                <select value={o.listingType} onChange={(e) => set('listingType', e.target.value as OpportunityInput['listingType'])}>
                  <option value="listed">Listed (Caravaggio agreement)</option>
                  <option value="off_market">Off-market (shopping it informally)</option>
                </select>
              </label>
            </>
          )}
          <label className="field">
            <span>Status</span>
            <select value={o.status} onChange={(e) => set('status', e.target.value as Opportunity['status'])}>
              {(isListing ? LISTING_STATUSES : REQUIREMENT_STATUSES).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{isListing ? 'Seller wants to sell by' : 'Wants to close by'}</span>
            <input type="date" value={o.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value || undefined)} />
          </label>
        </div>

        <fieldset>
          <legend>{isListing ? 'The land' : 'What they want'}</legend>
          <div className="sub-label">Category</div>
          <div className="chip-group">
            {CATEGORIES.map((c) => (
              <label key={c} className={`chip-toggle ${o.categories.includes(c) ? 'on' : ''}`}>
                <input type="checkbox" checked={o.categories.includes(c)} onChange={() => toggle<Category>('categories', c)} />
                {c}
              </label>
            ))}
          </div>
          <div className="form-grid">
            {isListing ? (
              <>
                <label className="field">
                  <span>Acres</span>
                  <input
                    inputMode="decimal"
                    value={o.acresMin ?? ''}
                    onChange={(e) => {
                      const n = parseNum(e.target.value);
                      setO((x) => ({ ...x, acresMin: n, acresMax: n }));
                    }}
                  />
                </label>
                <label className="field">
                  <span>Asking price ($)</span>
                  <input inputMode="numeric" value={o.priceMin ?? ''} onChange={(e) => set('priceMin', parseNum(e.target.value))} />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Acres, from</span>
                  <input inputMode="decimal" value={o.acresMin ?? ''} onChange={(e) => set('acresMin', parseNum(e.target.value))} />
                </label>
                <label className="field">
                  <span>Acres, to</span>
                  <input inputMode="decimal" value={o.acresMax ?? ''} onChange={(e) => set('acresMax', parseNum(e.target.value))} />
                </label>
                <label className="field">
                  <span>Budget, from ($)</span>
                  <input inputMode="numeric" value={o.priceMin ?? ''} onChange={(e) => set('priceMin', parseNum(e.target.value))} />
                </label>
                <label className="field">
                  <span>Budget, to ($)</span>
                  <input inputMode="numeric" value={o.priceMax ?? ''} onChange={(e) => set('priceMax', parseNum(e.target.value))} />
                </label>
              </>
            )}
            <label className="field">
              <span>{isListing ? 'Servicing' : 'Servicing needed'}</span>
              <select value={o.servicing} onChange={(e) => set('servicing', e.target.value as Servicing)}>
                {isListing ? (
                  (Object.keys(SERVICING_LABEL) as Servicing[]).map((s) => (
                    <option key={s} value={s}>
                      {SERVICING_LABEL[s]}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="unknown">Doesn't matter</option>
                    <option value="planned">Serviced or planned</option>
                    <option value="available">Must be serviced now</option>
                  </>
                )}
              </select>
            </label>
          </div>
          <div className="sub-label">{isListing ? 'Zoning / Official Plan designation' : 'Zoning / designations wanted'}</div>
          <div className="chip-group">
            {o.zoning.map((z) => (
              <span key={z} className="chip-toggle on">
                {z}
                <button type="button" className="chip-remove" aria-label={`Remove ${z}`} onClick={() => set('zoning', o.zoning.filter((x) => x !== z))}>
                  ×
                </button>
              </span>
            ))}
            <input
              className="chip-input"
              list="zoning-suggestions"
              placeholder="Add a designation, press Enter"
              value={zoningDraft}
              onChange={(e) => {
                setZoningDraft(e.target.value);
                if (ZONING_SUGGESTIONS.includes(e.target.value)) addZoning(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addZoning(zoningDraft);
                }
              }}
            />
            <datalist id="zoning-suggestions">
              {ZONING_SUGGESTIONS.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          {!isListing && (
            <div className="form-grid">
              <label className="field check-field">
                <input type="checkbox" checked={o.assemblyWanted} onChange={(e) => set('assemblyWanted', e.target.checked)} />
                <span>Land assembly: would combine neighbouring parcels</span>
              </label>
              {o.assemblyWanted && (
                <label className="field">
                  <span>Minimum total acres for the assembly</span>
                  <input inputMode="decimal" value={o.assemblyMinAcres ?? ''} onChange={(e) => set('assemblyMinAcres', parseNum(e.target.value))} />
                </label>
              )}
            </div>
          )}
        </fieldset>

        {!isListing && (
          <fieldset>
            <legend>Where they're looking</legend>
            <AreaPicker
              lat={o.areaLat}
              lng={o.areaLng}
              radiusKm={o.areaRadiusKm}
              label={o.areaLabel}
              onChange={(lat, lng, r, label) => setO((x) => ({ ...x, areaLat: lat, areaLng: lng, areaRadiusKm: r, areaLabel: label ?? x.areaLabel }))}
            />
            <div className="sub-label">And/or regions</div>
            <div className="chip-group">
              {REGIONS.map((r) => (
                <label key={r} className={`chip-toggle ${o.regions.includes(r) ? 'on' : ''}`}>
                  <input type="checkbox" checked={o.regions.includes(r)} onChange={() => toggle<Region>('regions', r)} />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={o.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitCircle({ lat, lng, radiusKm }: { lat?: number; lng?: number; radiusKm?: number }) {
  const map = useMap();
  useEffect(() => {
    if (lat == null || lng == null) return;
    map.fitBounds(L.latLng(lat, lng).toBounds((radiusKm ?? 10) * 2000), { padding: [20, 20], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);
  return null;
}

/** Click (or search) to set the centre of the area a buyer is looking in, then set the radius. */
function AreaPicker({
  lat,
  lng,
  radiusKm,
  label,
  onChange,
}: {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  label: string;
  onChange: (lat?: number, lng?: number, r?: number, label?: string) => void;
}) {
  const r = radiusKm ?? 10;
  // A clicked point gets a place name from OpenStreetMap; the town is the most useful part.
  const pick = (a: number, b: number) => {
    onChange(a, b, r, '');
    reverseGeocode({ lat: a, lng: b }, undefined, 10)
      .then((town) => onChange(a, b, r, /^-?\d/.test(town) ? '' : town.split(', ')[0]))
      .catch(() => {});
  };
  return (
    <div className="area-picker">
      <PlaceSearch placeholder="Search a town or address, then press Enter" value={null} onSelect={(p) => p && onChange(p.lat, p.lng, r, p.label.split(', ')[0])} />
      <div className="editor-map-wrap">
        <MapContainer bounds={SOUTHERN_ONTARIO} className="editor-map">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
          <ClickToSet onPick={pick} />
          <FitCircle lat={lat} lng={lng} radiusKm={r} />
          {lat != null && lng != null && (
            <>
              <Circle center={[lat, lng]} radius={r * 1000} pathOptions={{ color: '#0f766e', weight: 2, fillOpacity: 0.12 }} />
              <Marker position={[lat, lng]} icon={centreIcon} />
            </>
          )}
        </MapContainer>
        <div className="map-hint">{lat == null ? 'Click the map to set the centre of the area' : 'Click to move the centre'}</div>
      </div>
      <div className="range area-radius">
        <label htmlFor="area-radius">Within</label>
        <input id="area-radius" type="range" min={1} max={60} step={1} value={r} disabled={lat == null} onChange={(e) => onChange(lat, lng, Number(e.target.value), label)} />
        <output>{r} km</output>
        {lat != null && label && <span className="muted small">of {label}</span>}
        {lat != null && (
          <button type="button" className="link-btn" onClick={() => onChange(undefined, undefined, undefined, '')}>
            Clear area
          </button>
        )}
      </div>
    </div>
  );
}
