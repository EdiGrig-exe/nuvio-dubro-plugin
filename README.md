# RoDub 🇷🇴 — provider Nuvio pentru conținut dublat în română

Plugin (local scraper) pentru aplicația [Nuvio](https://github.com/tapframe/NuvioMobile) care
găsește **filme, seriale și desene animate dublate în limba română** și le redă prin
**TorBox**. Returnează doar torrente aflate deja în cache-ul TorBox, deci redarea pornește
imediat.

Nu e addon Stremio. E un provider JavaScript nativ Nuvio, încărcat dintr-un `manifest.json`
publicat automat pe GitHub Pages.

**URL-ul de pus în Nuvio:**

```
https://edigrig-exe.github.io/nuvio-dubro-plugin/manifest.json
```

> [!IMPORTANT]
> **Repo-ul și bundle-ul sunt publice și nu conțin nicio cheie.** Cheia TorBox, cheia TMDB și
> URL-ul sursei se introduc **doar în aplicație** (Settings → Plugins → RoDub) și rămân pe
> telefonul tău. Build-ul nu citește `.env`, iar workflow-ul pică dacă în fișierele publicate
> apare ceva ce seamănă cu o cheie.
> Link-urile de redare generate pe telefon conțin în continuare cheia TorBox (`token=...`),
> pentru că așa funcționează permalink-urile TorBox. Nu le distribui.

---

## Configurare în Nuvio

1. **Settings → Plugins → Install Plugin Repository**
   (în versiunile mai vechi: **Settings → Local Scrapers → Add Repository URL**).
2. Lipește `https://edigrig-exe.github.io/nuvio-dubro-plugin/manifest.json`.
3. Activează **RoDub 🇷🇴**, apoi deschide setările lui (**Settings → Plugins → RoDub**) și
   completează:

   | Câmp | Ce pui acolo |
   |---|---|
   | **TorBox API Key** | cheia de la <https://torbox.app/settings> |
   | **TMDB API Key** | API Key v3 (nu Read Access Token) de la <https://www.themoviedb.org/settings/api> |
   | **URL sursă (addon Stremio)** | URL-ul unui addon Stremio configurat **fără debrid**, fără `/manifest.json` la final |

4. Deschide un titlu: stream-urile apar ca `RoDub ⚡ 1080p` etc.

Fără cele două chei, plugin-ul nu face niciun request și scrie în log
`[RoDub] lipsește cheia TMDB sau TorBox`.

## Configurare în GitHub (o singură dată)

Repo: <https://github.com/EdiGrig-exe/nuvio-dubro-plugin>

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   Fără pasul ăsta, jobul `deploy` pică.
2. **Settings → Actions → General → Actions permissions:** acțiunile trebuie să fie permise
   (implicit da). Dacă ai restrâns lista, permite cel puțin acțiunile create de GitHub
   (`actions/*`).
3. **Workflow permissions** poate rămâne pe „Read repository contents”. Workflow-ul își cere
   singur `pages: write` și `id-token: write`, de care are nevoie deploy-ul pe Pages.

Mediul `github-pages` (Settings → Environments) e creat automat la primul deploy și acceptă
implicit doar branch-ul `main`.

## Cum se publică

Orice push pe `main` pornește [.github/workflows/publish.yml](.github/workflows/publish.yml):

1. `npm ci`
2. `npm test`: filtrele, fluxul complet simulat și testele scanerului de secrete
3. `npm run build`: `dist/rodub.js` + `dist/manifest.json`
4. `node tools/scan-secrets.js dist`: **pică** dacă găsește UUID-uri (formatul cheilor TorBox),
   32 de caractere hex (formatul cheilor TMDB v3), JWT, token-uri GitHub sau valori lungi
   lângă `key` / `token` / `secret`
5. publicare pe GitHub Pages

Workflow-ul se poate porni și manual: tab-ul **Actions → Publish → Run workflow**.

### Verificare

1. Tab-ul **Actions**: ultima rulare **Publish** are **bifă verde** la ambele joburi
   (`build` și `deploy`). Dacă e roșie, deschide jobul și pasul care a picat.
2. Deschide în browser
   <https://edigrig-exe.github.io/nuvio-dubro-plugin/manifest.json>. Trebuie să vezi JSON-ul
   manifestului, cu `"filename": "https://edigrig-exe.github.io/nuvio-dubro-plugin/rodub.js"`.
3. În Nuvio, apasă **Refresh** pe repository ca să ia ultima versiune. Pages poate servi
   versiunea veche câteva minute (cache CDN).

**Actualizări:** modifici codul, crești `version` în `src/rodub/meta.json`, faci commit și push
pe `main`, apoi dai Refresh în Nuvio.

---

## Dezvoltare locală

Cerințe: **Node.js 18+**.

```bash
npm install
npm test             # teste unitare + flux complet simulat + scanerul de secrete (fără rețea)
npm run build        # dist/rodub.js + dist/manifest.json (fără chei)
npm run scan-secrets # aceeași scanare ca în CI, pe dist/
```

### Test real cu cheile tale (`.env`, doar local)

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# completează TORBOX_API_KEY, TMDB_API_KEY, SOURCE_URL
npm run dev-test            # build + getStreams pe un film, un serial S01E01 și un desen animat
node test.js 82728 tv 1 3   # un titlu anume (TMDB id, tip, sezon, episod)
node tools/sandbox.js       # la fel, fără timere și cu fetch ca în aplicație
```

`.env` e folosit **doar** de `test.js`. Valorile ajung în plugin la rulare, ca setări, exact cum
le dă aplicația. Build-ul nu citește `.env`, iar fișierul e în `.gitignore`.

## Sursa de release-uri

Sursele stau în `src/rodub/sources/`. Fiecare exportă:

```js
export default {
  name: 'nume-scurt',
  async search({ imdbId, title, titleRo, originalTitle, year, mediaType, season, episode }, { http }) {
    // http.json(url, options) respectă bugetul de timp al apelului
    return [{ name, infoHash, magnet, size, seeders }];   // infoHash SAU magnet; size în bytes
  },
};
```

Sursa inclusă, `sources/example.js`, citește un endpoint compatibil Stremio:
`<URL sursă>/stream/movie/<imdbId>.json` sau `/stream/series/<imdbId>:<sezon>:<episod>.json`.
Addon-ul trebuie configurat **fără debrid**. RoDub are nevoie de `infoHash` ca să verifice
singur cache-ul TorBox. Dacă addon-ul returnează link-uri HTTP gata rezolvate, în log apare:

```
[RoDub] sursa „example" a eșuat: addon-ul a returnat N stream-uri, dar N sunt link-uri HTTP
gata rezolvate și niciunul nu are infoHash/magnet. Probabil e configurat cu un serviciu debrid; ...
```

Pentru o sursă nouă, creezi fișierul și îl adaugi în `SOURCES` din `sources/index.js`. Sursele
rulează în paralel (`Promise.allSettled`), iar rezultatele sunt deduplicate după `infoHash`.
O sursă căzută e logată și nu le afectează pe celelalte.

> Căutarea TorBox (`/torrents/search`, `/torrents/storesearch`, `search-api.torbox.app`) nu e
> disponibilă: endpoint-urile răspund 404, iar domeniul API-ului de căutare nu mai există.
> Detalii în [NOTES.md](NOTES.md#8-căutarea-torbox-verificat-2026-10-12-nu-e-utilizabilă).

## Cum funcționează

1. **TMDB:** un singur request aduce titlul englez, titlul original, titlul românesc (traducerea
   `ro-RO`), anul, IMDb id-ul și genurile. Genul 16 (Animation) adaugă eticheta „🎨 Desene”.
2. **Surse:** release-uri deduplicate după `infoHash`.
3. **Filtru:** `isRomanianDub` (Dublat, RoDub, RO.Audio, ROMANIAN.DUB…, cu protecție pentru
   „RO” izolat, subtitrări și „Türkçe Dublaj”). Pentru seriale acceptă episodul exact
   (S01E03, 1x03) și pachete de sezon (S01, Season 1, Sezonul 1).
4. **TorBox:** `checkcached` pentru toate hash-urile odată; rămân doar cele în cache și cu un
   fișier potrivit (filmul: cel mai mare `.mkv/.mp4/.avi`; serialul: fișierul SxxEyy).
5. Doar primele **8** candidate, sortate după calitate și apoi după mărime, sunt adăugate în
   cont (`createtorrent` cu `add_only_if_cached=true`). Torrentele deja existente sunt găsite
   în `mylist`.
6. Link-ul final e permalink-ul TorBox
   `requestdl?token=…&torrent_id=…&file_id=…&redirect=true`.

**Timeout:** bugetul e de ~15 s pe apel. În Nuvio nu există `setTimeout`, iar `fetch` blochează,
deci un request pornit nu poate fi întrerupt. RoDub verifică timpul rămas înainte de fiecare
request și returnează ce a găsit până atunci. Orice eroare e logată cu prefixul `[RoDub]`, iar
rezultatul e `[]`, fără excepții. URL-ul sursei nu apare niciodată în loguri.

## Structură

```
.github/workflows/publish.yml   CI: teste → build → scanare secrete → GitHub Pages
build.js                        esbuild → dist/rodub.js + dist/manifest.json
test.js                         rulare reală getStreams cu setările din .env
src/rodub/
  meta.json                     metadate + URL-ul public (sursa manifestului)
  index.js                      getStreams + onSettings
  config.js  http.js            setări din aplicație, limite, fetch cu buget de timp
  tmdb.js  filters.js  torbox.js
  sources/index.js              interfața surselor + agregare
  sources/example.js            sursa exemplu (addon Stremio fără debrid)
tests/                          teste unitare, flux simulat, scanerul de secrete
tools/                          scan-secrets, harness/sandbox, citire .env locală
NOTES.md                        formatul Nuvio extras din repo-urile de referință
```
