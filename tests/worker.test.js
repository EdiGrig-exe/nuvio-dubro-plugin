/**
 * Teste offline pentru worker-ul FileList: fetch-ul global e simulat, KV-ul e un Map.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../worker/src/index.js';
import { infoHash, infoSlice } from '../worker/src/bencode.js';
import { isRomanianDub } from '../src/rodub/filters.js';

const TOKEN = 'token-de-test';
const enc = (s) => Buffer.from(s, 'latin1');

// .torrent minimal, cu bytes binari în „pieces" (ca să verificăm că nu se strică nimic).
function fakeTorrent(name) {
    const pieces = Buffer.from(Array.from({ length: 20 }, (_, i) => (i * 37 + 200) & 0xff));
    const info = Buffer.concat([
        enc(`d6:lengthi1024e4:name${name.length}:${name}12:piece lengthi16384e6:pieces20:`),
        pieces,
        enc('e'),
    ]);
    const file = Buffer.concat([enc('d8:announce17:http://t.test/ann4:info'), info, enc('7:comment2:hie')]);
    return { file, expectedHash: createHash('sha1').update(info).digest('hex') };
}

class MemoryKV {
    constructor() { this.map = new Map(); this.puts = 0; }
    async get(key) { return this.map.has(key) ? this.map.get(key) : null; }
    async put(key, value) { this.puts++; this.map.set(key, value); }
}

const TORRENTS = {
    101: fakeTorrent('Toy.Story.1995.1080p.BluRay.DD+7.1.x264-playHD'),
    102: fakeTorrent('Toy.Story.1995.BDRip.DD5.1.x264-playSD'),
};

let calls;
let fileListResponse;
const originalFetch = globalThis.fetch;

beforeEach(() => {
    calls = [];
    fileListResponse = () => new Response(JSON.stringify([
        { id: 102, name: 'Toy.Story.1995.BDRip.DD5.1.x264-playSD', size: 1.5 * 1024 ** 3, seeders: 32, download_link: 'https://filelist.io/download.php?id=102&passkey=secret' },
        { id: 101, name: 'Toy.Story.1995.1080p.BluRay.DD+7.1.x264-playHD', size: 9.1 * 1024 ** 3, seeders: 97, download_link: 'https://filelist.io/download.php?id=101&passkey=secret' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        if (url.pathname === '/api.php') return fileListResponse(url, init);
        if (url.pathname === '/download.php') return new Response(TORRENTS[url.searchParams.get('id')].file);
        return new Response('not mocked', { status: 404 });
    };
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

const env = (extra) => Object.assign({ ACCESS_TOKEN: TOKEN, FILELIST_USERNAME: 'user', FILELIST_PASSKEY: 'secret', CACHE: new MemoryKV() }, extra);
const get = (path, e) => worker.fetch(new Request(`https://w.test${path}`), e);

test('infoHash: SHA-1 al dicționarului „info", corect și pe bytes binari', async () => {
    const { file, expectedHash } = fakeTorrent('Frozen.2013.1080p.mkv');
    assert.equal(await infoHash(file), expectedHash);
    assert.throws(() => infoSlice(enc('nu e torrent')), /nu e un .torrent valid/);
    assert.throws(() => infoSlice(enc('d8:announce3:urle')), /nu are dicționar/);
});

test('fără token corect → 404, fără să atingă FileList', async () => {
    for (const path of ['/', '/gresit/manifest.json', '/gresit/stream/movie/tt0114709.json', `/${TOKEN}`]) {
        assert.equal((await get(path, env())).status, 404, path);
    }
    assert.equal((await get(`/${TOKEN}/manifest.json`, env({ ACCESS_TOKEN: '' }))).status, 404);
    assert.equal(calls.length, 0);
});

test('manifest Stremio', async () => {
    const res = await get(`/${TOKEN}/manifest.json`, env());
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.resources, ['stream']);
    assert.deepEqual(body.types, ['movie', 'series']);
});

test('film: caută în RO Dubbed după IMDb, sortează după seederi, returnează infoHash', async () => {
    const e = env();
    const res = await get(`/${TOKEN}/stream/movie/tt0114709.json`, e);
    const { streams } = await res.json();

    const search = calls.find((c) => c.url.pathname === '/api.php');
    assert.equal(search.url.searchParams.get('action'), 'search-torrents');
    assert.equal(search.url.searchParams.get('type'), 'imdb');
    assert.equal(search.url.searchParams.get('query'), 'tt0114709');
    assert.equal(search.url.searchParams.get('category'), '28');
    assert.equal(search.init.headers.Authorization, 'Basic ' + btoa('user:secret'));

    assert.equal(streams.length, 2);
    assert.equal(streams[0].infoHash, TORRENTS[101].expectedHash);
    assert.equal(streams[1].infoHash, TORRENTS[102].expectedHash);
    assert.match(streams[0].title, /^Toy\.Story\.1995\.1080p\.BluRay\.DD\+7\.1\.x264-playHD \[RO Dubbed\]\n👤 97 💾 9\.10 GB ⚙️ FileList$/);
});

test('marcajul [RO Dubbed] trece filtrul de dublaj din RoDub', async () => {
    const { streams } = await (await get(`/${TOKEN}/stream/movie/tt0114709.json`, env())).json();
    for (const s of streams) {
        const name = s.title.split('\n')[0];
        assert.equal(isRomanianDub(name), true, name);
        assert.equal(isRomanianDub(name.replace(' [RO Dubbed]', '')), false, 'fără marcaj nu ar trece');
    }
});

test('serial: filtrează doar pe sezon (FileList exclude pachetele dacă primește episodul)', async () => {
    await get(`/${TOKEN}/stream/series/tt3121722:1:3.json`, env());
    await get(`/${TOKEN}/stream/series/tt3121722%3A2%3A5.json`, env());
    const searches = calls.filter((c) => c.url.pathname === '/api.php').map((c) => c.url.searchParams);
    assert.deepEqual(searches.map((p) => p.get('season')), ['1', '2']);
    assert.ok(searches.every((p) => !p.has('episode')));
    const res = await get(`/${TOKEN}/stream/series/tt3121722.json`, env());
    assert.deepEqual(await res.json(), { streams: [] });
});

test('cache KV: a doua cerere nu mai contactează FileList', async () => {
    const e = env();
    await get(`/${TOKEN}/stream/movie/tt0114709.json`, e);
    const first = calls.length;
    assert.equal(first, 3); // 1 căutare + 2 descărcări .torrent
    const { streams } = await (await get(`/${TOKEN}/stream/movie/tt0114709.json`, e)).json();
    assert.equal(calls.length, first);
    assert.equal(streams.length, 2);
    assert.equal(e.CACHE.map.get('hash:101'), TORRENTS[101].expectedHash);
});

test('erori FileList → 502 cu mesaj clar, fără excepții', async () => {
    fileListResponse = () => new Response(JSON.stringify({ error: 'Invalid passkey/username!' }), { status: 403 });
    let res = await get(`/${TOKEN}/stream/movie/tt0114709.json`, env());
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /Invalid passkey\/username/);

    fileListResponse = () => new Response('slow down', { status: 429 });
    res = await get(`/${TOKEN}/stream/movie/tt0114709.json`, env());
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /429/);

    const noCreds = await get(`/${TOKEN}/stream/movie/tt0114709.json`, env({ FILELIST_PASSKEY: '' }));
    assert.equal(noCreds.status, 500);
});

test('un .torrent stricat e sărit, restul rămân', async () => {
    TORRENTS[999] = { file: enc('stricat') };
    fileListResponse = () => new Response(JSON.stringify([
        { id: 999, name: 'Broken', size: 1, seeders: 500, download_link: 'https://filelist.io/download.php?id=999' },
        { id: 101, name: 'Toy.Story.1995.1080p', size: 1, seeders: 1, download_link: 'https://filelist.io/download.php?id=101' },
    ]));
    const originalError = console.error;
    console.error = () => {};
    try {
        const { streams } = await (await get(`/${TOKEN}/stream/movie/tt0114709.json`, env())).json();
        assert.deepEqual(streams.map((s) => s.infoHash), [TORRENTS[101].expectedHash]);
    } finally {
        console.error = originalError;
        delete TORRENTS[999];
    }
});

test('funcționează și fără KV', async () => {
    const { streams } = await (await get(`/${TOKEN}/stream/movie/tt0114709.json`, env({ CACHE: undefined }))).json();
    assert.equal(streams.length, 2);
});
