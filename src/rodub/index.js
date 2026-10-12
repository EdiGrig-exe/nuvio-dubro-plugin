/**
 * RoDub – provider Nuvio pentru stream-uri dublate în limba română, prin TorBox.
 *
 * Flux: TMDB → surse (în paralel) → filtru dublaj RO + episod → TorBox checkcached →
 *       primele N candidate cached → createtorrent → file_id → permalink requestdl.
 */
import { getSettings, TIMEOUT_MS, MAX_STREAMS, MAX_TORBOX_ADDS } from './config.js';
import { createDeadline, createHttp, raceTimeout, log, logError } from './http.js';
import { getMeta } from './tmdb.js';
import { searchAll } from './sources/index.js';
import { createTorbox } from './torbox.js';
import {
    isRomanianDub,
    classifyRelease,
    pickFile,
    parseQuality,
    compareStreams,
    formatSize,
} from './filters.js';

// Plasă de siguranță peste bugetul intern, care oricum oprește fiecare request la termen.
const GLOBAL_GRACE_MS = 1000;

function fileBaseName(file) {
    return file.short_name || String(file.name || '').split(/[\\/]/).pop();
}

function toStream(candidate, url, meta) {
    const { release, file, quality, size } = candidate;
    const sizeText = formatSize(size);
    const tags = ['🇷🇴 Dublat'];
    if (meta.isAnimation) tags.push('🎨 Desene');

    const lines = [[quality, sizeText].concat(tags).filter(Boolean).join(' · '), release.name];
    if (release.kind === 'pack' || release.kind === 'unknown') lines.push(`📄 ${fileBaseName(file)}`);
    lines.push('⚡ TorBox');

    return {
        name: `RoDub ⚡ ${quality}`,
        title: lines.join('\n'),
        url,
        quality,
        size: sizeText || undefined,
        language: 'ro',
        infoHash: release.infoHash,
        seeders: release.seeders === null ? undefined : release.seeders,
    };
}

async function findStreams(tmdbId, mediaType, season, episode, deadline) {
    const keys = getSettings();
    if (!keys.tmdbApiKey || !keys.torboxApiKey) {
        logError('lipsește cheia TMDB sau TorBox: completează-le în Settings → Plugins → RoDub');
        return [];
    }

    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const s = Number(season);
    const e = Number(episode);
    if (type === 'tv' && !(s >= 0 && e >= 1)) {
        logError(`serial fără sezon/episod valid: S${season}E${episode}`);
        return [];
    }

    const http = createHttp(deadline);
    const meta = await getMeta(http, keys.tmdbApiKey, tmdbId, type);
    log(`${type} ${tmdbId}: „${meta.title}" / „${meta.titleRo}" (${meta.year || '?'}) ${meta.imdbId || 'fără IMDb'}` +
        (type === 'tv' ? ` S${s}E${e}` : '') + (meta.isAnimation ? ' [Desene]' : ''));

    const query = {
        imdbId: meta.imdbId,
        title: meta.title,
        titleRo: meta.titleRo,
        originalTitle: meta.originalTitle,
        year: meta.year,
        mediaType: type,
        season: type === 'tv' ? s : undefined,
        episode: type === 'tv' ? e : undefined,
    };
    const releases = await searchAll(query, { http });

    const dubbed = releases
        .map((r) => Object.assign({}, r, { kind: type === 'tv' ? classifyRelease(r.name, s, e) : 'movie' }))
        .filter((r) => r.kind && isRomanianDub(r.name));
    log(`${releases.length} release-uri găsite, ${dubbed.length} dublate RO`);
    if (dubbed.length === 0) return [];

    const torbox = createTorbox(http, keys.torboxApiKey);
    const cached = await torbox.checkCached(dubbed.map((r) => r.infoHash));

    const candidates = [];
    for (const release of dubbed) {
        const info = cached.get(release.infoHash);
        if (!info) continue;
        const file = pickFile(info.files, { type, season: s, episode: e, releaseKind: release.kind });
        if (!file) continue;
        const fromName = parseQuality(release.name);
        candidates.push({
            release,
            file,
            quality: fromName !== 'SD' ? fromName : parseQuality(fileBaseName(file)),
            size: Number(file.size) || release.size || info.size || 0,
        });
    }
    candidates.sort(compareStreams);

    // Doar primele N ajung în contul TorBox: fiecare createtorrent consumă din limita de 300/min.
    const selected = candidates.slice(0, MAX_TORBOX_ADDS);
    log(`${cached.size} în cache TorBox, ${candidates.length} cu fișier potrivit, adaug ${selected.length}`);

    const streams = [];
    for (const candidate of selected) {
        if (deadline.expired()) {
            log(`buget de timp epuizat, returnez ${streams.length} stream-uri`);
            break;
        }
        try {
            const torrentId = await torbox.ensureTorrent(candidate.release.infoHash, candidate.release.magnet);
            const fileId = await torbox.resolveFileId(torrentId, candidate.file);
            streams.push(toStream(candidate, torbox.streamUrl(torrentId, fileId), meta));
        } catch (error) {
            logError(`${candidate.release.name}: ${error && error.message ? error.message : error}`);
        }
    }
    return streams.slice(0, MAX_STREAMS);
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const started = Date.now();
    const deadline = createDeadline(TIMEOUT_MS);
    try {
        const streams = await raceTimeout(
            findStreams(tmdbId, mediaType, season, episode, deadline),
            TIMEOUT_MS + GLOBAL_GRACE_MS,
            'timeout global'
        );
        log(`${streams.length} stream-uri în ${Date.now() - started} ms`);
        return streams;
    } catch (error) {
        logError(error && error.message ? error.message : error);
        return [];
    }
}

// Setări în aplicație (Settings → Plugins → RoDub). Sunt singurul loc din care plugin-ul
// își ia cheile: bundle-ul public nu conține niciuna. Nuvio le expune ca SCRAPER_SETTINGS.
async function onSettings() {
    return [
        { type: 'header', label: 'Chei API' },
        {
            type: 'text',
            key: 'torboxApiKey',
            label: 'TorBox API Key',
            placeholder: 'cheia TorBox',
            description: 'De la torbox.app/settings. Obligatorie.',
            isPassword: true,
        },
        {
            type: 'text',
            key: 'tmdbApiKey',
            label: 'TMDB API Key',
            placeholder: 'cheia TMDB v3',
            description: 'API Key (v3) de la themoviedb.org/settings/api. Obligatorie.',
            isPassword: true,
        },
        { type: 'header', label: 'Sursă de release-uri' },
        {
            type: 'text',
            key: 'sourceUrl',
            label: 'URL sursă (addon Stremio)',
            placeholder: 'https://addon.exemplu/configurare',
            description: 'URL-ul unui addon Stremio FĂRĂ debrid, fără /manifest.json la final. ' +
                'Poate conține date de configurare private, de aceea e ascuns.',
            isPassword: true,
        },
    ];
}

module.exports = { getStreams, onSettings };
