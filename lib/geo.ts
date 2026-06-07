import type { GeoPoint, GeoPolygon } from "../types/game";

const EARTH_RADIUS_M = 6371000;

export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const x =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function isInsidePolygon(point: GeoPoint, polygon: GeoPolygon): boolean {
  const coords = polygon.coordinates[0];
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0];
    const yi = coords[i][1];
    const xj = coords[j][0];
    const yj = coords[j][1];
    const intersect =
      yi > point.lng !== yj > point.lng &&
      point.lat < ((xj - xi) * (point.lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Offset a lat/lng by random meters within a given radius (for radar jam). */
export function randomOffset(point: GeoPoint, radiusM: number): GeoPoint {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * radiusM;
  const dLat = (dist * Math.cos(angle)) / EARTH_RADIUS_M;
  const dLng =
    (dist * Math.sin(angle)) /
    (EARTH_RADIUS_M * Math.cos(toRad(point.lat)));
  return {
    lat: point.lat + (dLat * 180) / Math.PI,
    lng: point.lng + (dLng * 180) / Math.PI,
  };
}

export function compassDirection(bearing: number): string {
  const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return dirs[Math.round(bearing / 45) % 8];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Returns a scale factor based on the bounding-box diagonal of a game area polygon.
 * Reference: 1000 m diagonal → 1.0. Clamped to [0.5, 3.0].
 * Used to size ability radii proportionally to the play area.
 */
export function computeGameAreaScale(polygon: GeoPolygon): number {
  const coords = polygon.coordinates[0]; // [lng, lat] pairs
  const lats = coords.map((c) => c[1]);
  const lngs = coords.map((c) => c[0]);
  const diagonal = haversineDistance(
    { lat: Math.min(...lats), lng: Math.min(...lngs) },
    { lat: Math.max(...lats), lng: Math.max(...lngs) }
  );
  return Math.min(3.0, Math.max(0.5, diagonal / 1000));
}
