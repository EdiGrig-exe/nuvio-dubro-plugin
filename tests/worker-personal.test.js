/**
 * Varianta personală a plugin-ului, servită de worker: manifest rescris, bundle-ul public cu
 * RODUB_DEFAULTS în față, rulat în sandbox fără setări (ca pe Nuvio TV).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { PUBLIC_BASE } from '../worker/src/personal.js';
import { bundle, buildManifest } from '../build.js';
import { loadProvider } from '../tools/harness.js';

const TOKEN = 'token-de-test';
const ORIGIN = 'https://w.test';
const publicCode = await bundle();
const publicManifest = buildManifest();
const quiet = { log() {}, error() {}, warn() {}, info() {}, debug() {} };

const originalFetch = globalThis.fetch;
beforeEach(() => {
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url === `${PUBLIC_BASE}/manifest.json`) return Response.json(publicManifest);
        if (url === `${PUBLIC_BASE}/rodub.js`) return new Response(publicCode);
        return new Response('not mocked', { status: 404 });
    };
});
afterEach(() => {
    globalThis.fetch = originalFetch;
});

const env = (extra) => Object.assign({
    ACCESS_TOKEN: TOKEN, FILELIST_USERNAME: 'user', FILELIST_PASSKEY: 'secret',
    TMDB_API_KEY: 'tmdb-din-worker', TORBOX_API_KEY: 'torbox-din-worker',
}, extra);
const req = (path, method = 'GET') => worker.fetch(new Request(`${ORIGIN}${path}`, { method }), env());

test('manifest personal: indică rodub.js din worker, cu id și nume distincte', async () => {
    const res = await req(`/${TOKEN}/plugin/manifest.json`);
    const m = await res.json();
    assert.equal(res.status, 200);
    assert.equal(m.name, 'RoDub (personal)');
    assert.equal(m.scrapers.length, 1);
    assert.equal(m.scrapers[0].id, 'rodub-personal');
    assert.equal(m.scrapers[0].filename, `${ORIGIN}/${TOKEN}/plugin/rodub.js`);
    assert.equal(m.scrapers[0].version, publicManifest.scrapers[0].version);
});

test('bundle personal: bundle-ul public cu RODUB_DEFAULTS în față', async () => {
    const res = await req(`/${TOKEN}/plugin/rodub.js`);
    const code = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const firstLine = code.split('\n')[0];
    assert.equal(firstLine, `globalThis.RODUB_DEFAULTS = ${JSON.stringify({
        sourceUrl: `${ORIGIN}/${TOKEN}`, torboxApiKey: 'torbox-din-worker', tmdbApiKey: 'tmdb-din-worker',
    })};`);
    assert.ok(code.endsWith(publicCode));
});

test('fără token → 404; HEAD răspunde fără corp (Nuvio TV verifică mărimea)', async () => {
    assert.equal((await req('/gresit/plugin/rodub.js')).status, 404);
    assert.equal((await req(`/${TOKEN}/plugin/altceva.js`)).status, 404);
    const head = await req(`/${TOKEN}/plugin/rodub.js`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});

// Rulează bundle-ul personal în sandbox și întoarce cererile TMDB / sursă făcute de el.
async function runPersonal(settings) {
    const code = await (await req(`/${TOKEN}/plugin/rodub.js`)).text();
    const seen = [];
    const fakeFetch = async (input) => {
        const url = new URL(String(input));
        seen.push(url);
        if (url.hostname === 'api.themoviedb.org') {
            return Response.json({ title: 'Frozen', release_date: '2013-11-20', genres: [], external_ids: { imdb_id: 'tt2294629' } });
        }
        return Response.json({ streams: [] });
    };
    const provider = loadProvider(code, { sandbox: true, fetch: fakeFetch, settings, logger: quiet });
    const streams = await provider.getStreams('109445', 'movie');
    return { streams: JSON.parse(JSON.stringify(streams)), seen };
}

test('pe TV (fără setări) plugin-ul folosește valorile implicite: TMDB și sursa din worker', async () => {
    const { streams, seen } = await runPersonal({});
    assert.deepEqual(streams, []);
    const tmdb = seen.find((u) => u.hostname === 'api.themoviedb.org');
    assert.equal(tmdb.searchParams.get('api_key'), 'tmdb-din-worker');
    const source = seen.find((u) => u.hostname === 'w.test');
    assert.equal(source.pathname, `/${TOKEN}/stream/movie/tt2294629.json`);
});

test('setările din aplicație au prioritate față de valorile implicite', async () => {
    const { seen } = await runPersonal({ tmdbApiKey: 'tmdb-din-aplicatie', sourceUrl: 'https://alta-sursa.test' });
    assert.equal(seen.find((u) => u.hostname === 'api.themoviedb.org').searchParams.get('api_key'), 'tmdb-din-aplicatie');
    assert.ok(seen.some((u) => u.hostname === 'alta-sursa.test'));
});

test('bundle-ul public singur, fără setări, nu face nicio cerere', async () => {
    const provider = loadProvider(publicCode, { sandbox: true, fetch: async () => { throw new Error('nu trebuia'); }, settings: {}, logger: quiet });
    assert.deepEqual(JSON.parse(JSON.stringify(await provider.getStreams('109445', 'movie'))), []);
});
