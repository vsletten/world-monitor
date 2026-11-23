# AEGIS // Global Strategic Situation Room

A spy-thriller inspired tactical OSINT command dashboard featuring a glowing wireframe world map, interactive 3D holographic globe, real-time public global data feeds, and customizable HUD panels.

## Features

- **2D Wireframe World Map & 3D Holographic Globe**: HiDPI Canvas rendering with `50m` Natural Earth vector coastlines and country borders (`world-atlas` + `d3-geo`), offscreen 2D base-layer caching for crisp 60 FPS panning/zooming, full WGS-84 UTM/MGRS cursor coordinates, real-time **Solar Day/Night Terminator (`7`)**, **16 Subsea Fiber Trunk Cables (`8`)** with click-to-inspect dossiers, overlap hit-cycling, and tactical scanline sweep.
- **Live OSINT Anomalies Panel + Search**: Switch the left operations panel between **LIVE** real-time global anomalies (ranked across ADS-B emergencies, UN GDACS crises, USGS earthquakes, NASA EONET hazards, NOAA geomagnetic storms/flares, and RIPE BGP withdrawal spikes) and **SIM** scenario operations, with instant severity tabs and free-text search.
- **9 Live Public Data Feeds + Simulated Spy Ops** (independently toggleable in the collapsible `DATA FEEDS` tray, zero API keys required):
  - **ISS / NORAD Satellites** (`CelesTrak` + `Where The ISS At?` + Web Worker `satellite.js` SGP4 real-time orbital propagation)
  - **USGS Live Earthquakes** (M2.5+ past 24h seismic shockwaves)
  - **NASA EONET** (live global wildfires, volcanoes, severe storms, sea ice)
  - **Live Military / Tactical Aircraft** (`ADSB.lol` ADS-B transponders with real-time heading dead-reckoning)
  - **RIPE RIS Live BGP Stream** (Web Worker WebSocket ingestion pulsing global IXP Route Collectors `RRC00`–`RRC26`)
  - **UN / EU GDACS Crisis Alerts** (live Red / Orange / Green global humanitarian alerts)
  - **Open-Meteo Atmospheric & Wind Telemetry** (global wind vectors + live `LOCAL WX` for any locked target)
  - **Wikipedia Live Global Edits** (multi-language `EN`/`DE`/`JA`/`FR` real-time edit pulse)
  - **NOAA Space Weather** (live Planetary Kp geomagnetic index, polar aurora ovals, plus **GOES-18 Solar X-Ray Flux** & **GOES-19 Magnetometer** 6-hour telemetry charts)
- **Live-Ticking Target Dossier & OSINT Deep-Links**:
  - Locked live targets auto-refresh coordinates, altitude, packet rates, and telemetry every second without disrupting camera focus, and provide an **`OPEN SOURCE ↗`** button linking directly to USGS, GDACS, NASA EONET, ADSB.lol, CelesTrak/NASA ISS, RIPE Stat, Wikipedia Diffs, Windy, or Submarine Cable Map.
  - Real composite **Anomaly Index** & live OSINT feed health / GOES X-ray telemetry meters when `SPY OPS` is muted.
- **Tactical HUD, Persistence & Interactive CLI**:
  - Sliding left/right sidebars, edge dock handles, **MAP ONLY** focus mode (`H`), individually collapsible panels (`▾` / `▸`), vertical panel splitters, horizontal sidebar width resizers, `localStorage` + URL query state persistence (`?mode=3d&theme=amber&feeds=live&ops=live&focus=iss`), and automatic animation pause on background tabs.
  - Multi-hop **SIGNAL TRACE** animation (`T`) across nodes, live OSINT targets, and satellites, **ALERT** breach mode (`A`), interactive **DEFCON 5–1**, 4 phosphor themes (**Cyan**, **Amber**, **Emerald**, **Crimson**), CRT scanline toggle, optional Web Audio synthesized SFX (`M`), and an interactive command bar (`AEGIS://CMD >`) with `↑`/`↓` history and `Tab` autocomplete.

## Running Locally & Deploying

```bash
npm install
npm run dev
```

Then open **http://127.0.0.1:4173/**.

Production build & preview:

```bash
npm run build
npm run preview
```

*(Live public APIs are proxied cleanly in both `vite dev` and `vite preview` via `vite.config.js`, and on Cloudflare Pages via `functions/api/` edge proxy functions to avoid browser CORS issues.)*

## Keyboard Shortcuts & CLI

- `[` / `]` — Slide left / right sidebar in or out
- `H` — Toggle **MAP ONLY** focus mode
- `G` — Switch between **2D MAP** and **3D GLOBE**
- `T` — Run multi-hop signal trace (supports locked live targets & satellites)
- `A` — Toggle red alert simulation
- `1`–`8` — Toggle map overlay layers (`7`: Solar Terminator, `8`: Subsea Fiber Cables)
- `R` — Reset map view · `M` — Toggle SFX · `F` — Fullscreen · `/` — Focus command bar (`Tab` to autocomplete, `↑`/`↓` for history)
- CLI commands: `help`, `trace [city]`, `focus <city|iss|cable|callsign|anomaly>`, `ops <live|sim>`, `cables [on|off]`, `terminator [on|off]`, `feed <ops|sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar|cables|terminator>`, `live [on|off]`, `refresh`, `spectrum <goes|bgp|rf>`, `mode <2d|globe>`, `theme <cyan|amber|emerald|crimson>`, `defcon <1-5>`, `maponly`, `resetlayout`, `status`
