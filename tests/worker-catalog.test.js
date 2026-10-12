/**
 * Teste offline pentru addon-ul de catalog „RoDub Copii" din worker (FileList + TMDB simulate).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { buildQueries, refreshIndex, readIndex, nameFromRelease, KIDS_MANIFEST } from '../worker/src/catalog.js';

const TOKEN = 'token-de-test';

class MemoryKV {
    constructor() { this.map = new Map(); }
    async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
    async put(key, value) { this.map.set(key, value); }
}

// Titluri TMDB simulate, după IMDb.
const FIND = {
    tt1: { movie: { title: 'Regatul de gheață', release_date: '2013-11-20', poster_path: '/frozen.jpg', genre_ids: [16, 10751] } },
    tt2: { movie: { title: 'Un film de groază', release_date: '2020-01-01', poster_path: '/horror.jpg', genre_ids: [27] } },
    tt3: { tv: { name: 'Patrula cățelușilor', first_air_date: '2013-08-12', poster_path: '/paw.jpg', genre_ids: [16, 10762] } },
    tt4: { tv: { name: 'ドラえもん', first_air_date: '2005-04-15', poster_path: '/dora.jpg', genre_ids: [16, 10762] } },
};

let calls;
let fileListTorrents;
const originalFetch = globalThis.fetch;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
    calls = [];
    fileListTorrents = [
        { name: 'Frozen.2013.1080p.BluRay-playHD', imdb: 'tt1', upload_date: '2026-01-05 10:00:00' },
        { name: 'Frozen.2013.720p.BluRay-playHD', imdb: 'tt1', upload_date: '2026-03-01 10:00:00' },
        { name: 'Horror.2020.1080p-play', imdb: 'tt2', upload_date: '2026-05-01 10:00:00' },
        { name: 'PAW.Patrol.S01.1080p-playWEB', imdb: 'tt3', upload_date: '2026-02-01 10:00:00' },
        { name: 'Doraemon.S01.1080p-playWEB', imdb: 'tt4', upload_date: '2026-04-01 10:00:00' },
        { name: 'Fara.IMDb.2020', imdb: '', upload_date: '2026-04-01 10:00:00' },
    ];
    globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        calls.push(url);
        if (url.hostname === 'filelist.io') return json(fileListTorrents);
        const m = /^\/3\/find\/(tt\d+)$/.exec(url.pathname);
        if (m) {
            const hit = FIND[m[1]] || {};
            return json({ movie_results: hit.movie ? [hit.movie] : [], tv_results: hit.tv ? [hit.tv] : [] });
        }
        if (url.pathname === '/3/discover/movie' || url.pathname === '/3/discover/tv') {
            return json({ results: [
                { id: 10, title: 'Vaiana', name: 'Vaiana', poster_path: '/moana.jpg', release_date: '2016-11-23', first_air_date: '2016-11-23' },
                { id: 11, title: 'Fără IMDb', name: 'Fără IMDb', poster_path: '/x.jpg' },
                { id: 12, title: 'Bluey', name: 'Bluey', poster_path: '/bluey.jpg', first_air_date: '2018-10-01', release_date: '2018-10-01' },
            ] });
        }
        const d = /^\/3\/(movie|tv)\/(\d+)$/.exec(url.pathname);
        if (d) {
            const id = Number(d[2]);
            const ro = id === 10 ? [{ iso_639_1: 'ro', data: { title: 'Vaiana', name: 'Vaiana' } }] : [];
            return json({
                title: id === 12 ? 'Bluey' : 'Moana',
                name: id === 12 ? 'Bluey' : 'Moana',
                external_ids: { imdb_id: id === 11 ? null : `tt9${id}` },
                translations: { translations: ro },
            });
        }
        return json({ error: 'not mocked' }, 404);
    };
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

const env = (extra) => Object.assign({
    ACCESS_TOKEN: TOKEN, FILELIST_USERNAME: 'user', FILELIST_PASSKEY: 'secret', TMDB_API_KEY: 'tmdb', CACHE: new MemoryKV(),
}, extra);
const get = async (path, e) => {
    const res = await worker.fetch(new Request(`https://w.test${path}`), e);
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

test('manifest: doar resursa catalog, 4 cataloage cu paginare', async () => {
    const { status, body } = await get(`/${TOKEN}/kids/manifest.json`, env());
    assert.equal(status, 200);
    assert.deepEqual(body.resources, ['catalog']);
    assert.deepEqual(body.catalogs.map((c) => `${c.type}/${c.id}`), [
        'movie/rodub-dub-movies', 'series/rodub-dub-series', 'movie/rodub-kids-movies', 'series/rodub-kids-series',
    ]);
    assert.ok(body.catalogs.every((c) => c.extra.some((x) => x.name === 'skip')));
    assert.equal(KIDS_MANIFEST.id, 'ro.rodub.kids');
});

test('rutele de catalog cer token-ul; catalog necunoscut → 404', async () => {
    assert.equal((await get('/gresit/kids/manifest.json', env())).status, 404);
    assert.equal((await get(`/${TOKEN}/kids/catalog/movie/necunoscut.json`, env())).status, 404);
    assert.equal((await get(`/${TOKEN}/kids/catalog/movie/rodub-kids-movies.json`, env({ TMDB_API_KEY: '' }))).status, 500);
    assert.equal(calls.length, 0);
});

test('buildQueries: cele mai noi, ani, sezoane și calități', () => {
    const q = buildQueries(2026);
    assert.deepEqual(q[0], { action: 'latest-torrents' });
    assert.ok(q.some((x) => x.query === '1980'));
    assert.ok(q.some((x) => x.query === 'S12'));
    assert.ok(q.every((x) => x.action === 'latest-torrents' || x.type === 'name'));
});

test('refreshIndex: strânge titluri unice, le îmbogățește din TMDB și avansează cursorul', async () => {
    const e = env();
    const stats = await refreshIndex(e, new Date('2026-10-12T12:00:00Z'));
    assert.equal(stats.queries, 6);
    assert.equal(stats.titles, 4);
    assert.equal(stats.pending, 0);
    assert.equal(stats.cursor, 6);

    const fl = calls.filter((u) => u.hostname === 'filelist.io');
    assert.ok(fl.every((u) => u.searchParams.get('category') === '28'));
    assert.equal(fl[0].searchParams.get('action'), 'latest-torrents');
    assert.equal(calls.filter((u) => u.pathname.startsWith('/3/find/')).length, 4); // o singură dată per titlu

    const index = await readIndex(e);
    assert.equal(index.titles.tt1.u, '2026-03-01 10:00:00'); // cea mai recentă încărcare
    assert.equal(index.titles.tt4.n, 'Doraemon'); // fallback latin din numele release-ului

    calls = [];
    await refreshIndex(e);
    assert.equal(calls.filter((u) => u.pathname.startsWith('/3/find/')).length, 0); // deja cunoscute
});

test('catalog dublat: doar copii, sortat după ultima încărcare, cu paginare', async () => {
    const e = env();
    await refreshIndex(e);
    const movies = (await get(`/${TOKEN}/kids/catalog/movie/rodub-dub-movies.json`, e)).body.metas;
    assert.deepEqual(movies.map((m) => m.id), ['tt1']); // filmul de groază e exclus
    assert.deepEqual(movies[0], {
        id: 'tt1', type: 'movie', name: 'Regatul de gheață', posterShape: 'poster',
        poster: 'https://image.tmdb.org/t/p/w342/frozen.jpg', releaseInfo: '2013',
    });

    const series = (await get(`/${TOKEN}/kids/catalog/series/rodub-dub-series.json`, e)).body.metas;
    assert.deepEqual(series.map((m) => m.id), ['tt4', 'tt3']); // Doraemon urcat mai recent

    const page2 = (await get(`/${TOKEN}/kids/catalog/series/rodub-dub-series/skip=100.json`, e)).body.metas;
    assert.deepEqual(page2, []);
});

test('catalog TMDB: filtre de copii, nume român sau englez, fără titluri fără IMDb, cu cache', async () => {
    const e = env();
    const movies = (await get(`/${TOKEN}/kids/catalog/movie/rodub-kids-movies.json`, e)).body.metas;
    const discover = calls.find((u) => u.pathname === '/3/discover/movie');
    assert.equal(discover.searchParams.get('with_genres'), '16|10751');
    assert.equal(discover.searchParams.get('certification.lte'), 'PG');
    assert.equal(discover.searchParams.get('page'), '1');
    assert.deepEqual(movies.map((m) => `${m.id}:${m.name}`), ['tt910:Vaiana', 'tt912:Bluey']);

    calls = [];
    await get(`/${TOKEN}/kids/catalog/movie/rodub-kids-movies.json`, e);
    assert.equal(calls.length, 0, 'a doua cerere vine din cache');

    await get(`/${TOKEN}/kids/catalog/series/rodub-kids-series/skip=20.json`, e);
    const tv = calls.find((u) => u.pathname === '/3/discover/tv');
    assert.equal(tv.searchParams.get('with_genres'), '10762');
    assert.equal(tv.searchParams.get('without_genres'), '10763,10764,10766,10767');
    assert.equal(tv.searchParams.get('page'), '2');
});

test('cron: scheduled rulează o rundă de actualizare', async () => {
    const e = env();
    const waits = [];
    const originalLog = console.log;
    console.log = () => {};
    try {
        await worker.scheduled({}, e, { waitUntil: (p) => waits.push(p) });
        await Promise.all(waits);
    } finally {
        console.log = originalLog;
    }
    assert.equal(Object.keys((await readIndex(e)).titles).length, 4);
});

test('nameFromRelease', () => {
    assert.equal(nameFromRelease('Kipo.and.the.Age.of.Wonderbeasts.S03.1080p.NF.WEB-DL'), 'Kipo and the Age of Wonderbeasts');
    assert.equal(nameFromRelease('Frozen.2013.PROPER.720p.BluRay'), 'Frozen');
});
