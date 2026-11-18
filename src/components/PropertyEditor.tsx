import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { Dialog } from './Dialog';
import { PlaceSearch } from './PlaceSearch';
import { reverseGeocode } from '../lib/services';
import { CATEGORIES, type Category, type LatLng, type Place, type Property } from '../types';
import type { PropertyInput } from '../lib/store';

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const SOUTHERN_ONTARIO: L.LatLngBoundsExpression = [
  [42.8, -81.4],
  [44.7, -77.8],
];

const dotIcon = L.divIcon({ className: '', html: '<div class="pin dot"></div>', iconSize: [0, 0] });
const dragIcon = L.divIcon({ className: '', html: '<div class="target-pin drag"><span></span></div>', iconSize: [0, 0] });

/** Fits the map to the given points whenever they change. */
function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 13));
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** A small read-only map of a contact's properties. */
export function PropertiesMap({ properties, onPick }: { properties: Property[]; onPick?: (p: Property) => void }) {
  return (
    <MapContainer bounds={SOUTHERN_ONTARIO} className="mini-map" scrollWheelZoom={false}>
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      <FitTo points={properties} />
      {properties.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={dotIcon} eventHandlers={{ click: () => onPick?.(p) }}>
          <Tooltip direction="top" offset={[0, -8]}>
            {p.address}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

function ClickToPlace({ onPlace }: { onPlace: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPlace({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

interface EditorProps {
  property?: Property;
  onClose: () => void;
  onSave: (input: PropertyInput) => Promise<void>;
  onRemove?: () => void;
}

/** Add or edit a property: search the address, then drag the pin (or click the map) to fine-tune. */
export function PropertyEditor({ property, onClose, onSave, onRemove }: EditorProps) {
  const [address, setAddress] = useState(property?.address ?? '');
  const [pos, setPos] = useState<LatLng | null>(property ? { lat: property.lat, lng: property.lng } : null);
  const [acres, setAcres] = useState(property?.acres != null ? String(property.acres) : '');
  const [category, setCategory] = useState<Category>(property?.category ?? 'Agricultural');
  const [relation, setRelation] = useState<Property['relation']>(property?.relation ?? 'Owns');
  const [search, setSearch] = useState<Place | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fitPoints = useMemo(() => (search ? [search] : pos && property ? [pos] : []), [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (p: LatLng, label?: string) => {
    setPos(p);
    setError('');
    if (label) setAddress(label);
    else if (!address.trim()) reverseGeocode(p).then((l) => setAddress((a) => a || l)).catch(() => {});
  };

  async function save() {
    if (!pos) return setError('Search for the address or click the map to place the pin.');
    if (!address.trim()) return setError('Enter the address.');
    const n = Number(acres);
    if (acres.trim() && (!Number.isFinite(n) || n < 0)) return setError('Acres must be a number.');
    setSaving(true);
    await onSave({ address: address.trim(), lat: pos.lat, lng: pos.lng, acres: acres.trim() ? n : undefined, category, relation });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog
      title={property ? 'Edit property' : 'Add a property'}
      onClose={onClose}
      wide
      footer={
        <>
          {onRemove && (
            <button type="button" className="btn danger-outline footer-left" onClick={onRemove}>
              Remove property
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : property ? 'Save' : 'Add property'}
          </button>
        </>
      }
    >
      <div className="property-editor">
        <PlaceSearch
          placeholder="Search the address, then press Enter"
          value={search}
          onSelect={(p) => {
            setSearch(p);
            if (p) place(p, p.label);
          }}
        />
        <div className="editor-map-wrap">
          <MapContainer bounds={SOUTHERN_ONTARIO} className="editor-map">
            <TileLayer url={TILES} attribution={ATTRIBUTION} />
            <FitTo points={fitPoints} />
            <ClickToPlace onPlace={(p) => place(p)} />
            {pos && (
              <Marker
                position={[pos.lat, pos.lng]}
                icon={dragIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    setPos({ lat: ll.lat, lng: ll.lng });
                  },
                }}
              />
            )}
          </MapContainer>
          <div className="map-hint">{pos ? 'Drag the pin to the exact spot' : 'Search above, or click the map to drop a pin'}</div>
        </div>
        <div className="form-grid">
          <label className="field span-2">
            <span>Address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 4295 Regional Rd 8, Elfrida" />
          </label>
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Relationship</span>
            <select value={relation} onChange={(e) => setRelation(e.target.value as Property['relation'])}>
              <option>Owns</option>
              <option>Interested in</option>
            </select>
          </label>
          <label className="field">
            <span>Acres</span>
            <input inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
