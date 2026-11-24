import dns from 'node:dns';
import https from 'node:https';
import { defineConfig } from 'vite';

// Prefer IPv4 A records on dual-stack hosts (e.g. api.open-meteo.com) where IPv6 blackholes in Node TLSWrap
dns.setDefaultResultOrder('ipv4first');

const ipv4HttpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  timeout: 18000,
});

function makeHttpProxy(prefix, target) {
  return {
    target,
    changeOrigin: true,
    agent: ipv4HttpsAgent,
    timeout: 18000,
    proxyTimeout: 18000,
    rewrite: (p) => p.replace(new RegExp('^/live-api/' + prefix), ''),
    configure: (proxy) => {
      proxy.on('error', (err, _req, res) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.code || 'PROXY_ERROR' }));
        }
      });
    },
  };
}

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

const LIVE_PROXY = {
  '/live-api/usgs': makeHttpProxy('usgs', 'https://earthquake.usgs.gov'),
  '/live-api/eonet': makeHttpProxy('eonet', 'https://eonet.gsfc.nasa.gov'),
  '/live-api/iss': makeHttpProxy('iss', 'https://api.wheretheiss.at'),
  '/live-api/celestrak': makeHttpProxy('celestrak', 'https://celestrak.org'),
  '/live-api/adsb': makeHttpProxy('adsb', 'https://api.adsb.lol'),
  '/live-api/noaa': makeHttpProxy('noaa', 'https://services.swpc.noaa.gov'),
  '/live-api/gdacs': makeHttpProxy('gdacs', 'https://www.gdacs.org'),
  '/live-api/meteo': makeHttpProxy('meteo', 'https://api.open-meteo.com'),
  '/live-api/wiki-en': makeHttpProxy('wiki-en', 'https://en.wikipedia.org'),
  '/live-api/wiki-de': makeHttpProxy('wiki-de', 'https://de.wikipedia.org'),
  '/live-api/wiki-ja': makeHttpProxy('wiki-ja', 'https://ja.wikipedia.org'),
  '/live-api/wiki-fr': makeHttpProxy('wiki-fr', 'https://fr.wikipedia.org'),
  '/live-api/ioda': makeHttpProxy('ioda', 'https://api.ioda.inetintel.cc.gatech.edu'),
  '/live-api/ooni': makeHttpProxy('ooni', 'https://api.ooni.io'),
  '/live-api/launches': makeHttpProxy('launches', 'https://ll.thespacedevs.com'),
  '/live-api/gdelt': makeHttpProxy('gdelt', 'https://api.gdeltproject.org'),
  '/live-api/bbc': makeHttpProxy('bbc', 'https://feeds.bbci.co.uk'),
  '/live-api/airq': makeHttpProxy('airq', 'https://air-quality-api.open-meteo.com'),
  '/live-api/ndbc': makeHttpProxy('ndbc', 'https://www.ndbc.noaa.gov'),
  '/live-api/factbook': makeHttpProxy('factbook', 'https://cdn.jsdelivr.net'),
  '/live-api/worldbank': makeHttpProxy('worldbank', 'https://api.worldbank.org'),
  '/live-ws/ripe': {
    target: 'wss://ris-live.ripe.net',
    ws: true,
    changeOrigin: true,
    agent: ipv4HttpsAgent,
    rewrite: (p) => p.replace(/^\/live-ws\/ripe/, ''),
    configure: (proxy) => {
      proxy.on('error', () => {});
      proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
        socket.on('error', () => {});
      });
      proxy.on('open', (proxySocket) => {
        proxySocket.on('error', () => {});
      });
    },
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
    proxy: LIVE_PROXY,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: LIVE_PROXY,
  },
});
