import { VIDEO_EXTENSIONS } from './config.js';

// Normalizarea se face manual: String.prototype.normalize nu e garantat în toate runtime-urile.
const CHAR_MAP = {
    'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ş': 's', 'ț': 't', 'ţ': 't',
    'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ü': 'u', 'é': 'e', 'è': 'e', 'á': 'a',
};

export function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[ăâîșşțţçğıöüéèá]/g, (ch) => CHAR_MAP[ch] || ch);
}

export function tokenize(text) {
    return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Dublaj românesc
// ---------------------------------------------------------------------------

// Token-uri care indică singure un dublaj românesc.
const STRONG_DUB = new Set([
    'dublat', 'dublata', 'dublate', 'dublati',
    'rodub', 'rodubbed', 'rodubbing', 'rodublat', 'rodublaj',
    'roaudio', 'audioro', 'romdub',
]);

// Cuvinte care marchează limba română. „ro" e acceptat doar lângă un cuvânt de dublaj/audio.
const RO_CONTEXT = new Set(['ro', 'romanian', 'romana', 'romaneste', 'romanesc', 'romaneasca']);
// Variante lungi: în numele scene, limba singură (ex. „ROMANIAN") înseamnă pista audio.
const RO_LONG = new Set(['romanian', 'romana', 'romaneste', 'romanesc', 'romaneasca']);

const DUB_CONTEXT = new Set(['dub', 'dubbed', 'dubbing', 'dublaj', 'dublat', 'dublata', 'dublate', 'audio']);

const SUB_CONTEXT = new Set([
    'sub', 'subs', 'subbed', 'subtitle', 'subtitles', 'subtitrat', 'subtitrata', 'subtitrare',
    'subtitrari', 'rosub', 'rosubs', 'subro', 'hardsub', 'softsub',
]);

// Semne clare că release-ul are doar subtitrare românească.
const RO_SUB_ONLY = new Set(['rosub', 'rosubs', 'subro', 'subtitrat', 'subtitrata', 'subtitrare']);

// „Dublaj" e și cuvântul turcesc pentru dublaj („Türkçe Dublaj").
const TURKISH = new Set(['turkce', 'turkish']);

const WINDOW = 2;

function near(tokens, index, set) {
    const from = Math.max(0, index - WINDOW);
    const to = Math.min(tokens.length - 1, index + WINDOW);
    for (let i = from; i <= to; i++) {
        if (i !== index && set.has(tokens[i])) return true;
    }
    return false;
}

export function isRomanianDub(name) {
    const tokens = tokenize(name);
    if (tokens.some((t) => STRONG_DUB.has(t))) return true;
    if (tokens.some((t) => TURKISH.has(t))) return false;

    const subOnly = tokens.some((t) => RO_SUB_ONLY.has(t));
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!RO_CONTEXT.has(token)) continue;
        if (near(tokens, i, SUB_CONTEXT)) continue;
        if (near(tokens, i, DUB_CONTEXT)) return true;
        if (!subOnly && RO_LONG.has(token)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Calitate și mărime
// ---------------------------------------------------------------------------

const QUALITY_RANK = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };

export function parseQuality(name) {
    const n = normalize(name);
    if (/2160p/.test(n)) return '2160p';
    if (/1080[pi]/.test(n)) return '1080p';
    if (/720p/.test(n)) return '720p';
    if (/(?:480|576)p/.test(n)) return '480p';
    if (/(?:^|[^a-z0-9])(?:4k|uhd)(?:[^a-z0-9]|$)/.test(n)) return '2160p';
    return 'SD';
}

export function qualityRank(quality) {
    return QUALITY_RANK[quality] || 0;
}

export function formatSize(bytes) {
    const n = Number(bytes);
    if (!n || n < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = n;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit >= 3 ? 2 : 0)} ${units[unit]}`;
}

// Calitate descrescătoare, apoi mărime descrescătoare.
export function compareStreams(a, b) {
    const byQuality = qualityRank(b.quality) - qualityRank(a.quality);
    if (byQuality !== 0) return byQuality;
    return (Number(b.size) || 0) - (Number(a.size) || 0);
}

// ---------------------------------------------------------------------------
// Sezoane și episoade
// ---------------------------------------------------------------------------

// S01E03, S1E3, S01.E03, S01E01-E03, S01E01E02, S01E01-03
const SXE_RE = /(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,4})(?:[ ._-]?(?:-|e)[ ._-]?e?(\d{1,4})(?![0-9pi]))?/g;
// 1x03
const NXN_RE = /(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?![0-9])/g;
// S01, S01-S03, S01-03 (fără episod după)
const SEASON_RE = /(?:^|[^a-z0-9])s(\d{1,2})(?![0-9]|[ ._-]?e\d)(?:[ ._-]?-[ ._-]?s?(\d{1,2})(?![0-9]|[ ._-]?e\d))?/g;
// Season 1, Sezonul 1, Sezon 1-3, Seasons 1 to 3
const SEASON_WORD_RE = /(?:^|[^a-z0-9])(?:seasons?|sezonul|sezonu|sezoanele|sezon)[ ._-]?(\d{1,2})(?:[ ._-]?(?:-|to|si|&)[ ._-]?(\d{1,2}))?(?![0-9])/g;
const COMPLETE_RE = /(?:^|[^a-z0-9])(?:complete|integral|integrala|completa|complet)(?:[^a-z0-9]|$)/;

function allMatches(re, text) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(m);
        // Separatorul consumat la început poate fi necesar pentru potrivirea următoare.
        if (m[0].length > 1) re.lastIndex = m.index + 1;
    }
    return out;
}

// Episoadele menționate explicit în text: [{ season, from, to }]
export function episodeRefs(text) {
    const n = normalize(text);
    const refs = [];
    for (const m of allMatches(SXE_RE, n)) {
        const from = Number(m[2]);
        let to = m[3] !== undefined ? Number(m[3]) : from;
        if (to < from || to - from > 50) to = from;
        refs.push({ season: Number(m[1]), from, to });
    }
    for (const m of allMatches(NXN_RE, n)) {
        refs.push({ season: Number(m[1]), from: Number(m[2]), to: Number(m[2]) });
    }
    return refs;
}

export function matchesEpisode(text, season, episode) {
    return episodeRefs(text).some((r) => r.season === season && episode >= r.from && episode <= r.to);
}

// Sezoanele acoperite de un pachet: { ranges: [[from, to]], complete }
export function seasonRefs(text) {
    const n = normalize(text);
    const ranges = [];
    for (const re of [SEASON_RE, SEASON_WORD_RE]) {
        for (const m of allMatches(re, n)) {
            const from = Number(m[1]);
            let to = m[2] !== undefined ? Number(m[2]) : from;
            if (to < from) to = from;
            ranges.push([from, to]);
        }
    }
    return { ranges, complete: COMPLETE_RE.test(n) };
}

function seasonIncluded(refs, season) {
    return refs.ranges.some(([from, to]) => season >= from && season <= to);
}

/**
 * Cum se raportează un release de serial la episodul cerut:
 *   'episode' – conține exact episodul (S01E03, 1x03, S01E01-E05)
 *   'pack'    – pachet de sezon care include sezonul (S01, Season 1, Complete)
 *   'unknown' – nu are marcaje; decide lista de fișiere
 *   null      – se referă clar la alt episod / alt sezon
 */
export function classifyRelease(name, season, episode) {
    if (matchesEpisode(name, season, episode)) return 'episode';
    if (episodeRefs(name).length > 0) return null;
    const seasons = seasonRefs(name);
    if (seasons.ranges.length > 0) return seasonIncluded(seasons, season) ? 'pack' : null;
    if (seasons.complete) return 'pack';
    return 'unknown';
}

// ---------------------------------------------------------------------------
// Alegerea fișierului din torrent
// ---------------------------------------------------------------------------

function filePath(file) {
    return String(file.name || file.short_name || '');
}

function baseName(file) {
    const path = filePath(file);
    return file.short_name || path.split(/[\\/]/).pop();
}

export function isVideoFile(file) {
    const name = filePath(file).toLowerCase();
    const ext = name.split('.').pop();
    if (VIDEO_EXTENSIONS.indexOf(ext) === -1) return false;
    return !/(?:^|[^a-z0-9])(?:sample|trailer)(?:[^a-z0-9]|$)/.test(normalize(baseName(file)));
}

function largest(files) {
    return files.reduce((best, f) => (!best || (Number(f.size) || 0) > (Number(best.size) || 0) ? f : best), null);
}

function looseEpisodeMatch(file, episode) {
    const n = normalize(baseName(file));
    const ep = String(episode);
    const prefixed = new RegExp(`(?:^|[^a-z0-9])(?:e|ep|episode|episodul|episod)[ ._-]?0*${ep}(?![0-9])`);
    const dashed = new RegExp(`(?:^|[ ._])-[ ._]0*${ep}(?![0-9])`);
    return prefixed.test(n) || dashed.test(n);
}

/**
 * Alege fișierul video de redat.
 *   film   – cel mai mare fișier video
 *   serial – fișierul care conține SxxEyy; altfel „Episode N" / „E03" / „ - 03" într-un
 *            folder al sezonului corect; altfel singurul video dintr-un release de episod.
 */
export function pickFile(files, { type, season, episode, releaseKind }) {
    const videos = (files || []).filter(isVideoFile);
    if (videos.length === 0) return null;
    if (type !== 'tv') return largest(videos);

    const exact = videos.filter((f) => matchesEpisode(filePath(f), season, episode));
    if (exact.length > 0) return largest(exact);

    const loose = videos.filter((f) => {
        if (episodeRefs(filePath(f)).length > 0) return false;
        if (!looseEpisodeMatch(f, episode)) return false;
        const seasons = seasonRefs(filePath(f));
        if (seasons.ranges.length > 0) return seasonIncluded(seasons, season);
        // Fără sezon în cale: acceptăm doar dacă release-ul însuși indică sezonul corect.
        // La pachete multi-sezon fără foldere, același „Episode 3" apare de mai multe ori,
        // iar potrivirea ambiguă e respinsă mai jos.
        return releaseKind === 'episode' || releaseKind === 'pack';
    });
    if (loose.length === 1) return loose[0];

    if (releaseKind === 'episode' && videos.length === 1) return videos[0];
    return null;
}
