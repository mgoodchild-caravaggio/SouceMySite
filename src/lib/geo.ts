import type { LatLng } from '../types';

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export interface RouteIndex {
  line: [number, number][];
  /** Cumulative km from the start of the route to each vertex. */
  cumKm: number[];
}

export function indexRoute(line: [number, number][]): RouteIndex {
  const cumKm = [0];
  for (let i = 1; i < line.length; i++) {
    const [aLat, aLng] = line[i - 1];
    const [bLat, bLng] = line[i];
    cumKm.push(cumKm[i - 1] + haversineKm({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng }));
  }
  return { line, cumKm };
}

/**
 * Shortest distance from a point to the route, and how far along the route that closest point is.
 * Each segment is projected onto a flat plane centred on the point, which is accurate to well
 * under 1% at the distances we care about (a few km off a route).
 */
export function distanceToRoute(p: LatLng, route: RouteIndex): { distKm: number; alongKm: number } {
  const kx = EARTH_KM * rad(1) * Math.cos(rad(p.lat));
  const ky = EARTH_KM * rad(1);
  let best = { distKm: Infinity, alongKm: 0 };
  const { line, cumKm } = route;

  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][1] - p.lng) * kx;
    const ay = (line[i - 1][0] - p.lat) * ky;
    const bx = (line[i][1] - p.lng) * kx;
    const by = (line[i][0] - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.distKm) {
      best = { distKm: d, alongKm: cumKm[i - 1] + t * (cumKm[i] - cumKm[i - 1]) };
    }
  }
  return best;
}

/** Metres covered by one screen pixel at a given zoom (Web Mercator). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(rad(lat))) / 2 ** zoom;
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  return `$${Math.round(v / 1000)}K`;
}
