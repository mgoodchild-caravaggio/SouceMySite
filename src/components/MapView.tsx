import { displayName } from '../lib/filters';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { formatMoney, metresPerPixel } from '../lib/geo';
import type { LatLng, Match, Mode, Place, RouteResult } from '../types';

interface Props {
  /** Every property of every filtered prospect, so out-of-range pins can still be shown muted. */
  pins: Match[];
  searchActive: boolean;
  mode: Mode;
  center: Place | null;
  radiusKm: number;
  origin: Place | null;
  destination: Place | null;
  route: RouteResult | null;
  corridorKm: number;
  selectedId: string | null;
  hoveredId: string | null;
  onMapClick: (p: LatLng) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

// SVG path colours are set as attributes, where CSS variables don't resolve, so they live here.
const ACCENT = '#0f766e';
const ROUTE = '#1d4ed8';

const SOUTHERN_ONTARIO: L.LatLngBoundsExpression = [
  [42.8, -81.4],
  [44.7, -77.8],
];

export function MapView(props: Props) {
  // Becomes true once the container has a size; until then Leaflet can't fit anything properly.
  const [sized, setSized] = useState(false);
  return (
    <MapContainer bounds={SOUTHERN_ONTARIO} className="map" zoomControl={false} preferCanvas={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControlRight />
      <SizeWatcher onSized={() => setSized(true)} />
      <ClickHandler onClick={props.onMapClick} />
      {sized && <Viewport {...props} />}
      <SearchShapes {...props} />
      <Pins {...props} />
    </MapContainer>
  );
}

function ZoomControlRight() {
  const map = useMap();
  useEffect(() => {
    const zc = L.control.zoom({ position: 'bottomright' }).addTo(map);
    return () => {
      zc.remove();
    };
  }, [map]);
  return null;
}

/** Keeps Leaflet in sync with its container, which has no size yet on first render and changes on mobile. */
function SizeWatcher({ onSized }: { onSized: () => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let fitted = false;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!fitted && el.clientHeight > 0) {
        fitted = true;
        map.fitBounds(SOUTHERN_ONTARIO);
        // The viewport mounts only now, so a search area set before the map had a size (a deep link
        // such as match mode) is fitted after this default view, not overwritten by it.
        onSized();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Moves the map when the search area, route or selected prospect changes. */
function Viewport({ mode, center, radiusKm, route, origin, destination, selectedId, pins }: Props) {
  const map = useMap();

  // The first fit jumps rather than flies: a fly started while the page is still laying out gets
  // cut short by Leaflet's resize handling and leaves the map zoomed out.
  const flown = useRef(false);
  useEffect(() => {
    if (mode !== 'near' || !center) return;
    const bounds = L.latLng(center.lat, center.lng).toBounds(radiusKm * 2000 * 1.15);
    if (flown.current) map.flyToBounds(bounds, { duration: 0.6 });
    else map.fitBounds(bounds, { animate: false });
    flown.current = true;
  }, [map, mode, center, radiusKm]);

  useEffect(() => {
    if (mode !== 'route') return;
    if (route) map.flyToBounds(L.latLngBounds(route.line), { padding: [40, 40], duration: 0.6 });
    else if (origin && !destination) map.flyTo([origin.lat, origin.lng], 11, { duration: 0.6 });
    else if (destination && !origin) map.flyTo([destination.lat, destination.lng], 11, { duration: 0.6 });
  }, [map, mode, route, origin, destination]);

  useEffect(() => {
    if (!selectedId) return;
    const pin = pins.find((m) => m.prospect.id === selectedId);
    if (!pin) return;
    const ll = L.latLng(pin.property.lat, pin.property.lng);
    if (!map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll, { animate: true });
    // Only react to a new selection, not to every pin recalculation.
  }, [map, selectedId]);

  return null;
}

function SearchShapes({ mode, center, radiusKm, origin, destination, route, corridorKm }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  // Leaflet polylines are sized in pixels, so convert the corridor width to pixels for this zoom.
  const corridorPx = useMemo(() => {
    if (!route) return 0;
    const midLat = route.line[Math.floor(route.line.length / 2)][0];
    return Math.max(6, (corridorKm * 2000) / metresPerPixel(midLat, zoom));
  }, [route, corridorKm, zoom]);

  return (
    <>
      {mode === 'near' && center && (
        <>
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: ACCENT, weight: 2, fillColor: ACCENT, fillOpacity: 0.07, dashArray: '6 6' }}
            interactive={false}
          />
          <Marker position={[center.lat, center.lng]} icon={targetIcon} interactive={false} />
        </>
      )}
      {mode === 'route' && route && (
        <>
          <Polyline
            positions={route.line}
            pathOptions={{ color: ACCENT, weight: corridorPx, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }}
            interactive={false}
          />
          <Polyline
            positions={route.line}
            pathOptions={{ color: ROUTE, weight: 5, opacity: 0.9, dashArray: route.approximate ? '8 8' : undefined }}
            interactive={false}
          />
        </>
      )}
      {mode === 'route' && origin && <Marker position={[origin.lat, origin.lng]} icon={endpointIcon('A')} interactive={false} />}
      {mode === 'route' && destination && (
        <Marker position={[destination.lat, destination.lng]} icon={endpointIcon('B')} interactive={false} />
      )}
    </>
  );
}

// Below this zoom the deal-value pills overlap, so every pin is drawn as a dot.
const PILL_MIN_ZOOM = 10;

function Pins({ pins, searchActive, selectedId, hoveredId, onSelect, onHover }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const pills = zoom >= PILL_MIN_ZOOM;

  return (
    <>
      {pins.map((m) => {
        const state =
          m.prospect.id === selectedId ? 'selected' : m.prospect.id === hoveredId ? 'hover' : !searchActive || m.inRange ? 'in' : 'out';
        return (
          <Marker
            key={m.property.id}
            position={[m.property.lat, m.property.lng]}
            icon={pinIcon(m, state, pills)}
            zIndexOffset={state === 'selected' ? 2000 : state === 'hover' ? 1500 : state === 'in' ? 500 : 0}
            eventHandlers={{
              click: () => onSelect(m.prospect.id),
              mouseover: () => onHover(m.prospect.id),
              mouseout: () => onHover(null),
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
              <strong>
                {displayName(m.prospect)}
              </strong>
              <br />
              {m.property.address}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

const iconCache = new Map<string, L.DivIcon>();

function pinIcon(m: Match, state: string, pills: boolean): L.DivIcon {
  const value = pills ? m.prospect.dealValue : undefined;
  const key = `${value ?? ''}|${state}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = value
      ? L.divIcon({
          className: '',
          html: `<div class="pin pill ${state}">${formatMoney(value)}</div>`,
          iconSize: [0, 0],
        })
      : L.divIcon({ className: '', html: `<div class="pin dot ${state}"></div>`, iconSize: [0, 0] });
    iconCache.set(key, icon);
  }
  return icon;
}

const targetIcon = L.divIcon({
  className: '',
  html: '<div class="target-pin"><span></span></div>',
  iconSize: [0, 0],
});

function endpointIcon(letter: string) {
  return L.divIcon({ className: '', html: `<div class="endpoint-pin">${letter}</div>`, iconSize: [0, 0] });
}
