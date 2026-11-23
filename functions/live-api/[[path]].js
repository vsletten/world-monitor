const UPSTREAMS = Object.freeze({
  usgs: 'https://earthquake.usgs.gov',
  eonet: 'https://eonet.gsfc.nasa.gov',
  iss: 'https://api.wheretheiss.at',
  celestrak: 'https://celestrak.org',
  adsb: 'https://api.adsb.lol',
  noaa: 'https://services.swpc.noaa.gov',
  gdacs: 'https://www.gdacs.org',
  meteo: 'https://api.open-meteo.com',
  'wiki-en': 'https://en.wikipedia.org',
  'wiki-de': 'https://de.wikipedia.org',
  'wiki-ja': 'https://ja.wikipedia.org',
  'wiki-fr': 'https://fr.wikipedia.org',
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

function resolveUpstreamRoute(requestUrl, params) {
  let upstreamKey = '';
  let upstreamPath = '/';

  if (requestUrl.pathname.startsWith('/live-api/')) {
    const remainder = requestUrl.pathname.slice('/live-api/'.length);
    const slashIdx = remainder.indexOf('/');
    upstreamKey = slashIdx === -1 ? remainder : remainder.slice(0, slashIdx);
    upstreamPath = slashIdx === -1 ? '/' : remainder.slice(slashIdx);
  } else if (Array.isArray(params?.path) && params.path.length > 0) {
    upstreamKey = String(params.path[0] || '');
    upstreamPath = params.path.length > 1 ? `/${params.path.slice(1).join('/')}` : '/';
  }

  return { upstreamKey, upstreamPath };
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function onRequestGet(context) {
  const { request, params } = context;
  const requestUrl = new URL(request.url);
  const { upstreamKey, upstreamPath } = resolveUpstreamRoute(requestUrl, params);

  if (!upstreamKey || !Object.hasOwn(UPSTREAMS, upstreamKey)) {
    return jsonResponse(
      { error: 'Unknown upstream prefix', prefix: upstreamKey || null },
      404,
      { 'Cache-Control': 'no-store' },
    );
  }

  const base = UPSTREAMS[upstreamKey];
  let targetUrl;
  try {
    targetUrl = new URL(`${upstreamPath}${requestUrl.search}`, base);
  } catch {
    return jsonResponse({ error: 'Invalid upstream path' }, 400);
  }

  if (targetUrl.origin !== base) {
    return jsonResponse({ error: 'Invalid upstream path' }, 400);
  }

  const upstreamHeaders = new Headers({
    'User-Agent': 'AEGIS-Situation-Room/1.1',
  });
  const accept = request.headers.get('Accept');
  if (accept) {
    upstreamHeaders.set('Accept', accept);
  }

  try {
    const upstreamRes = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
    });

    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Cache-Control', 'public, max-age=15');
    responseHeaders.delete('set-cookie');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: 'Upstream request failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
      { 'Cache-Control': 'no-store' },
    );
  }
}
