# NOTES — formatul provider-elor Nuvio (Pasul 0)

Extras pe 2026-10-12 din sursele de mai jos. Unde repo-urile comunitare și codul aplicației
diferă, **codul aplicației câștigă**.

## Surse studiate

| Sursă | Stare | Ce am luat de acolo |
|---|---|---|
| `Om0019/Flax` | **nu mai există** → redenumit `Om0019/FLAX-Plugins` (ultim push 2026-08-07) | constrângerile sandbox-ului, testat pe device; `tools/run-in-sandbox.js` |
| `1Anime/nuvio-src` | **nu mai există** (nici utilizatorul `1Anime`) | — |
| `D3adlyRocket/All-in-One-Nuvio` | OK (2026-10-02) | manifest cu 60+ scrapers, `torrentio.js` (debrid + `SCRAPER_SETTINGS`) |
| `tapframe/nuvio-providers` | OK; înlocuitor pentru `1Anime/nuvio-src` | repo-ul oficial de provider-i: `build.js`, `src/_template`, `DOCUMENTATION.md` |
| `phisher98/phisher-nuvio-providers` | OK (2026-09-03) | același build.js, manifest în formă obiect |
| `tapframe/NuvioMobile` (aplicația) | OK (2026-07-20) | **sursa de adevăr**: `PluginModels.kt`, `PluginManifestParser.kt`, `PluginRuntime.kt`, `JsBindings.kt`, `FetchBridge.kt` |
| TorBox Postman collection (`api-docs.torbox.app`) | OK | parametri și răspunsuri exacte pentru endpoint-uri |

> ⚠️ **Runtime-ul s-a schimbat.** Aplicația Nuvio actuală (`NuvioMobile`) e Kotlin Multiplatform
> și rulează plugin-urile în **QuickJS** (`io.github.dokar3:quickjs-kt` 1.0.5), nu în Hermes.
> Ghidul oficial (`DOCUMENTATION.md`) încă vorbește despre Hermes/React Native (aplicația veche).
> Concluzie practică: un bundle ES2016 fără timere funcționează în **ambele** runtime-uri, deci
> ținta de build rămâne cea din repo-ul oficial.

---

## 1. `manifest.json`

### Formă de nivel superior (obligatoriu obiect, nu array)

`PluginManifestParser.parse()` cere `name` nevid, `version` nevid și `scrapers` nevid:

```json
{
  "name": "string (obligatoriu)",
  "version": "string (obligatoriu)",
  "description": "string (opțional)",
  "author": "string (opțional)",
  "scrapers": [ /* cel puțin unul */ ]
}
```

`tapframe/nuvio-providers/manifest.json` e un **array** gol de wrapper — vechi, aplicația actuală
îl respinge. Toate repo-urile active (FLAX, All-in-One, phisher) folosesc forma obiect.

### Intrare în `scrapers[]` (`PluginManifestScraper`)

| Câmp | Tip | Obligatoriu | Implicit / note |
|---|---|---|---|
| `id` | string | **da** | id stabil; aplicația îl combină cu URL-ul manifestului |
| `name` | string | **da** | afișat în UI |
| `version` | string | **da** | |
| `filename` | string | **da** | cale relativă la folderul manifestului (`providers/x.js`) sau URL absolut |
| `description` | string | nu | |
| `supportedTypes` | string[] | nu | `["movie","tv"]`; `series`/`show` sunt normalizate la `tv` |
| `enabled` | bool | nu | `true` |
| `hasSettings` | bool | nu | `false`; dacă `true`, aplicația apelează `onSettings()` |
| `logo` | string | nu | URL |
| `contentLanguage` | string[] | nu | coduri ISO, ex. `["ro"]` |
| `formats` | string[] | nu | ex. `["mkv","mp4"]` |
| `supportedFormats` | string[] | nu | rar folosit |
| `supportedPlatforms` / `disabledPlatforms` | string[] | nu | |
| `supportsExternalPlayer` | bool | nu | |
| `limited` | bool | nu | |

Câmpuri necunoscute sunt ignorate (`ignoreUnknownKeys = true`), dar nu adăugăm altele.
Codul se descarcă de la `<manifestUrl fără /manifest.json>/<filename>`.

---

## 2. `getStreams` — semnătură și export

```js
async function getStreams(tmdbId, mediaType, season, episode) { ... }
module.exports = { getStreams };
```

Cum îl apelează aplicația (`PluginRuntime.executePluginInternal`):

```js
var module = { exports: {} };
var exports = module.exports;
(function() { /* codul provider-ului */ })();
// apoi:
var getStreams = module.exports.getStreams || globalThis.getStreams;
var result = await getStreams("603", "movie", undefined, undefined);
__capture_result(JSON.stringify(result || []));
```

- `tmdbId`: **string** (aplicația convertește în prealabil IMDb → TMDB dacă e nevoie).
- `mediaType`: `"movie"` sau `"tv"` (deja normalizat).
- `season`, `episode`: numere 1-based pentru `tv`, `undefined` pentru filme.
- Aplicația impune un timeout dur de **60 s** pe tot apelul.
- O excepție aruncată → loghează și returnează `[]`; noi oricum prindem totul.
- Opțional: `module.exports.onSettings` (async) returnează un layout de setări; valorile salvate
  ajung în `globalThis.SCRAPER_SETTINGS` (folosit de `torrentio.js` pentru cheia debrid).

---

## 3. Obiectul stream returnat

Ce citește efectiv aplicația (`PluginRuntime.parseJsonResults` → `PluginRuntimeResult`):

| Câmp | Tip | Note |
|---|---|---|
| `url` | string | **obligatoriu**; stream-urile fără `url` sunt eliminate |
| `title` | string | afișat; fallback la `name` |
| `name` | string | identificator scurt (ex. `"RoDub 1080p"`) |
| `quality` | string | `"2160p"`, `"1080p"`, `"720p"`… |
| `size` | string | ex. `"4.2 GB"` |
| `language` | string | ex. `"ro"` |
| `provider` | string | |
| `type` | string | |
| `seeders` | int | |
| `peers` | int | |
| `infoHash` | string | |
| `headers` | `{[k]: string}` | opțional, pentru player |
| `subtitles` | `[{url, language, name?, headers?}]` | opțional |

Valorile string care conțin `[object` sau sunt goale sunt ignorate. `title` poate avea `\n`
(multi-linie, folosit de All-in-One/torrentio).

---

## 4. Constrângeri de runtime (verificate în `JsBindings.kt` + FLAX README)

**Disponibil:** `fetch` (polyfill), `console`, `Promise` (+ `all`, `allSettled`, `race`),
`AbortController`/`AbortSignal` (polyfill simplu), `URL`, `URLSearchParams`, `atob`/`btoa`,
`TextEncoder`/`TextDecoder`, `CryptoJS`, `cheerio` prin `require`, `Date`, `JSON`.

**Lipsește:** `setTimeout`, `setInterval`, `clearTimeout`, `FormData`, `Blob`, `Buffer`,
orice modul Node (`fs`, `crypto`, `http`). `require()` cunoaște doar `cheerio*` și `crypto-js`.

### Detalii despre `fetch` care contează pentru noi

```js
var fetch = async function(url, options) {
  var body = options.body || '';                 // body = STRING
  var followRedirects = options.redirect !== 'manual';
  var result = __native_fetch(url, method, JSON.stringify(headers), body, followRedirects); // SINCRON
  ...
  return { ok, status, statusText, url, headers: { get(name) }, text(), json() };
};
```

1. **`fetch` blochează.** `__native_fetch` e un apel sincron spre Kotlin; deci:
   - `Promise.allSettled([...fetch])` **nu** paralelizează în aplicație (rulează secvențial),
     dar izolează în continuare erorile; în Node rulează paralel.
   - `Promise.race` cu un timer **nu poate** întrerupe un request deja pornit.
   - `signal` e ignorat de polyfill (FLAX raportează că pe device îl strică).
2. **Body-ul e string** → nu există `FormData`; multipart se construiește manual ca string, cu
   header `Content-Type: multipart/form-data; boundary=...`.
3. `response.json()` returnează `null` (nu aruncă) la JSON invalid.
4. Header-ele de răspuns sunt lowercase; `redirect: 'manual'` este suportat.

**Consecință pentru timeout-ul global (~15 s):** implementăm un **buget pe deadline**
(`Date.now()`), verificat înainte de fiecare pas de rețea. Când expiră, sărim pașii rămași și
returnăm ce avem (sau `[]`). Dacă `setTimeout` există (Node), adăugăm și un `Promise.race`
real. Plasa finală e timeout-ul de 60 s al aplicației.

---

## 5. Build pentru runtime

Din `tapframe/nuvio-providers/build.js` (identic la phisher):

```js
esbuild.build({
  entryPoints: ['src/<name>/index.js'],
  bundle: true,
  outfile: 'providers/<name>.js',
  format: 'cjs',          // module.exports
  platform: 'neutral',
  target: 'es2016',       // async/await -> generatoare (necesar pentru Hermes; inofensiv în QuickJS)
  minify: false,
  external: ['cheerio-without-node-native','react-native-cheerio','cheerio','crypto-js','axios'],
  banner: { js: '/** <name> - Built from src/<name>/ ... */' },
});
```

- `esbuild` ^0.20 ca devDependency. Fără Babel.
- `async/await` **trebuie** transpilat (Hermes aruncă „async functions are unsupported").
- Spread pe obiecte, `?.`, `??` sunt și ele coborâte la ES2016 de esbuild.
- Nicio cheie nu e injectată la build (repo public); build-ul verifică să nu rămână
  referințe la `process` în bundle.
- Manifestul **nu** e generat de build-ul oficial; îl vom genera noi din metadatele provider-ului.

---

## 6. TorBox API (din colecția Postman oficială)

Base: `https://api.torbox.app/v1/api`, auth `Authorization: Bearer <key>`. Toate răspunsurile:
`{ success, error, detail, data }`.

### `GET /torrents/checkcached?hash=h1,h2&format=object&list_files=true`
- Hash-uri separate prin virgulă (sau `hash=` repetat); ~100 / request.
- `data` cu `format=object`: `{ "<hash>": { name, size, hash, files: [{ id, name, size, short_name, mimetype, opensubtitles_hash }] } }`.
  Hash-urile necached **lipsesc** din obiect. (Nu e garantat că cheia e lowercase → normalizăm.)

### `POST /torrents/createtorrent` (multipart/form-data)
- Câmpuri: `magnet` | `file` (exclusiv), `seed` (1 auto / 2 seed / 3 nu), `allow_zip`, `name`,
  `as_queued`, **`add_only_if_cached`** (bool) — exact ce ne trebuie: nu adaugă nimic necached.
- Succes: `data: { hash, torrent_id, auth_id }`.
- Erori: `DOWNLOAD_NOT_CACHED`, `ACTIVE_LIMIT`, `MONTHLY_LIMIT`, `COOLDOWN_LIMIT`,
  `DOWNLOAD_TOO_LARGE`, `DIFF_ISSUE`, `UNKNOWN_ERROR`, `AUTH_ERROR`, `BAD_TOKEN`, `NO_AUTH`.
- Limite: 300 req/min total; 60 necached/oră.
- Cazul „există deja în cont" nu e documentat explicit → fallback: căutăm hash-ul în
  `GET /torrents/mylist` și luăm `id`-ul de acolo.

### `GET /torrents/mylist?id=<torrent_id>&bypass_cache=true`
- Cu `id` returnează un singur obiect; fără, listă. Fiecare torrent are `id`, `hash`, `name`,
  `files: [{ id, name, short_name, size, mimetype, ... }]`.
- Lista e cache-uită server-side 600 s → `bypass_cache=true` după un `createtorrent`.

### `GET /torrents/requestdl?token=<KEY>&torrent_id=<ID>&file_id=<FID>&redirect=true`
- Auth prin parametrul `token` (nu header). Cu `redirect=true` face 302 spre CDN →
  **permalink** recomandat explicit de TorBox; potrivit ca `url` de stream.
- Alți parametri: `zip_link`, `user_ip`, `append_name`.
- ⚠️ URL-ul conține cheia API → ajunge în player/loguri.

---

## 7. Decizii derivate pentru `rodub`

- Manifest în formă obiect, generat de `build.js`: `contentLanguage: ["ro"]`,
  `formats: ["mkv","mp4"]`, `supportedTypes: ["movie","tv"]`, `hasSettings: true` (avem `onSettings`).
- Publicare pe GitHub Pages prin GitHub Actions: `dist/manifest.json` + `dist/rodub.js`.
  `filename` e URL-ul absolut `https://edigrig-exe.github.io/nuvio-dubro-plugin/rodub.js`.
  Aplicația îl folosește direct
  (`PluginRepository.kt`: `if (filename.startsWith("http")) filename else "$baseUrl/$filename"`).
- Repo și bundle publice → nicio cheie la build. Cheile TorBox/TMDB și URL-ul sursei vin doar
  din `SCRAPER_SETTINGS` (setările plugin-ului în aplicație, câmpuri `type: "text"` cu
  `isPassword: true`, vezi `PluginSettingsDialog.kt`).

## 8. Căutarea TorBox (verificat 2026-10-12): nu e utilizabilă

- `GET /v1/api/torrents/search` și `/torrents/storesearch` → **404**, la fel ca o rută
  inexistentă (o rută reală fără cheie, ex. `/torrents/checkcached`, dă 401). Nu apar nici
  în colecția Postman oficială.
- API-ul de căutare separat, anunțat în changelog (`https://search-api.torbox.app`, cu
  `/torrents/imdb:tt…`), **nu mai are înregistrare DNS A** (verificat și prin Cloudflare și
  Google DNS-over-HTTPS). Domeniul nu mai servește.
- Concluzie: nu există `sources/torbox-search.js`.
- Bundle ES2016/CJS, fără `setTimeout` neprotejat, fără `FormData`, fără `signal` pe `fetch`.
- Multipart manual pentru `createtorrent` + `add_only_if_cached=true`.
- File id-ul final luat din `mylist?id=` (sursa sigură pentru id-urile din cont), cu
  selecția fișierului pregătită din lista `checkcached` (nume/mărime).
- Stream-urile completează și `size`, `language: "ro"`, `infoHash`, `seeders` (citite de aplicație).
- Test local în Node 18+ **și** într-un context `vm` fără timere (după modelul FLAX), ca
  bundle-ul să fie verificat în condițiile reale.

## 9. Aplicațiile curente și diferențele între platforme (verificat 2026-10-13)

- Repo-urile oficiale s-au mutat în organizația **NuvioMedia** (`NuvioMobile`, `NuvioTV`,
  `NuvioDesktop`, `NuvioTVSmart`). `tapframe/NuvioMobile`, folosit la secțiunile 1–6, e o copie
  veche (iulie 2026); formatul manifestului și al stream-ului au rămas aceleași.
- **NuvioMobile actual**: `fetch` e asincron (`asyncFunction`), suportă body binar și
  `arrayBuffer()`; există `setTimeout`/`setInterval` reale (`__plugin_sleep`, max 60 s);
  `signal` tot nu e respectat; răspunsurile sunt limitate la 1 MB.
- **Sincronizarea** (`sync_push_plugins`) trimite doar `url`, `name`, `enabled`, `sortOrder` ale
  repository-urilor — **setările plugin-urilor nu se sincronizează**.
- **NuvioTV** are runtime propriu (`core/plugin/PluginRuntime.kt`): expune `SCRAPER_SETTINGS`,
  dar aplicația **nu are UI pentru setările plugin-urilor** (`setScraperSettings` nu e apelat
  nicăieri). Acceptă `filename` absolut; face întâi un `HEAD` pentru `Content-Length`.
- Consecință: pentru TV și dispozitive sincronizate, cheile vin din varianta personală servită de
  worker (`/<token>/plugin/…`, `globalThis.RODUB_DEFAULTS`), nu din repo-ul public.
