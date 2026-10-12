/**
 * Sursă exemplu: orice addon Stremio care returnează stream-uri torrent
 * (GET <sourceUrl>/stream/<movie|series>/<imdbId>[:sezon:episod].json).
 * `sourceUrl` se setează în aplicație (Settings → Plugins → RoDub → URL sursă);
 * dacă e gol, sursa nu returnează nimic.
 *
 * Addon-ul trebuie configurat FĂRĂ debrid: RoDub are nevoie de infoHash/magnet ca să verifice
 * singur cache-ul TorBox. Un addon cu debrid returnează link-uri gata rezolvate.
 *
 * Înlocuiește sau completează cu sursa ta reală păstrând aceeași interfață (vezi ./index.js).
 */
import { getSettings } from '../config.js';
import { log } from '../http.js';

const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

function parseSize(text) {
    const m = /💾\s*([\d.,]+)\s*(B|KB|MB|GB|TB)\b/i.exec(text) || /\b([\d.]+)\s*(GB|MB|TB)\b/i.exec(text);
    if (!m) return null;
    return Math.round(parseFloat(m[1].replace(',', '.')) * UNITS[m[2].toUpperCase()]);
}

function parseSeeders(text) {
    const m = /👤\s*(\d+)/.exec(text);
    return m ? Number(m[1]) : null;
}

function magnetOf(stream) {
    return typeof stream.url === 'string' && /^magnet:\?/i.test(stream.url) ? stream.url : null;
}

function toResult(stream) {
    const text = String(stream.title || stream.description || '');
    const hints = stream.behaviorHints || {};
    const name = text.split('\n')[0].trim() || hints.filename || stream.name;
    return {
        name,
        infoHash: stream.infoHash,
        magnet: magnetOf(stream),
        size: parseSize(text) || hints.videoSize || null,
        seeders: parseSeeders(text),
    };
}

// Explică de ce un răspuns cu stream-uri nu conține nimic utilizabil.
function describeUnusable(streams) {
    const resolved = streams.filter((s) => typeof s.url === 'string' && /^https?:/i.test(s.url)).length;
    if (resolved > 0) {
        return `addon-ul a returnat ${streams.length} stream-uri, dar ${resolved} sunt link-uri HTTP gata rezolvate ` +
            'și niciunul nu are infoHash/magnet. Probabil e configurat cu un serviciu debrid; ' +
            'folosește URL-ul addon-ului configurat FĂRĂ debrid.';
    }
    return `addon-ul a returnat ${streams.length} stream-uri, dar niciunul nu are infoHash sau magnet.`;
}

export default {
    name: 'example',

    async search({ imdbId, mediaType, season, episode }, { http }) {
        const base = getSettings().sourceUrl.replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
        if (!base) {
            log('sursa „example": URL-ul sursei nu e setat în setările plugin-ului, o sar');
            return [];
        }
        if (!/^https?:\/\//i.test(base)) throw new Error('URL-ul sursei trebuie să înceapă cu http:// sau https://');
        if (!/^tt\d+$/.test(imdbId || '')) {
            log('sursa „example": titlul nu are IMDb id pe TMDB, o sar');
            return [];
        }

        const type = mediaType === 'tv' ? 'series' : 'movie';
        const id = mediaType === 'tv' ? `${imdbId}:${season}:${episode}` : imdbId;
        const { ok, status, data } = await http.json(`${base}/stream/${type}/${id}.json`);
        if (!ok) {
            const detail = data && typeof data.error === 'string' ? `: ${data.error}` : '';
            throw new Error(`addon-ul a răspuns cu HTTP ${status}${detail}`);
        }
        if (!data || !Array.isArray(data.streams)) {
            throw new Error('răspuns invalid: lipsește lista `streams` (URL-ul indică un addon Stremio?)');
        }

        const streams = data.streams.filter(Boolean);
        const usable = streams.filter((s) => s.infoHash || magnetOf(s));
        if (streams.length > 0 && usable.length === 0) throw new Error(describeUnusable(streams));
        log(`sursa „example": ${usable.length} stream-uri torrent`);
        return usable.map(toResult);
    },
};
