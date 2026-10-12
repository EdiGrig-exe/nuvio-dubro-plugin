/**
 * Addon de catalog „RoDub Copii" (doar resursa `catalog`; detaliile vin din Cinemeta,
 * stream-urile din RoDub):
 *
 *   Filme dublate RO / Seriale dublate RO  – titluri din categoria RO Dubbed de pe FileList,
 *       strânse treptat într-un index în KV (cron la 30 min) și îmbogățite cu TMDB (ro-RO).
 *   Filme pentru copii / Seriale pentru copii – TMDB discover, populare.
 *
 * „De copii" = genurile TMDB Animation (16), Family (10751), Kids (10762).
 */
import { FILELIST_API, RO_DUBBED_CATEGORY } from './filelist.js';

const TMDB = 'https://api.themoviedb.org/3';
const POSTER = 'https://image.tmdb.org/t/p/w342';
export const KIDS_GENRES = [16, 10751, 10762];

const INDEX_KEY = 'kids:index';
const PAGE_SIZE = 100;
const DISCOVER_TTL_SECONDS = 12 * 3600;
// Plafoane per rulare, sub limita de 50 de subrequest-uri a planului gratuit.
const QUERIES_PER_RUN = 6;
const LOOKUPS_PER_RUN = 35;

export const CATALOGS = [
    { type: 'movie', id: 'rodub-dub-movies', name: 'Filme dublate RO' },
    { type: 'series', id: 'rodub-dub-series', name: 'Seriale dublate RO' },
    { type: 'movie', id: 'rodub-kids-movies', name: 'Filme pentru copii' },
    { type: 'series', id: 'rodub-kids-series', name: 'Seriale pentru copii' },
];

export const KIDS_MANIFEST = {
    id: 'ro.rodub.kids',
    version: '1.0.0',
    name: 'RoDub Copii',
    description: 'Cataloage pentru copii: titluri dublate în română (FileList) și populare (TMDB).',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: CATALOGS.map((c) => Object.assign({}, c, { extra: [{ name: 'skip' }] })),
};

// Căutările care acoperă biblioteca RO Dubbed (API-ul dă maxim 100 de rezultate pe căutare):
// cele mai noi, apoi pe ani (filme), pe sezoane (seriale) și pe calitate.
export function buildQueries(currentYear) {
    const queries = [{ action: 'latest-torrents' }];
    for (let year = currentYear; year >= 1980; year--) queries.push({ action: 'search-torrents', type: 'name', query: String(year) });
    for (let s = 1; s <= 12; s++) queries.push({ action: 'search-torrents', type: 'name', query: `S${String(s).padStart(2, '0')}` });
    for (const q of ['2160p', '1080p', '720p', 'BDRip', 'DVDRip', 'WEB-DL']) queries.push({ action: 'search-torrents', type: 'name', query: q });
    return queries;
}

function emptyIndex() {
    return { cursor: 0, rounds: 0, titles: {}, pending: [], notFound: [], updatedAt: null };
}

export async function readIndex(env) {
    if (!env.CACHE) return emptyIndex();
    const raw = await env.CACHE.get(INDEX_KEY);
    return raw ? Object.assign(emptyIndex(), JSON.parse(raw)) : emptyIndex();
}

async function fileListQuery(env, query) {
    const params = new URLSearchParams(Object.assign({ category: String(RO_DUBBED_CATEGORY) }, query));
    if (query.action === 'latest-torrents') params.set('limit', '100');
    const res = await fetch(`${FILELIST_API}?${params}`, {
        headers: { Authorization: 'Basic ' + btoa(`${env.FILELIST_USERNAME}:${env.FILELIST_PASSKEY}`) },
    });
    if (res.status === 429) throw new Error('FileList 429');
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) throw new Error(`FileList: ${(data && data.error) || `HTTP ${res.status}`}`);
    return data;
}

async function tmdbJson(env, path, params = {}) {
    const all = Object.assign({ api_key: env.TMDB_API_KEY, language: 'ro-RO' }, params);
    const query = new URLSearchParams(Object.entries(all).filter(([, v]) => v !== '' && v !== undefined));
    const res = await fetch(`${TMDB}${path}?${query}`);
    if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`);
    return res.json();
}

// „Kipo.and.the.Age.of.Wonderbeasts.S03.1080p..." → „Kipo and the Age of Wonderbeasts"
export function nameFromRelease(release) {
    const head = String(release || '').split(/[.\s_](?:19\d{2}|20\d{2}|S\d{2}|\d{3,4}p|BDRip|DVDRip|WEB-DL|Hybrid|PROPER|REPACK)(?:[.\s_-]|$)/i)[0];
    return head.replace(/[._]+/g, ' ').trim();
}

const LATIN = /[A-Za-zĂÂÎȘȚăâîșț]/;

function yearOf(date) {
    return /^\d{4}/.test(date || '') ? Number(date.slice(0, 4)) : null;
}

// IMDb → titlu românesc, poster, an, genuri. null dacă TMDB nu cunoaște titlul.
export async function lookupImdb(env, imdbId, fallbackName) {
    const data = await tmdbJson(env, `/find/${imdbId}`, { external_source: 'imdb_id' });
    const movie = data.movie_results && data.movie_results[0];
    const tv = data.tv_results && data.tv_results[0];
    const hit = movie || tv;
    if (!hit) return null;
    const name = (movie ? hit.title : hit.name) || (movie ? hit.original_title : hit.original_name) || '';
    return {
        t: movie ? 'movie' : 'series',
        // Fără nume în alfabet latin pe TMDB (ex. doar japonez) → numele din release-ul FileList.
        n: LATIN.test(name) || !fallbackName ? name : fallbackName,
        p: hit.poster_path || null,
        y: yearOf(movie ? hit.release_date : hit.first_air_date),
        g: hit.genre_ids || [],
    };
}

/**
 * O rundă de actualizare a indexului: câteva căutări FileList (cu cursor circular) și
 * îmbogățirea TMDB a titlurilor noi. O singură scriere KV per rundă.
 */
export async function refreshIndex(env, now = new Date()) {
    if (!env.CACHE) throw new Error('KV CACHE lipsește');
    const index = await readIndex(env);
    const queries = buildQueries(now.getUTCFullYear());
    const known = new Set(Object.keys(index.titles).concat(index.notFound, index.pending.map((p) => p.imdb)));
    const stats = { queries: 0, found: 0, added: 0, enriched: 0, errors: [] };

    for (let i = 0; i < QUERIES_PER_RUN; i++) {
        const query = queries[index.cursor % queries.length];
        index.cursor = (index.cursor + 1) % queries.length;
        if (index.cursor === 0) index.rounds++;
        try {
            const torrents = await fileListQuery(env, query);
            stats.queries++;
            for (const t of torrents) {
                const imdb = /^tt\d+$/.test(t.imdb || '') ? t.imdb : null;
                if (!imdb) continue;
                stats.found++;
                const uploaded = t.upload_date || '';
                if (index.titles[imdb]) {
                    if (uploaded > (index.titles[imdb].u || '')) index.titles[imdb].u = uploaded;
                } else if (!known.has(imdb)) {
                    known.add(imdb);
                    index.pending.push({ imdb, u: uploaded, f: nameFromRelease(t.name) });
                    stats.added++;
                } else {
                    const pending = index.pending.find((p) => p.imdb === imdb);
                    if (pending && uploaded > pending.u) pending.u = uploaded;
                }
            }
        } catch (e) {
            stats.errors.push(e.message);
            if (/429/.test(e.message)) break;
        }
    }

    const batch = index.pending.splice(0, LOOKUPS_PER_RUN);
    for (const item of batch) {
        try {
            const meta = await lookupImdb(env, item.imdb, item.f);
            if (meta) {
                index.titles[item.imdb] = Object.assign(meta, { u: item.u });
                stats.enriched++;
            } else {
                index.notFound.push(item.imdb);
            }
        } catch (e) {
            index.pending.push(item); // reîncercăm la runda următoare
            stats.errors.push(e.message);
        }
    }

    index.updatedAt = now.toISOString();
    await env.CACHE.put(INDEX_KEY, JSON.stringify(index));
    return Object.assign(stats, {
        cursor: index.cursor,
        totalQueries: queries.length,
        rounds: index.rounds,
        titles: Object.keys(index.titles).length,
        pending: index.pending.length,
    });
}

export function isKids(genres) {
    return (genres || []).some((g) => KIDS_GENRES.indexOf(g) !== -1);
}

function preview(imdbId, type, name, posterPath, year) {
    const meta = { id: imdbId, type, name, posterShape: 'poster' };
    if (posterPath) meta.poster = POSTER + posterPath;
    if (year) meta.releaseInfo = String(year);
    return meta;
}

// Titlurile dublate din index, de copii, cele mai recent urcate pe FileList primele.
async function dubbedCatalog(env, type, skip) {
    const index = await readIndex(env);
    return Object.keys(index.titles)
        .map((imdb) => Object.assign({ imdb }, index.titles[imdb]))
        .filter((x) => x.t === type && isKids(x.g))
        .sort((a, b) => (b.u || '').localeCompare(a.u || ''))
        .slice(skip, skip + PAGE_SIZE)
        .map((x) => preview(x.imdb, type, x.n, x.p, x.y));
}

// Nume românesc din traduceri; altfel englezesc (evită titluri în japoneză/coreeană etc.).
function displayName(details, isMovie) {
    const list = (details.translations && details.translations.translations) || [];
    const ro = list.find((t) => t.iso_639_1 === 'ro' && t.data && (isMovie ? t.data.title : t.data.name));
    return (ro && (isMovie ? ro.data.title : ro.data.name)) || (isMovie ? details.title : details.name);
}

/**
 * Filme: Animation sau Family, rating US cel mult PG (exclude animația pentru adulți).
 * Seriale: genul Kids, fără știri/reality/telenovele/talk-show (Family la TV aduce și sitcom-uri
 * și telenovele; Animation include seriale pentru adulți).
 * TMDB dă 20 pe pagină și id-uri TMDB; pentru fiecare titlu un singur request aduce IMDb-ul
 * (necesar pentru Cinemeta), numele englezesc și traducerea românească.
 */
async function discoverCatalog(env, type, skip) {
    const page = Math.floor(skip / 20) + 1;
    const cacheKey = `kids:discover:${type}:${page}`;
    const cached = env.CACHE ? await env.CACHE.get(cacheKey) : null;
    if (cached) return JSON.parse(cached);

    const isMovie = type === 'movie';
    const params = isMovie
        ? { with_genres: '16|10751', certification_country: 'US', 'certification.lte': 'PG', include_adult: 'false', sort_by: 'popularity.desc', 'vote_count.gte': '50', page: String(page) }
        : { with_genres: '10762', without_genres: '10763,10764,10766,10767', include_adult: 'false', sort_by: 'popularity.desc', 'vote_count.gte': '20', page: String(page) };
    const data = await tmdbJson(env, `/discover/${isMovie ? 'movie' : 'tv'}`, params);
    const results = data.results || [];

    const metas = (await Promise.all(results.map(async (r) => {
        try {
            const details = await tmdbJson(env, `/${isMovie ? 'movie' : 'tv'}/${r.id}`, {
                language: 'en-US',
                append_to_response: 'external_ids,translations',
            });
            const imdbId = (details.external_ids && details.external_ids.imdb_id) || details.imdb_id;
            if (!/^tt\d+$/.test(imdbId || '')) return null;
            return preview(imdbId, type, displayName(details, isMovie), r.poster_path, yearOf(isMovie ? r.release_date : r.first_air_date));
        } catch (e) {
            return null;
        }
    }))).filter(Boolean);

    if (env.CACHE) {
        try {
            await env.CACHE.put(cacheKey, JSON.stringify(metas), { expirationTtl: DISCOVER_TTL_SECONDS });
        } catch (e) {
            // cache opțional
        }
    }
    return metas;
}

export async function catalogFor(env, type, id, skip = 0) {
    const catalog = CATALOGS.find((c) => c.type === type && c.id === id);
    if (!catalog) return null;
    if (id.startsWith('rodub-dub-')) return dubbedCatalog(env, type, skip);
    return discoverCatalog(env, type, skip);
}

// „skip=40" sau „skip=40&genre=x" din segmentul de extra al căii Stremio.
export function parseExtra(segment) {
    const params = new URLSearchParams(decodeURIComponent(segment || ''));
    const skip = Number(params.get('skip'));
    return { skip: Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0 };
}
