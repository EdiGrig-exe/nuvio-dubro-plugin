import { existsSync, readFileSync } from 'node:fs';

// Doar pentru rulările locale (test.js): .env NU e citit la build și nu ajunge în bundle.
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(value) {
    if (/^(['"]).*\1$/.test(value)) return value.slice(1, -1);
    return value.replace(/\s+#.*$/, '');
}

export function readEnvFile(path) {
    if (!existsSync(path)) return {};
    const env = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        if (/^\s*(#|$)/.test(line)) continue;
        const m = LINE_RE.exec(line);
        if (m) env[m[1]] = unquote(m[2]);
    }
    return env;
}

// Transformă .env în setările pe care Nuvio le dă plugin-ului (SCRAPER_SETTINGS).
export function settingsFromEnv(path = '.env') {
    const env = Object.assign(readEnvFile(path), pickDefined(process.env, ['TORBOX_API_KEY', 'TMDB_API_KEY', 'SOURCE_URL']));
    return {
        torboxApiKey: env.TORBOX_API_KEY || '',
        tmdbApiKey: env.TMDB_API_KEY || '',
        sourceUrl: env.SOURCE_URL || '',
    };
}

function pickDefined(source, keys) {
    const out = {};
    for (const key of keys) if (source[key]) out[key] = source[key];
    return out;
}
