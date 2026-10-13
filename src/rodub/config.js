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

function readFrom(source, name) {
    try {
        const container = typeof globalThis !== 'undefined' ? globalThis[source] : null;
        const value = container && container[name];
        return typeof value === 'string' ? value.trim() : '';
    } catch (e) {
        return '';
    }
}

// 1. setările plugin-ului din aplicație (Nuvio mobil/PC);
// 2. RODUB_DEFAULTS, injectat de worker-ul privat în varianta personală a plugin-ului —
//    necesar pe Nuvio TV, care nu are ecran de setări pentru plugin-uri, și pe dispozitivele
//    sincronizate (sincronizarea Nuvio copiază doar lista de repository-uri, nu și setările).
function readSetting(name) {
    return readFrom('SCRAPER_SETTINGS', name) || readFrom('RODUB_DEFAULTS', name);
}

export function getSettings() {
    return {
        torboxApiKey: readSetting('torboxApiKey'),
        tmdbApiKey: readSetting('tmdbApiKey'),
        sourceUrl: readSetting('sourceUrl'),
    };
}
