/**
 * Varianta personală a plugin-ului RoDub, servită doar cu token-ul secret:
 *
 *   GET /<ACCESS_TOKEN>/plugin/manifest.json  – manifest Nuvio care indică rodub.js de mai jos
 *   GET /<ACCESS_TOKEN>/plugin/rodub.js       – bundle-ul public (GitHub Pages) + valorile implicite
 *
 * De ce: Nuvio TV nu are ecran de setări pentru plugin-uri, iar sincronizarea Nuvio copiază doar
 * lista de repository-uri, nu și setările. Bundle-ul public rămâne fără chei; aici se adaugă la
 * început `globalThis.RODUB_DEFAULTS = {...}` cu cheile din secretele Cloudflare și URL-ul sursei
 * (chiar acest worker). Setările completate în aplicație au în continuare prioritate.
 */

export const PUBLIC_BASE = 'https://edigrig-exe.github.io/nuvio-dubro-plugin';
// Cache scurt la marginea Cloudflare: un push pe main ajunge la dispozitive în câteva minute.
const PUBLIC_CACHE_SECONDS = 300;

async function fetchPublic(path) {
    const res = await fetch(`${PUBLIC_BASE}/${path}`, { cf: { cacheTtl: PUBLIC_CACHE_SECONDS, cacheEverything: true } });
    if (!res.ok) throw new Error(`GitHub Pages ${path}: HTTP ${res.status}`);
    return res;
}

export function personalDefaults(env, workerBase) {
    const defaults = { sourceUrl: workerBase };
    if (env.TORBOX_API_KEY) defaults.torboxApiKey = env.TORBOX_API_KEY;
    if (env.TMDB_API_KEY) defaults.tmdbApiKey = env.TMDB_API_KEY;
    return defaults;
}

export async function personalManifest(workerBase) {
    const manifest = await (await fetchPublic('manifest.json')).json();
    return Object.assign({}, manifest, {
        name: `${manifest.name} (personal)`,
        description: 'RoDub cu cheile și sursa FileList incluse — pentru Nuvio TV și dispozitive sincronizate.',
        scrapers: (manifest.scrapers || []).map((s) => Object.assign({}, s, {
            id: `${s.id}-personal`,
            name: `${s.name} personal`,
            filename: `${workerBase}/plugin/${String(s.filename).split('/').pop()}`,
        })),
    });
}

export async function personalBundle(env, workerBase) {
    const code = await (await fetchPublic('rodub.js')).text();
    const preamble = `globalThis.RODUB_DEFAULTS = ${JSON.stringify(personalDefaults(env, workerBase))};\n`;
    return preamble + code;
}
