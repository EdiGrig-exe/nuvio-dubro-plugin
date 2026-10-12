import { LOG_PREFIX } from './config.js';

// În aplicația Nuvio nu există setTimeout, iar fetch blochează până la răspuns, deci un
// request pornit nu poate fi întrerupt. Timeout-ul e un buget: înainte de fiecare request
// verificăm cât timp a mai rămas. Unde există timere (Node), anulăm efectiv request-ul.
const HAS_TIMERS = typeof setTimeout === 'function' && typeof clearTimeout === 'function';

export class TimeoutError extends Error {
    constructor(message) {
        super(message || 'timeout');
        this.name = 'TimeoutError';
    }
}

export function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

export function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

export function createDeadline(ms) {
    const end = Date.now() + ms;
    return {
        remaining: () => Math.max(0, end - Date.now()),
        expired: () => Date.now() >= end,
    };
}

// Rulează promise-ul cu limită de timp doar dacă există timere; altfel îl returnează neschimbat.
export function raceTimeout(promise, ms, message) {
    if (!HAS_TIMERS) return promise;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    });
    return Promise.race([promise, timeout]).then(
        (value) => {
            clearTimeout(timer);
            return value;
        },
        (error) => {
            clearTimeout(timer);
            throw error;
        }
    );
}

export function createHttp(deadline) {
    async function request(url, options = {}) {
        if (deadline.expired()) throw new TimeoutError(`buget de timp epuizat înainte de ${redact(url)}`);

        const init = {
            method: options.method || 'GET',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
        };
        if (options.body !== undefined) init.body = options.body;

        // AbortController doar unde avem timere: polyfill-ul din aplicație ignoră `signal`.
        let controller = null;
        let timer = null;
        if (HAS_TIMERS && typeof AbortController === 'function') {
            controller = new AbortController();
            init.signal = controller.signal;
            timer = setTimeout(() => controller.abort(), deadline.remaining());
        }

        try {
            return await fetch(url, init);
        } catch (error) {
            if (controller && controller.signal.aborted) {
                throw new TimeoutError(`timeout la ${redact(url)}`);
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function json(url, options) {
        const response = await request(url, options);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (e) {
            data = null;
        }
        return { ok: response.ok, status: response.status, data };
    }

    return { request, json };
}

// Hosturi ale căror căi nu conțin secrete; la restul (ex. addon-uri Stremio care țin
// cheia de debrid în cale) logăm doar originea.
const SAFE_PATH_HOSTS = ['api.themoviedb.org', 'api.torbox.app'];

// Ascunde cheile din URL-uri înainte de logare.
export function redact(url) {
    const text = String(url);
    const m = /^(https?:\/\/([^/?#]+))(.*)$/i.exec(text);
    if (m && SAFE_PATH_HOSTS.indexOf(m[2].toLowerCase()) === -1) return `${m[1]}/…`;
    return text.replace(/((?:api_key|token|apikey|key)=)[^&]+/gi, '$1***');
}
