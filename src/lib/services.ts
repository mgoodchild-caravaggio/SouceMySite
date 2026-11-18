import type { LatLng, Place, RouteResult } from '../types';
import { haversineKm } from './geo';

// Public OpenStreetMap services. Fine for a prototype; both are rate-limited and
// production use should point these at a paid or self-hosted instance.
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

// Bias search results toward Southern Ontario without excluding the rest of Canada.
const SOUTHERN_ONTARIO_VIEWBOX = '-82.5,45.2,-76.5,42.0';

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL(`${NOMINATIM}/search`);
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'ca',
    viewbox: SOUTHERN_ONTARIO_VIEWBOX,
    limit: '6',
  }).toString();
  const res = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const rows: { lat: string; lon: string; display_name: string }[] = await res.json();
  return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: shortLabel(r.display_name) }));
}

/** A place name for a point. zoom 16 gives a street address; 10 gives the town. */
export async function reverseGeocode(p: LatLng, signal?: AbortSignal, zoom = 16): Promise<string> {
  const url = new URL(`${NOMINATIM}/reverse`);
  url.search = new URLSearchParams({ lat: String(p.lat), lon: String(p.lng), format: 'jsonv2', zoom: String(zoom) }).toString();
  try {
    const res = await fetch(url, { signal, headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error();
    const row: { display_name?: string } = await res.json();
    return row.display_name ? shortLabel(row.display_name) : coordLabel(p);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return coordLabel(p);
  }
}

export async function fetchRoute(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<RouteResult> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  try {
    const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal });
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const body = await res.json();
    const route = body.routes?.[0];
    if (!route) throw new Error('No route found');
    return {
      line: (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng]),
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      approximate: false,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    // Fall back to a straight line so the corridor search still works offline.
    const km = haversineKm(from, to);
    return { line: [[from.lat, from.lng], [to.lat, to.lng]], distanceKm: km, durationMin: (km / 70) * 60, approximate: true };
  }
}

export function currentPosition(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'My location' }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function shortLabel(displayName: string): string {
  // "123, Main Street, Barrie, Simcoe County, Central Ontario, Ontario, L4M 1A1, Canada" -> first 3 useful parts
  return displayName
    .split(', ')
    .filter((p) => !/^(Canada|Ontario|Central Ontario|Golden Horseshoe|Southwestern Ontario|Eastern Ontario)$/.test(p))
    .slice(0, 3)
    .join(', ');
}

function coordLabel(p: LatLng): string {
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}
