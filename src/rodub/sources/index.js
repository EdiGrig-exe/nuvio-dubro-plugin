/**
 * Interfața unei surse:
 *
 *   export default {
 *     name: 'nume-scurt',
 *     async search(query, ctx) -> [{ name, infoHash, magnet, size, seeders }]
 *   }
 *
 *   query = { imdbId, title, titleRo, originalTitle, year, mediaType, season, episode }
 *     title         – titlul englez de pe TMDB (cel folosit de obicei în numele release-urilor)
 *     titleRo       – titlul românesc (traducerea ro-RO), sau `title` dacă nu există
 *     mediaType     – 'movie' | 'tv'; season/episode sunt numere doar pentru 'tv'
 *   ctx   = { http }  – folosește http.json(url, options) ca să respecți bugetul de timp
 *
 *   Rezultat: `name` e numele release-ului; e nevoie de `infoHash` SAU `magnet`;
 *   `size` în bytes și `seeders` sunt opționale.
 *
 * Pentru o sursă nouă: creează fișierul în acest folder și adaug-o în SOURCES.
 */
import { logError } from '../http.js';
import example from './example.js';

export const SOURCES = [example];

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(value) {
    let bits = '';
    for (const ch of value.toUpperCase()) {
        const v = BASE32.indexOf(ch);
        if (v === -1) return null;
        bits += ('00000' + v.toString(2)).slice(-5);
    }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
}

export function normalizeHash(value) {
    const hash = String(value || '').trim();
    if (/^[0-9a-f]{40}$/i.test(hash)) return hash.toLowerCase();
    if (/^[a-z2-7]{32}$/i.test(hash)) return base32ToHex(hash);
    return null;
}

function hashFromMagnet(magnet) {
    const m = /xt=urn:btih:([0-9a-z]+)/i.exec(String(magnet || ''));
    return m ? normalizeHash(m[1]) : null;
}

export function normalizeResult(raw) {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const infoHash = normalizeHash(raw.infoHash) || hashFromMagnet(raw.magnet);
    if (!infoHash) return null;
    const name = raw.name.trim();
    const size = Number(raw.size);
    const seeders = Number(raw.seeders);
    return {
        name,
        infoHash,
        magnet: raw.magnet || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`,
        size: size > 0 ? size : null,
        seeders: seeders >= 0 ? Math.floor(seeders) : null,
    };
}

// Toate sursele pornesc împreună; o sursă căzută e doar logată.
// (În aplicație fetch blochează, deci rulează de fapt una după alta; în Node rulează în paralel.)
export async function searchAll(query, ctx, sources = SOURCES) {
    const settled = await Promise.allSettled(
        sources.map((source) => Promise.resolve().then(() => source.search(query, ctx)))
    );

    const byHash = new Map();
    settled.forEach((outcome, i) => {
        if (outcome.status === 'rejected') {
            const reason = outcome.reason;
            logError(`sursa „${sources[i].name}" a eșuat:`, reason && reason.message ? reason.message : reason);
            return;
        }
        for (const raw of outcome.value || []) {
            const item = normalizeResult(raw);
            if (!item) continue;
            const previous = byHash.get(item.infoHash);
            if (!previous || (item.seeders || 0) > (previous.seeders || 0)) byHash.set(item.infoHash, item);
        }
    });
    return Array.from(byHash.values());
}
