import { defineConfig } from 'vite';

// Skip unused experimental WASM/pthreads bundle re-exported by satellite.js v7
const skipUnusedSatelliteWasm = {
  name: 'skip-unused-satellite-wasm',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './wasm/index.js' && importer?.includes('satellite.js')) {
      return '\0empty-satellite-wasm';
    }
    return null;
  },
  load(id) {
    if (id === '\0empty-satellite-wasm') return 'export {};';
    return null;
  },
};

export default defineConfig({
  plugins: [skipUnusedSatelliteWasm],
  worker: { format: 'es' },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/live-api/usgs': {
        target: 'https://earthquake.usgs.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/usgs/, ''),
      },
      '/live-api/eonet': {
        target: 'https://eonet.gsfc.nasa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/eonet/, ''),
      },
      '/live-api/iss': {
        target: 'https://api.wheretheiss.at',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/iss/, ''),
      },
      '/live-api/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/celestrak/, ''),
      },
      '/live-api/adsb': {
        target: 'https://api.adsb.lol',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/adsb/, ''),
      },
      '/live-api/noaa': {
        target: 'https://services.swpc.noaa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/noaa/, ''),
      },
      '/live-api/gdacs': {
        target: 'https://www.gdacs.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/gdacs/, ''),
      },
      '/live-api/meteo': {
        target: 'https://api.open-meteo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/meteo/, ''),
      },
      '/live-api/wiki-en': {
        target: 'https://en.wikipedia.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/wiki-en/, ''),
      },
      '/live-api/wiki-de': {
        target: 'https://de.wikipedia.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/wiki-de/, ''),
      },
      '/live-api/wiki-ja': {
        target: 'https://ja.wikipedia.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/wiki-ja/, ''),
      },
      '/live-api/wiki-fr': {
        target: 'https://fr.wikipedia.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-api\/wiki-fr/, ''),
      },
      '/live-ws/ripe': {
        target: 'wss://ris-live.ripe.net',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/live-ws\/ripe/, ''),
      },
    },
  },
});
