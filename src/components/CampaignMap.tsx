import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Area } from '../lib/campaigns';
import type { LatLng } from '../types';

export interface CampaignPin {
  key: string;
  contactId: string;
  lat: number;
  lng: number;
  label: string;
  /** CSS colour; leaflet paths need real colours, not variables. */
  color: string;
  /** Members are solid; suggestions are hollow. */
  member: boolean;
  selected?: boolean;
}

// SVG path colours are set as attributes, where CSS variables don't resolve, so they live here.
export const STAGE_COLOR: Record<string, string> = {
  suggested: '#94a3b8',
  shortlisted: '#0f766e',
  contacted: '#2563eb',
  interested: '#16a34a',
  not_interested: '#b91c1c',
  offer: '#b7791f',
};
export const SUGGESTION_COLOR = '#d97706';
const SUBJECT_COLOR = '#0f172a';

const SOUTHERN_ONTARIO: L.LatLngBoundsExpression = [
  [42.8, -81.4],
  [44.7, -77.8],
];

interface Props {
  pins: CampaignPin[];
  area?: Area;
  /** The listing's land or the requirement's centre, drawn as a dark marker. */
  subject?: LatLng & { label: string; radiusKm?: number };
  onPinClick: (pin: CampaignPin) => void;
  /** When set, clicking the map moves the search area here. */
  onMapClick?: (p: LatLng) => void;
}

/** The campaign's map: the search area, the subject, members coloured by stage and suggestions in amber. */
export function CampaignMap({ pins, area, subject, onPinClick, onMapClick }: Props) {
  return (
    <MapContainer bounds={SOUTHERN_ONTARIO} className="map campaign-map" zoomControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit pins={pins} area={area} subject={subject} />
      {onMapClick && <Clicks onClick={onMapClick} />}
      {area && <Circle center={[area.lat, area.lng]} radius={area.radiusKm * 1000} pathOptions={{ color: '#0f766e', weight: 1.5, dashArray: '6 6', fillOpacity: 0.05 }} />}
      {pins.map((p) => (
        <CircleMarker
          key={p.key}
          center={[p.lat, p.lng]}
          radius={p.selected ? 10 : 7}
          pathOptions={{ color: p.color, weight: p.member ? 2 : 2.5, fillColor: p.color, fillOpacity: p.member ? 0.85 : 0.15 }}
          eventHandlers={{ click: () => onPinClick(p) }}
        >
          <Tooltip>{p.label}</Tooltip>
        </CircleMarker>
      ))}
      {subject && (
        <CircleMarker center={[subject.lat, subject.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: SUBJECT_COLOR, fillOpacity: 1 }}>
          <Tooltip permanent={false}>{subject.label}</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}

function Clicks({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Fits the area (or the subject and pins) once the map has a size, then again whenever the area moves. */
function Fit({ pins, area, subject }: Pick<Props, 'pins' | 'area' | 'subject'>) {
  const map = useMap();
  const fittedFor = useRef('');
  const areaKey = area ? `${area.lat},${area.lng},${area.radiusKm}` : '';
  const havePins = pins.length > 0;

  useEffect(() => {
    const el = map.getContainer();
    const fit = () => {
      if (!el.clientHeight) return;
      map.invalidateSize();
      const key = areaKey || (subject ? `s${subject.lat},${subject.lng}` : havePins ? 'pins' : '');
      if (!key || fittedFor.current === key) return;
      fittedFor.current = key;
      if (area) map.fitBounds(L.latLng(area.lat, area.lng).toBounds(area.radiusKm * 2000 * 1.1), { animate: false });
      // Centre on the listing (about 15 km around it) or the buyer's search area, not on every far-off match.
      else if (subject) map.fitBounds(L.latLng(subject.lat, subject.lng).toBounds((subject.radiusKm ?? 15) * 2000 * 1.1), { animate: false });
      else {
        const pts = pins.map((p) => L.latLng(p.lat, p.lng));
        if (pts.length === 1) map.setView(pts[0], 12, { animate: false });
        else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 13, animate: false });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // Pins change constantly as people are added; refit only when the area, subject or "any pins" changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, areaKey, subject?.lat, subject?.lng, havePins]);
  return null;
}
