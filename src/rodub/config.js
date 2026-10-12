// Cheile și URL-ul sursei NU sunt incluse în build: repo-ul și bundle-ul sunt publice.
// Se configurează în aplicație (Settings → Plugins → RoDub), iar Nuvio le expune
// plugin-ului ca globalThis.SCRAPER_SETTINGS. Local, test.js le citește din .env.

export const LOG_PREFIX = '[RoDub]';

// Bugetul total pentru un apel getStreams. Aplicația are propriul timeout de 60 s.
export const TIMEOUT_MS = 15000;

// Câte stream-uri returnăm maxim și, implicit, câte torrente adăugăm în contul TorBox.
export const MAX_STREAMS = 8;
export const MAX_TORBOX_ADDS = MAX_STREAMS;

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi'];

function readSetting(name) {
    try {
        const settings = typeof globalThis !== 'undefined' ? globalThis.SCRAPER_SETTINGS : null;
        const value = settings && settings[name];
        return typeof value === 'string' ? value.trim() : '';
    } catch (e) {
        return '';
    }
}

export function getSettings() {
    return {
        torboxApiKey: readSetting('torboxApiKey'),
        tmdbApiKey: readSetting('tmdbApiKey'),
        sourceUrl: readSetting('sourceUrl'),
    };
}
