/**
 * Test cap-coadă al bundle-ului, fără rețea: TMDB, sursa și TorBox sunt simulate.
 * Bundle-ul e construit în memorie (fără nicio cheie, ca în CI) și rulat în sandbox-ul fără
 * timere (tools/harness.js), deci verifică și compatibilitatea cu runtime-ul Nuvio. Cheile
 * false sunt date la rulare ca SCRAPER_SETTINGS, exact ca din setările aplicației.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundle } from '../build.js';
import { loadProvider } from '../tools/harness.js';
import { createDeadline, createHttp, redact, TimeoutError } from '../src/rodub/http.js';
import { searchAll, normalizeHash } from '../src/rodub/sources/index.js';

const SETTINGS = { torboxApiKey: 'tb-test', tmdbApiKey: 'tmdb-test', sourceUrl: 'https://source.test/cfg/' };
const code = await bundle();

const H = (c) => c.repeat(40);
const GB = 1024 ** 3;
const quiet = { log() {}, error() {}, warn() {}, info() {}, debug() {} };

// Aplicația serializează rezultatul cu JSON.stringify; facem la fel, ceea ce scoate și
// obiectele din realm-ul sandbox-ului (altfel deepStrictEqual compară prototipuri diferite).
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(options) {
    const provider = loadProvider(code, Object.assign({ sandbox: true, logger: quiet, settings: SETTINGS }, options));
    return {
        getStreams: async (...args) => plain(await provider.getStreams(...args)),
        onSettings: async () => plain(await provider.onSettings()),
    };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stremio(name, hash, sizeGb, seeders) {
    return { name: 'Src\n1080p', title: `${name}\n👤 ${seeders} 💾 ${sizeGb} GB ⚙️ Tracker`, infoHash: hash };
}

// Server fals: rutele primesc (url, init) și returnează un Response.
function fakeServer(routes) {
    const calls = [];
    const fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        for (const [pattern, handler] of routes) {
            if (pattern.test(url.href)) return handler(url, init);
        }
        return json({ error: 'not mocked' }, 404);
    };
    return { fetch, calls };
}

const FROZEN_TMDB = {
    title: 'Frozen',
    original_title: 'Frozen',
    release_date: '2013-11-20',
    genres: [{ id: 16, name: 'Animation' }, { id: 10751, name: 'Family' }],
    external_ids: { imdb_id: 'tt2294629' },
    translations: { translations: [{ iso_639_1: 'ro', iso_3166_1: 'RO', data: { title: 'Regatul de gheață' } }] },
};

test('film animat: filtrează, verifică cache-ul, adaugă în TorBox și sortează', async () => {
    const created = [];
    const server = fakeServer([
        [/api\.themoviedb\.org\/3\/movie\/109445\?/, () => json(FROZEN_TMDB)],
        [/source\.test\/cfg\/stream\/movie\/tt2294629\.json$/, () => json({
            streams: [
                stremio('Frozen.2013.1080p.BluRay.x264.Dublat.RO', H('a'), 8.5, 50),
                stremio('Frozen.2013.2160p.UHD.BluRay.x265-ENG', H('b'), 40, 900),
                stremio('Frozen.2013.2160p.UHD.RoDub.HDR', H('c'), 30, 10),
                stremio('Frozen.2013.720p.Dublat.RO', H('d'), 2, 5),
                stremio('Frozen.2013.1080p.WEB-DL.RO.Audio', H('e'), 10, 3),
            ],
        })],
        [/torrents\/checkcached/, (url) => {
            const hashes = url.searchParams.get('hash').split(',');
            assert.deepEqual(hashes.sort(), [H('a'), H('c'), H('d'), H('e')]);
            assert.equal(url.searchParams.get('format'), 'object');
            assert.equal(url.searchParams.get('list_files'), 'true');
            const entry = (hash, name, size) => ({
                name, size, hash,
                files: [
                    { id: 0, name: `${name}/sample.mkv`, short_name: 'sample.mkv', size: size * 2 },
                    { id: 1, name: `${name}/${name}.mkv`, short_name: `${name}.mkv`, size },
                ],
            });
            return json({
                success: true,
                data: {
                    [H('a')]: entry(H('a'), 'Frozen.2013.1080p.BluRay.x264.Dublat.RO', 8 * GB),
                    [H('c')]: entry(H('c'), 'Frozen.2013.2160p.UHD.RoDub.HDR', 30 * GB),
                    [H('e').toUpperCase()]: entry(H('e'), 'Frozen.2013.1080p.WEB-DL.RO.Audio', 10 * GB),
                },
            });
        }],
        [/torrents\/createtorrent$/, (url, init) => {
            assert.equal(init.method, 'POST');
            assert.equal(init.headers.Authorization, 'Bearer tb-test');
            const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
            assert.ok(init.body.startsWith(`--${boundary}\r\n`));
            assert.ok(init.body.endsWith(`--${boundary}--\r\n`));
            assert.match(init.body, /name="add_only_if_cached"\r\n\r\ntrue\r\n/);
            const magnet = /name="magnet"\r\n\r\n(.+)\r\n/.exec(init.body)[1];
            const hash = /btih:([0-9a-f]{40})/.exec(magnet)[1];
            created.push(hash);
            // E există deja în cont: createtorrent eșuează, iar id-ul vine din mylist.
            if (hash === H('e')) return json({ success: false, error: 'ACTIVE_LIMIT', detail: 'limit', data: null });
            return json({ success: true, data: { torrent_id: hash === H('a') ? 101 : 303, hash } });
        }],
        [/torrents\/mylist\?id=/, (url) => {
            const id = url.searchParams.get('id');
            const names = { 101: 'Frozen.2013.1080p.BluRay.x264.Dublat.RO', 303: 'Frozen.2013.2160p.UHD.RoDub.HDR', 202: 'Frozen.2013.1080p.WEB-DL.RO.Audio' };
            const name = names[id];
            // Id-urile din cont diferă intenționat de cele din checkcached.
            return json({ success: true, data: { id: Number(id), files: [
                { id: 7, name: `${name}/sample.mkv`, short_name: 'sample.mkv' },
                { id: 9, name: `${name}/${name}.mkv`, short_name: `${name}.mkv` },
            ] } });
        }],
        [/torrents\/mylist\?bypass_cache=true$/, () => json({ success: true, data: [{ id: 202, hash: H('e') }] })],
    ]);

    const provider = load({ fetch: server.fetch });
    const streams = await provider.getStreams('109445', 'movie');

    assert.equal(streams.length, 3);
    assert.deepEqual(streams.map((s) => s.quality), ['2160p', '1080p', '1080p']);
    assert.deepEqual(streams.map((s) => s.infoHash), [H('c'), H('e'), H('a')]);
    assert.deepEqual(created, [H('c'), H('e'), H('a')]);

    const [first] = streams;
    assert.equal(first.name, 'RoDub ⚡ 2160p');
    assert.equal(first.language, 'ro');
    assert.equal(first.size, '30.00 GB');
    assert.equal(first.seeders, 10);
    assert.match(first.title, /^2160p · 30\.00 GB · 🇷🇴 Dublat · 🎨 Desene\nFrozen\.2013\.2160p\.UHD\.RoDub\.HDR\n⚡ TorBox$/);
    assert.equal(first.url,
        'https://api.torbox.app/v1/api/torrents/requestdl?token=tb-test&torrent_id=303&file_id=9&redirect=true');
    assert.match(streams[1].url, /torrent_id=202&file_id=9&/);

    const tmdbCall = server.calls.find((c) => c.url.hostname === 'api.themoviedb.org');
    assert.equal(tmdbCall.url.searchParams.get('append_to_response'), 'external_ids,translations');
    assert.ok(!server.calls.some((c) => c.init.signal), 'fără signal în sandbox');
});

test('serial: acceptă pachetul de sezon și alege fișierul S01E03', async () => {
    const server = fakeServer([
        [/api\.themoviedb\.org\/3\/tv\/82728\?/, () => json({
            name: 'Bluey', original_name: 'Bluey', first_air_date: '2018-10-01',
            genres: [{ id: 16 }], external_ids: { imdb_id: 'tt7678620' },
            translations: { translations: [] },
        })],
        [/source\.test\/cfg\/stream\/series\/tt7678620:1:3\.json$/, () => json({
            streams: [
                stremio('Bluey.S01.1080p.WEB-DL.Dublat.RO', H('1'), 12, 20),
                stremio('Bluey.S01E05.1080p.Dublat.RO', H('2'), 1, 20),
                stremio('Bluey.S02.1080p.Dublat.RO', H('3'), 12, 20),
            ],
        })],
        [/torrents\/checkcached/, (url) => {
            assert.equal(url.searchParams.get('hash'), H('1'));
            return json({ success: true, data: { [H('1')]: { name: 'Bluey.S01', size: 12 * GB, files: [
                { id: 0, name: 'Bluey.S01/Bluey.S01E01.mkv', short_name: 'Bluey.S01E01.mkv', size: 3e8 },
                { id: 2, name: 'Bluey.S01/Bluey.S01E03.mkv', short_name: 'Bluey.S01E03.mkv', size: 3e8 },
            ] } } });
        }],
        [/torrents\/createtorrent$/, () => json({ success: true, data: { torrent_id: 55 } })],
        [/torrents\/mylist\?id=55/, () => json({ success: true, data: { id: 55, files: [
            { id: 4, name: 'Bluey.S01/Bluey.S01E01.mkv', short_name: 'Bluey.S01E01.mkv' },
            { id: 6, name: 'Bluey.S01/Bluey.S01E03.mkv', short_name: 'Bluey.S01E03.mkv' },
        ] } })],
    ]);

    const provider = load({ fetch: server.fetch });
    const streams = await provider.getStreams('82728', 'tv', 1, 3);

    assert.equal(streams.length, 1);
    assert.match(streams[0].url, /torrent_id=55&file_id=6&/);
    assert.match(streams[0].title, /📄 Bluey\.S01E03\.mkv/);
    assert.match(streams[0].title, /🎨 Desene/);
});

test('nimic dublat → [] fără apeluri TorBox; erori → [] fără excepții', async () => {
    const server = fakeServer([
        [/themoviedb/, () => json(FROZEN_TMDB)],
        [/source\.test/, () => json({ streams: [stremio('Frozen.2013.1080p.BluRay.x264-ENG', H('f'), 8, 1)] })],
    ]);
    const provider = load({ fetch: server.fetch });
    assert.deepEqual(await provider.getStreams('109445', 'movie'), []);
    assert.ok(!server.calls.some((c) => c.url.hostname === 'api.torbox.app'));

    const broken = load({
        fetch: async () => { throw new Error('rețea căzută'); },
    });
    assert.deepEqual(await broken.getStreams('109445', 'movie'), []);
    assert.deepEqual(await broken.getStreams('82728', 'tv'), []);
});

function recorder() {
    const lines = [];
    const push = (...args) => lines.push(args.join(' '));
    return { lines, logger: { log: push, error: push, warn: push, info: push, debug: push } };
}

test('fără chei în setări → [] fără niciun request; setările includ URL-ul sursei', async () => {
    const server = fakeServer([]);
    const provider = load({ fetch: server.fetch, settings: {} });
    assert.deepEqual(await provider.getStreams('109445', 'movie'), []);
    assert.equal(server.calls.length, 0);

    const layout = await provider.onSettings();
    const fields = layout.filter((f) => f.type === 'text');
    assert.deepEqual(fields.map((f) => f.key), ['torboxApiKey', 'tmdbApiKey', 'sourceUrl']);
    assert.ok(fields.every((f) => f.isPassword === true));
});

test('bundle-ul nu conține cheile primite la rulare', () => {
    for (const value of Object.values(SETTINGS)) assert.ok(!code.includes(value), value);
});

test('addon configurat cu debrid (fără infoHash) → cauza e logată clar', async () => {
    const { lines, logger } = recorder();
    const server = fakeServer([
        [/themoviedb/, () => json(FROZEN_TMDB)],
        [/source\.test/, () => json({ streams: [
            { name: '[RD+] Torrentio', title: 'Frozen.2013.1080p.Dublat.RO', url: 'https://debrid.test/dl/abc' },
            { name: '[RD+] Torrentio', title: 'Frozen.2013.720p', url: 'https://debrid.test/dl/def' },
        ] })],
    ]);
    const provider = load({ fetch: server.fetch, logger });
    assert.deepEqual(await provider.getStreams('109445', 'movie'), []);
    const line = lines.find((l) => l.includes('sursa „example" a eșuat'));
    assert.ok(line, lines.join('\n'));
    assert.match(line, /^\[RoDub\] /);
    assert.match(line, /2 sunt link-uri HTTP gata rezolvate/);
    assert.match(line, /FĂRĂ debrid/);
});

test('răspuns fără lista streams → eroare explicită; URL-ul sursei nu apare în loguri', async () => {
    const { lines, logger } = recorder();
    const secretUrl = 'https://addon.test/realdebrid=SECRETVALUE123/';
    const server = fakeServer([
        [/themoviedb/, () => json(FROZEN_TMDB)],
        [/addon\.test/, () => json({ error: 'bad config' })],
    ]);
    const provider = load({ fetch: server.fetch, logger, settings: Object.assign({}, SETTINGS, { sourceUrl: secretUrl }) });
    assert.deepEqual(await provider.getStreams('109445', 'movie'), []);
    assert.ok(lines.some((l) => /lipsește lista `streams`/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('SECRETVALUE123')));
});

test('redact: ascunde cheile din query și calea addon-urilor', () => {
    assert.equal(redact('https://addon.test/realdebrid=abc/stream/movie/tt1.json'), 'https://addon.test/…');
    assert.equal(redact('https://api.themoviedb.org/3/movie/1?api_key=abc&language=en'),
        'https://api.themoviedb.org/3/movie/1?api_key=***&language=en');
    assert.equal(redact('https://api.torbox.app/v1/api/torrents/requestdl?token=abc&torrent_id=1'),
        'https://api.torbox.app/v1/api/torrents/requestdl?token=***&torrent_id=1');
});

test('o sursă căzută nu le strică pe celelalte (Promise.allSettled)', async () => {
    const ok = { name: 'ok', search: async () => [{ name: 'A.Dublat', infoHash: H('a'), seeders: 1 }] };
    const okDuplicate = { name: 'dup', search: async () => [{ name: 'A.Dublat', infoHash: H('A'), seeders: 9 }] };
    const failing = { name: 'cade', search: async () => { throw new Error('boom'); } };
    const throwsSync = { name: 'sync', search() { throw new Error('sync boom'); } };
    const originalError = console.error;
    console.error = () => {};
    try {
        const results = await searchAll({}, {}, [failing, ok, throwsSync, okDuplicate]);
        assert.equal(results.length, 1);
        assert.equal(results[0].seeders, 9);
        assert.match(results[0].magnet, /^magnet:\?xt=urn:btih:a{40}&dn=/);
    } finally {
        console.error = originalError;
    }
});

test('normalizeHash: hex și base32', () => {
    assert.equal(normalizeHash('ABCDEF0123456789ABCDEF0123456789ABCDEF01'), 'abcdef0123456789abcdef0123456789abcdef01');
    assert.equal(normalizeHash('VPG66AJDIVTYTK6N54ASGRLHRGV433YB'), 'abcdef0123456789abcdef0123456789abcdef01');
    assert.equal(normalizeHash('nu-e-hash'), null);
});

test('bugetul de timp oprește request-urile blocate (unde există timere)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    try {
        const http = createHttp(createDeadline(50));
        const started = Date.now();
        await assert.rejects(http.json('https://slow.test/'), TimeoutError);
        assert.ok(Date.now() - started < 1000);
        await assert.rejects(http.json('https://slow.test/'), /buget de timp epuizat/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
