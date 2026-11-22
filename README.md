# AEGIS // Global Strategic Situation Room

A spy-thriller inspired tactical command dashboard featuring a glowing wireframe world map, interactive 3D holographic globe, real-time public global data feeds, and customizable HUD panels.

## Features

- **2D Wireframe World Map & 3D Holographic Globe**: HiDPI Canvas rendering with Natural Earth vector coastlines and country borders (`world-atlas` + `d3-geo`), lat/lon graticule, MGRS cursor readout, zoom/pan/3D drag rotation, and tactical scanline sweep.
- **9 Live Public Data Feeds + Simulated Spy Ops** (all independently toggleable in the collapsible `DATA FEEDS` tray, zero API keys required):
  - **ISS / NORAD Satellites** (`CelesTrak` + `Where The ISS At?` + `satellite.js` SGP4 real-time orbital propagation)
  - **USGS Live Earthquakes** (M2.5+ past 24h seismic shockwaves)
  - **NASA EONET** (live global wildfires, volcanoes, severe storms, sea ice)
  - **Live Military / Tactical Aircraft** (`ADSB.lol` ADS-B transponders with real-time heading dead-reckoning)
  - **RIPE RIS Live BGP Stream** (real-time WebSocket pulsing global IXP Route Collectors `RRC00`–`RRC26`)
  - **UN / EU GDACS Crisis Alerts** (live Red / Orange / Green global humanitarian alerts)
  - **Open-Meteo Atmospheric & Wind Telemetry** (global wind vectors + live `LOCAL WX` for any locked target)
  - **Wikipedia Live Global Edits** (multi-language `EN`/`DE`/`JA`/`FR` real-time edit pulse)
  - **NOAA Space Weather** (live Planetary Kp geomagnetic index, polar aurora ovals, plus **GOES-18 Solar X-Ray Flux** & **GOES-19 Magnetometer** 6-hour telemetry charts)
- **Tactical HUD & Interactive Controls**:
  - Sliding left/right sidebars, edge dock handles, **MAP ONLY** focus mode (`H`), individually collapsible panels (`▾` / `▸`), vertical panel splitters, horizontal sidebar width resizers, and `localStorage` layout persistence.
  - Multi-hop global **SIGNAL TRACE** animation (`T`), **ALERT** breach mode (`A`), interactive **DEFCON 5–1**, 4 phosphor color themes (**Cyan**, **Amber**, **Emerald**, **Crimson**), CRT scanline toggle, optional Web Audio synthesized SFX (`M`), and an interactive command bar (`AEGIS://CMD >`).

## Running Locally

```bash
npm install
npm run dev
```

Then open **http://127.0.0.1:4173/**.

*(Live public APIs are proxied cleanly through Vite's dev server in `vite.config.js` to avoid browser CORS issues.)*

## Keyboard Shortcuts & CLI

- `[` / `]` — Slide left / right sidebar in or out
- `H` — Toggle **MAP ONLY** focus mode
- `G` — Switch between **2D MAP** and **3D GLOBE**
- `T` — Run multi-hop signal trace
- `A` — Toggle red alert simulation
- `1`–`6` — Toggle map overlay layers
- `R` — Reset map view · `M` — Toggle SFX · `F` — Fullscreen · `/` — Focus command bar
- CLI commands: `help`, `trace [city]`, `focus <city|iss|callsign>`, `feed <ops|sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar>`, `live on|off`, `spectrum goes|bgp|rf`, `mode 2d|globe`, `theme cyan|amber|emerald|crimson`, `defcon <1-5>`, `maponly`, `resetlayout`
