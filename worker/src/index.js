/**
 * RoDub FileList — Cloudflare Worker care expune categoria „RO Dubbed" de pe FileList ca un
 * addon Stremio cu infoHash, ca RoDub să-l poată folosi drept „URL sursă".
 *
 * De ce există: API-ul FileList dă doar fișierul .torrent (binar), iar runtime-ul Nuvio
 * primește răspunsurile HTTP ca text UTF-8, deci nu poate calcula hash-ul pe telefon.
 *
 *   GET /<ACCESS_TOKEN>/manifest.json
 *   GET /<ACCESS_TOKEN>/stream/movie/tt1234567.json
 *   GET /<ACCESS_TOKEN>/stream/series/tt1234567:1:3.json
 *
 * Addon separat de catalog pentru copii (vezi catalog.js):
 *   GET /<ACCESS_TOKEN>/kids/manifest.json
 *   GET /<ACCESS_TOKEN>/kids/catalog/<type>/<id>[/skip=N].json
 *   GET /<ACCESS_TOKEN>/kids/meta/<type>/<tt…>.json   – metadate (preluate de la Cinemeta)
 *   GET /<ACCESS_TOKEN>/kids/refresh     – o rundă de actualizare a indexului (și din cron)
 *
 * Varianta personală a plugin-ului RoDub, cu cheile incluse (vezi personal.js):
 *   GET /<ACCESS_TOKEN>/plugin/manifest.json
 *   GET /<ACCESS_TOKEN>/plugin/rodub.js
 *
 * Secrete (wrangler secret put): ACCESS_TOKEN, FILELIST_USERNAME, FILELIST_PASSKEY, TMDB_API_KEY,
 * TORBOX_API_KEY (doar pentru varianta personală a plugin-ului).
 * KV: CACHE (hash-uri permanent, căutări câteva ore, indexul catalogului).
 */
import { infoHash } from './bencode.js';
import { FILELIST_API, RO_DUBBED_CATEGORY } from './filelist.js';
import { KIDS_MANIFEST, catalogFor, metaFor, parseExtra, refreshIndex } from './catalog.js';
import { personalBundle, personalManifest } from './personal.js';

export { FILELIST_API, RO_DUBBED_CATEGORY };

const SEARCH_TTL_SECONDS = 6 * 3600;
const MAX_RESULTS = 30;
// Planul gratuit Cloudflare permite 50 de subrequest-uri per cerere și 6 conexiuni simultane.
const MAX_TORRENT_DOWNLOADS = 20;
const DOWNLOAD_CONCURRENCY = 5;
const USER_AGENT = 'RoDub-FileList-Worker';

const MANIFEST = {
    id: 'ro.rodub.filelist',
    version: '1.0.0',
    name: 'RoDub FileList',
    description: 'Release-uri din categoria RO Dubbed de pe FileList, cu infoHash (pentru RoDub).',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

function notFound() {
    return new Response('Not found', { status: 404 });
}

// Comparație în timp constant, ca token-ul să nu poată fi ghicit caracter cu caracter.
function safeEqual(a, b) {
    const x = String(a);
    const y = String(b);
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    }
    return diff === 0;
}

function formatSize(bytes) {
    const gb = Number(bytes) / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(Number(bytes) / 1024 ** 2).toFixed(0)} MB`;
}

function parseId(type, rawId) {
    const id = decodeURIComponent(rawId);
    const m = /^(tt\d+)(?::(\d+):(\d+))?$/.exec(id);
    if (!m) return null;
    if (type === 'series') return m[2] ? { imdbId: m[1], season: Number(m[2]), episode: Number(m[3]) } : null;
    if (type === 'movie') return { imdbId: m[1] };
    return null;
}

async function cacheGet(env, key) {
    if (!env.CACHE) return null;
    try {
        return await env.CACHE.get(key);
    } catch (e) {
        return null;
    }
}

async function cachePut(env, key, value, ttl) {
    if (!env.CACHE) return;
    try {
        await env.CACHE.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
    } catch (e) {
        // Cache-ul e doar o optimizare (limita gratuită KV e 1000 de scrieri/zi).
    }
}

function authHeader(env) {
    return 'Basic ' + btoa(`${env.FILELIST_USERNAME}:${env.FILELIST_PASSKEY}`);
}

// Căutare după IMDb în categoria RO Dubbed. La seriale filtrăm doar pe sezon: cu `episode`
// FileList exclude pachetele de sezon, iar episodul îl alege RoDub din fișierele torrentului.
export async function searchFileList(env, imdbId, season) {
    const cacheKey = `search:${imdbId}:${season || 0}`;
    const cached = await cacheGet(env, cacheKey);
    if (cached) return JSON.parse(cached);

    const params = new URLSearchParams({
        action: 'search-torrents',
        type: 'imdb',
        query: imdbId,
        category: String(RO_DUBBED_CATEGORY),
    });
    if (season) params.set('season', String(season));

    const res = await fetch(`${FILELIST_API}?${params}`, {
        headers: { Authorization: authHeader(env), 'User-Agent': USER_AGENT },
    });
    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = null;
    }
    if (res.status === 429) throw new UpstreamError('FileList: prea multe cereri (429), încearcă mai târziu');
    if (data && !Array.isArray(data) && data.error) throw new UpstreamError(`FileList: ${data.error}`);
    if (!res.ok || !Array.isArray(data)) throw new UpstreamError(`FileList a răspuns cu HTTP ${res.status}`);

    const torrents = data
        .map((t) => ({
            id: t.id,
            name: t.name,
            size: t.size,
            seeders: t.seeders,
            downloadLink: t.download_link,
        }))
        .sort((a, b) => (b.seeders || 0) - (a.seeders || 0))
        .slice(0, MAX_RESULTS);
    await cachePut(env, cacheKey, JSON.stringify(torrents), SEARCH_TTL_SECONDS);
    return torrents;
}

class UpstreamError extends Error {}

// Hash-ul unui torrent nu se schimbă niciodată: îl memorăm permanent după id-ul FileList.
async function downloadHash(env, torrent) {
    const res = await fetch(torrent.downloadLink, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`descărcare .torrent: HTTP ${res.status}`);
    const hash = await infoHash(await res.arrayBuffer());
    await cachePut(env, `hash:${torrent.id}`, hash);
    return hash;
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export async function streamsFor(env, type, rawId) {
    const parsed = parseId(type, rawId);
    if (!parsed) return [];
    const torrents = await searchFileList(env, parsed.imdbId, parsed.season);

    let downloads = 0;
    const hashes = await mapLimit(torrents, DOWNLOAD_CONCURRENCY, async (t) => {
        try {
            const cached = await cacheGet(env, `hash:${t.id}`);
            if (cached) return cached;
            if (downloads >= MAX_TORRENT_DOWNLOADS) return null;
            downloads++;
            return await downloadHash(env, t);
        } catch (e) {
            console.error(`[RoDub worker] torrent ${t.id}: ${e.message}`);
            return null;
        }
    });

    return torrents
        .map((t, i) => (hashes[i] ? toStream(t, hashes[i]) : null))
        .filter(Boolean);
}

// Numele de pe FileList nu spun „Dublat"; marcajul [RO Dubbed] trece filtrul de dublaj din RoDub.
function toStream(torrent, hash) {
    return {
        name: 'FileList\nRO Dubbed',
        title: `${torrent.name} [RO Dubbed]\n👤 ${torrent.seeders || 0} 💾 ${formatSize(torrent.size)} ⚙️ FileList`,
        infoHash: hash,
        behaviorHints: { bingeGroup: 'rodub-filelist' },
    };
}

export async function handle(request, env) {
    if (request.method !== 'GET') return json({ error: 'metodă nepermisă' }, 405);
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (!env.ACCESS_TOKEN || parts.length < 2 || !safeEqual(parts[0], env.ACCESS_TOKEN)) return notFound();
    if (!env.FILELIST_USERNAME || !env.FILELIST_PASSKEY) {
        return json({ error: 'worker-ul nu are FILELIST_USERNAME/FILELIST_PASSKEY configurate' }, 500);
    }

    const rest = parts.slice(1);
    if (rest[0] === 'kids') return handleKids(env, rest.slice(1));
    if (rest[0] === 'plugin') return handlePlugin(env, rest.slice(1), `${url.origin}/${parts[0]}`);
    if (rest.length === 1 && rest[0] === 'manifest.json') return json(MANIFEST);
    if (rest.length === 3 && rest[0] === 'stream' && rest[2].endsWith('.json')) {
        try {
            const streams = await streamsFor(env, rest[1], rest[2].slice(0, -5));
            return json({ streams });
        } catch (e) {
            if (e instanceof UpstreamError) return json({ error: e.message }, 502);
            throw e;
        }
    }
    return notFound();
}

async function handlePlugin(env, rest, workerBase) {
    if (rest.length !== 1) return notFound();
    try {
        if (rest[0] === 'manifest.json') return json(await personalManifest(workerBase));
        if (rest[0] === 'rodub.js') {
            return new Response(await personalBundle(env, workerBase), {
                headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
            });
        }
    } catch (e) {
        return json({ error: e.message }, 502);
    }
    return notFound();
}

async function handleKids(env, rest) {
    if (rest.length === 1 && rest[0] === 'manifest.json') return json(KIDS_MANIFEST);
    if (rest.length === 1 && rest[0] === 'refresh') {
        if (!env.TMDB_API_KEY) return json({ error: 'worker-ul nu are TMDB_API_KEY configurat' }, 500);
        return json(await refreshIndex(env));
    }
    if (rest[0] === 'meta' && rest.length === 3 && rest[2].endsWith('.json')) {
        const meta = await metaFor(rest[1], decodeURIComponent(rest[2].slice(0, -5)));
        return meta ? json(meta) : notFound();
    }
    if (rest[0] === 'catalog' && (rest.length === 3 || rest.length === 4) && rest[rest.length - 1].endsWith('.json')) {
        if (!env.TMDB_API_KEY) return json({ error: 'worker-ul nu are TMDB_API_KEY configurat' }, 500);
        const type = rest[1];
        const id = rest.length === 3 ? rest[2].slice(0, -5) : rest[2];
        const { skip } = parseExtra(rest.length === 4 ? rest[3].slice(0, -5) : '');
        const metas = await catalogFor(env, type, id, skip);
        return metas ? json({ metas }) : notFound();
    }
    return notFound();
}

export default {
    async fetch(request, env) {
        try {
            // HEAD (Nuvio TV îl folosește ca să afle mărimea codului) = GET fără corp.
            if (request.method === 'HEAD') {
                const res = await handle(new Request(request.url, { method: 'GET', headers: request.headers }), env);
                return new Response(null, { status: res.status, headers: res.headers });
            }
            return await handle(request, env);
        } catch (e) {
            console.error('[RoDub worker]', e && e.message);
            return json({ error: 'eroare internă' }, 500);
        }
    },

    // Cron (wrangler.toml → [triggers]): actualizează treptat indexul catalogului dublat.
    async scheduled(event, env, ctx) {
        if (!env.CACHE || !env.TMDB_API_KEY || !env.FILELIST_USERNAME || !env.FILELIST_PASSKEY) return;
        ctx.waitUntil(refreshIndex(env).then(
            (stats) => console.log('[RoDub worker] index', JSON.stringify(stats)),
            (e) => console.error('[RoDub worker] index', e && e.message)
        ));
    },
};
