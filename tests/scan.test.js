import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundle, buildManifest } from '../build.js';
import { scanText } from '../tools/scan-secrets.js';

// Cheile false sunt construite la rulare, ca fișierul de test să nu conțină șiruri
// care seamănă cu chei (repo-ul e public).
const fakeTmdb = 'a1b2c3d4'.repeat(4);
const fakeTorbox = ['1a2b3c4d', '5e6f', '7a8b', '9c0d', '1e2f3a4b5c6d'].join('-');
const fakeLongValue = ['abcDEF123456', 'ghiJKL7890'].join('');

test('bundle-ul și manifestul generate trec scanarea de secrete', async () => {
    assert.deepEqual(scanText(await bundle()), []);
    assert.deepEqual(scanText(JSON.stringify(buildManifest(), null, 2)), []);
});

test('scanarea prinde formatele de chei TMDB/TorBox și valorile lungi lângă key/token', () => {
    const rules = (text) => scanText(text).map((f) => f.rule);
    assert.ok(rules(`const k = "${fakeTmdb}";`).some((r) => /TMDB/.test(r)));
    assert.ok(rules(`Authorization: Bearer ${fakeTorbox}`).some((r) => /TorBox/.test(r)));
    assert.ok(rules(`requestdl?token=${fakeTorbox}&torrent_id=1`).length > 0);
    assert.ok(rules(`apiKey: "${fakeLongValue}"`).length > 0);
    assert.ok(rules(['eyJhbGciOiJIUzI1NiJ9', 'eyJhdWQiOiIxMjM0NTY3ODkwIn0', 'abcdefGHIJ'].join('.')).length > 0);
});

test('scanarea nu dă alarme false pe info-hash-uri sau pe codul care folosește cheile', () => {
    assert.deepEqual(scanText(`magnet:?xt=urn:btih:${'ab'.repeat(20)}`), []);
    assert.deepEqual(scanText('const url = `requestdl?token=${encodeURIComponent(apiKey)}`;'), []);
    assert.deepEqual(scanText('torboxApiKey: readSetting("torboxApiKey"),'), []);
});
