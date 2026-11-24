# AEGIS // Global Live Telemetry & OSINT Monitor

An open-source, 100% real-time global telemetry and OSINT situation room featuring a wireframe 2D world map, interactive 3D holographic globe, 14 live public data feeds (zero API keys required), interactive World Factbook + World Bank country intelligence, geodesic proximity radar, and customizable HUD panels.

## Features

- **2D Wireframe World Map & 3D Holographic Globe**: HiDPI Canvas rendering with `50m` Natural Earth vector coastlines and country borders (`world-atlas` + `d3-geo`), offscreen 2D base-layer caching for smooth 60 FPS panning/zooming, full WGS-84 UTM/MGRS cursor coordinates, overlap hit-cycling, and 6 independently toggleable visual overlays (`1`–`6`):
  - **Solar Day/Night Terminator (`1`)** — real-time solar declination, twilight zone, and subsolar point
  - **16 Subsea Fiber Trunk Cables (`2`)** — interactive global undersea cables with click-to-inspect dossiers
  - **NOAA Polar Aurora Ovals (`3`)** — geomagnetic aurora activity bands driven by live Planetary Kp
  - **RIPE BGP Peering Arcs (`4`)** — live inter-IXP routing activity arcs
  - **Orbital & Aircraft Ground Tracks (`5`)** — real-time satellite orbital trails and ADS-B flight headings
  - **Lat/Lon Graticule Grid (`6`)** — 15° tactical WGS-84 coordinate grid
- **14 Live Public Data Feeds** (independently toggleable in the collapsible `DATA FEEDS` tray, zero API keys required):
  - **ISS / NORAD Satellites** (`CelesTrak` + `Where The ISS At?` + Web Worker `satellite.js` SGP4 real-time orbital propagation)
  - **USGS Live Earthquakes** (M2.5+ past 24h seismic events, magnitude, focal depth & tsunami flags)
  - **NASA EONET** (live global wildfires, volcanoes, severe storms & natural hazards)
  - **Live Military / Tactical Aircraft** (`ADSB.lol` 1090-ES transponders with heading dead-reckoning)
  - **RIPE RIS Live BGP Stream** (Web Worker WebSocket ingestion monitoring global IXP Route Collectors `RRC00`–`RRC26`)
  - **UN / EU GDACS Crisis Alerts** (live Red / Orange / Green global disaster & humanitarian alerts)
  - **Open-Meteo Atmospheric Telemetry** (global surface wind vectors, pressure & live `LOCAL WX` + US AQI for any locked target)
  - **Wikipedia Live Global Edits** (multi-language `EN`/`DE`/`JA`/`FR` real-time edit pulse)
  - **NOAA Space Weather** (live Planetary Kp index, GOES-18 Solar X-Ray Flux & GOES-19 Magnetometer)
  - **Global Internet Outages & Censorship** (Georgia Tech `IODA` real-time BGP/active-probing outage alerts + `OONI Explorer` ongoing interference reports)
  - **Upcoming Orbital Launches** (`Launch Library 2` global rocket launch manifest with live-ticking `T-` countdowns, pad coordinates & webcast links)
  - **Geocoded Global News Wire** (`BBC World RSS` + `Wikimedia Current Events` geocoded directly to host countries)
  - **Global Air Quality & PM2.5** (`Open-Meteo Air Quality` US AQI, PM2.5, UV index & mineral dust across major global hubs)
  - **NOAA NDBC Ocean Buoys & DART Tsunami Sensors** (live offshore wave height/period, pressure, sea-surface temperature & deep-ocean tsunami pressure sensors)
- **Interactive Country Intelligence (World Factbook Archive + Live World Bank)**:
  - Click any sovereign nation or territory directly on the **2D Map** or **3D Globe** to highlight its borders and load its on-demand intelligence dossier combining the preserved public-domain **World Factbook** archive with live **World Bank Open Data** macro indicators (background summary, capital, government type, population, GDP PPP & per capita, total area, coastline, internet penetration, mobile subscriptions, installed electricity capacity, military expenditure, space agency, natural hazards, and transnational disputes) and deep-linking directly to **OpenFactBook** (`openfactbook.org/countries/<slug>/`).
  - Any locked telemetry event (earthquake, outage, launch, crisis, news dispatch, aircraft, station) automatically resolves its host country and surfaces a contextual **`FACTBOOK`** action button in the Target Dossier.
  - Open any country profile directly via CLI (`factbook japan`, `country ua`) or URL (`?country=japan`).
- **Live Global Events, Global Watch & Telemetry Meters**:
  - **Live Global Watch** indicator (`NOMINAL` → `GUARDED` → `ELEVATED` → `HIGH` → `SEVERE`) derived deterministically from USGS earthquakes, UN GDACS alerts, IODA/OONI outages, NOAA NDBC/DART marine anomalies, NOAA SWPC geomagnetic/flare activity, and ADS-B emergencies; click to focus the highest-priority active event.
  - **Live Global Events** panel ranked across all active feeds with `ALL` / `CRIT` / `WARN` / `INFO` filters and instant free-text search.
  - **6 Live Telemetry Meters**: Feed Health, GOES X-Ray class, NOAA Solar Kp, RIPE BGP packet rate, 24h Seismic peak magnitude/count, and composite Anomaly Index, plus real session uptime.
- **Target Dossier, Geodesic Proximity Scope & 4 Live Telemetry Charts**:
  - **2,500 km Geodesic Proximity Radar**: computes real great-circle distance and true bearing from the locked target to nearby live telemetry contacts across all feeds.
  - Live-ticking target dossiers with contextual telemetry readouts, `CENTER VIEW` / `LOCATE PING` controls, contextual host-country `FACTBOOK` jump, live `LOCAL WX` (with US AQI), and an **`OPEN SOURCE ↗`** deep-link directly to USGS, GDACS, NASA EONET, ADSB.lol, CelesTrak/NASA ISS, RIPE Stat, IODA/OONI, Launch Library/webcasts, BBC/Wikimedia, IQAir, NOAA NDBC, OpenFactBook (`openfactbook.org/countries/<slug>/`), Wikipedia Diffs, Windy, or Submarine Cable Map.
  - **4 Real-Time Telemetry Charts**: **GOES** (NOAA GOES-18 X-Ray & GOES-19 Magnetometer 6h), **BGP** (RIPE RIS per-IXP live update rate), **QUAKES** (USGS 24h seismic magnitude & focal depth distribution), and **SEAS** (NOAA NDBC ocean wave height & global Air Quality).
- **Customizable HUD, Persistence & Interactive CLI**:
  - Sliding left/right sidebars, edge dock handles, **MAP ONLY** focus mode (`H`), individually collapsible panels (`▾` / `▸`), vertical panel splitters, horizontal sidebar width resizers, `localStorage` + URL query state persistence (`?mode=3d&theme=amber&country=japan&focus=iss`), 4 phosphor themes (**Cyan**, **Amber**, **Emerald**, **Crimson**), CRT scanline toggle, optional Web Audio synthesized SFX (`M`), automatic animation pause on background tabs, and an interactive CLI (`AEGIS://CMD >`) with `↑`/`↓` history and `Tab` autocomplete.

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

*(Live public APIs are proxied cleanly in both `vite dev` and `vite preview` via `vite.config.js`, and on Cloudflare Pages via `functions/live-api/` edge proxy functions to avoid browser CORS issues.)*

## Keyboard Shortcuts & CLI

- `1`–`6` — Toggle map overlay layers (`1`: Solar Terminator, `2`: Subsea Cables, `3`: Aurora Ovals, `4`: BGP Arcs, `5`: Orbital/Aircraft Trails, `6`: Lat/Lon Grid)
- `G` — Switch between **2D MAP** and **3D GLOBE**
- `H` — Toggle **MAP ONLY** focus mode
- `[` / `]` — Slide left / right sidebar in or out
- `R` — Reset map view · `M` — Toggle SFX · `F` — Fullscreen · `/` — Focus command bar (`Tab` to autocomplete, `↑`/`↓` for history)
- CLI commands: `help`, `factbook <country>` (alias `country`), `focus <iss|falcon|country|place|cable|callsign|buoy|ixp|event>`, `feed <sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar|outages|launches|news|airq|buoys>`, `feeds <all|none>`, `terminator [on|off]`, `cables [on|off]`, `aurora [on|off]`, `bgparcs [on|off]`, `trails [on|off]`, `grid [on|off]`, `chart <goes|bgp|quakes|seas>` (alias `spectrum`), `refresh`, `mode <2d|globe>`, `panels [left|right|show|hide]`, `maponly`, `resetlayout`, `theme <cyan|amber|emerald|crimson>`, `center`, `ping`, `clear`, `status`
- URL parameters: `?mode=3d&theme=amber&feeds=all&chart=seas&country=japan&focus=iss`
