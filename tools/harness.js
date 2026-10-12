/**
 * Încarcă un bundle de provider la fel ca aplicația Nuvio (PluginRuntime.kt):
 *
 *   var module = { exports: {} }; var exports = module.exports;
 *   (function() { <cod> })();
 *
 * Mod `sandbox`: context vm cu doar ce oferă aplicația (fără setTimeout/setInterval,
 * fără FormData, fără Buffer/process/require) și un fetch care se comportă ca polyfill-ul
 * din JsBindings.kt: body doar string, `signal` neacceptat, răspuns cu text()/json().
 */
import vm from 'node:vm';

const WRAP_START = 'var module = { exports: {} };\nvar exports = module.exports;\n(function() {\n';
const WRAP_END = '\n})();\n';

export function appLikeFetch(hostFetch = globalThis.fetch) {
    return async function fetch(url, options = {}) {
        if (options.signal) throw new Error('fetch din Nuvio nu acceptă `signal`');
        if (options.body !== undefined && typeof options.body !== 'string') {
            throw new Error('fetch din Nuvio acceptă doar body de tip string');
        }
        const res = await hostFetch(url, {
            method: (options.method || 'GET').toUpperCase(),
            headers: options.headers || {},
            body: options.body || undefined,
            redirect: options.redirect === 'manual' ? 'manual' : 'follow',
        });
        const text = await res.text();
        return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            url: res.url,
            headers: { get: (name) => (res.headers && res.headers.get ? res.headers.get(name) : null) },
            text: () => Promise.resolve(text),
            json: () => {
                try {
                    return Promise.resolve(text ? JSON.parse(text) : null);
                } catch (e) {
                    return Promise.resolve(null);
                }
            },
        };
    };
}

export function loadProvider(code, { sandbox = false, fetch = globalThis.fetch, settings = {}, logger = console } = {}) {
    if (!sandbox) {
        globalThis.SCRAPER_SETTINGS = settings;
        // eslint-disable-next-line no-new-func
        return new Function(`${WRAP_START}${code}${WRAP_END}return module.exports;`)();
    }

    const context = vm.createContext({
        fetch: appLikeFetch(fetch),
        console: logger,
        AbortController,
        AbortSignal,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        atob: globalThis.atob,
        btoa: globalThis.btoa,
        SCRAPER_ID: 'rodub',
        SCRAPER_SETTINGS: settings,
    });
    vm.runInContext(
        'globalThis.global = globalThis; globalThis.window = globalThis; globalThis.self = globalThis;',
        context
    );
    for (const name of ['setTimeout', 'setInterval', 'clearTimeout', 'FormData', 'process', 'require', 'Buffer']) {
        if (vm.runInContext(`typeof ${name}`, context) !== 'undefined') {
            throw new Error(`sandbox greșit: ${name} există în context`);
        }
    }
    return vm.runInContext(`${WRAP_START}${code}${WRAP_END}module.exports;`, context, { filename: 'rodub.js' });
}

export function redactUrl(url) {
    return String(url).replace(/(token=)[^&]+/, '$1***');
}

export function printStreams(streams) {
    if (!Array.isArray(streams)) {
        console.log(`  ✗ rezultat invalid (nu e array): ${typeof streams}`);
        return;
    }
    if (streams.length === 0) {
        console.log('  (niciun stream)');
        return;
    }
    streams.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.name}`);
        for (const line of String(s.title || '').split('\n')) console.log(`     ${line}`);
        console.log(`     url: ${redactUrl(s.url)}`);
        const extra = ['quality', 'size', 'language', 'seeders', 'infoHash']
            .filter((k) => s[k] !== undefined)
            .map((k) => `${k}=${s[k]}`);
        console.log(`     ${extra.join('  ')}`);
    });
}
