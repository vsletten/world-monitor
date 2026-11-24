// ============================================================================
// AEGIS // GLOBAL TELEMETRY GAZETTEER & COORDINATE UTILITIES
// ============================================================================

export const WORLD_PLACES = [
  { id: 'new-york', name: 'New York', region: 'United States', lat: 40.7128, lon: -74.006 },
  { id: 'washington-dc', name: 'Washington D.C.', region: 'United States', lat: 38.9072, lon: -77.0369 },
  { id: 'san-francisco', name: 'San Francisco', region: 'United States', lat: 37.7749, lon: -122.4194 },
  { id: 'anchorage', name: 'Anchorage', region: 'United States', lat: 61.2181, lon: -149.9003 },
  { id: 'london', name: 'London', region: 'United Kingdom', lat: 51.5074, lon: -0.1278 },
  { id: 'reykjavik', name: 'Reykjavik', region: 'Iceland', lat: 64.1466, lon: -21.9426 },
  { id: 'svalbard', name: 'Svalbard', region: 'Norway', lat: 78.2232, lon: 15.6267 },
  { id: 'zurich', name: 'Zurich', region: 'Switzerland', lat: 47.3769, lon: 8.5417 },
  { id: 'vienna', name: 'Vienna', region: 'Austria', lat: 48.2082, lon: 16.3738 },
  { id: 'moscow', name: 'Moscow', region: 'Russia', lat: 55.7558, lon: 37.6173 },
  { id: 'cairo', name: 'Cairo', region: 'Egypt', lat: 30.0444, lon: 31.2357 },
  { id: 'dubai', name: 'Dubai', region: 'United Arab Emirates', lat: 25.2048, lon: 55.2708 },
  { id: 'new-delhi', name: 'New Delhi', region: 'India', lat: 28.6139, lon: 77.209 },
  { id: 'singapore', name: 'Singapore', region: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { id: 'tokyo', name: 'Tokyo', region: 'Japan', lat: 35.6762, lon: 139.6503 },
  { id: 'sydney', name: 'Sydney', region: 'Australia', lat: -33.8688, lon: 151.2093 },
  { id: 'sao-paulo', name: 'São Paulo', region: 'Brazil', lat: -23.5505, lon: -46.6333 },
  { id: 'cape-town', name: 'Cape Town', region: 'South Africa', lat: -33.9249, lon: 18.4241 },
  { id: 'strait-of-hormuz', name: 'Strait of Hormuz', region: 'Persian Gulf / Gulf of Oman', lat: 26.5667, lon: 56.25 },
  { id: 'bab-el-mandeb', name: 'Bab el-Mandeb', region: 'Red Sea / Gulf of Aden', lat: 12.5833, lon: 43.3333 },
  { id: 'suez-canal', name: 'Suez Canal', region: 'Egypt', lat: 30.5852, lon: 32.2654 },
  { id: 'strait-of-malacca', name: 'Strait of Malacca', region: 'Indian Ocean / South China Sea', lat: 2.5, lon: 101.2 },
  { id: 'strait-of-gibraltar', name: 'Strait of Gibraltar', region: 'Atlantic / Mediterranean', lat: 35.9667, lon: -5.5 },
  { id: 'panama-canal', name: 'Panama Canal', region: 'Panama', lat: 9.08, lon: -79.68 },
  { id: 'taiwan-strait', name: 'Taiwan Strait', region: 'East China Sea / South China Sea', lat: 24.4833, lon: 119.8667 },
];

export function formatCoord(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
