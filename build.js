#!/usr/bin/env node
/**
 * Build RoDub:
 *   src/rodub/index.js  →  dist/rodub.js      (un singur fișier, ES2016, CommonJS)
 *   src/rodub/meta.json →  dist/manifest.json (filename = URL-ul public al lui rodub.js)
 *
 * Bundle-ul NU conține chei: build-ul nu citește .env. Cheile și URL-ul sursei se
 * configurează în aplicație (SCRAPER_SETTINGS). Configurația esbuild urmează build.js din
 * tapframe/nuvio-providers (vezi NOTES.md).
 */
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(ROOT, 'src', 'rodub', 'index.js');
const META = join(ROOT, 'src', 'rodub', 'meta.json');
export const DIST = join(ROOT, 'dist');

export function readMeta() {
    return JSON.parse(readFileSync(META, 'utf8'));
}

export async function bundle(meta = readMeta()) {
    const result = await esbuild.build({
        entryPoints: [ENTRY],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'neutral',
        target: 'es2016', // async/await → generatoare (Hermes); inofensiv în QuickJS
        minify: false,
        sourcemap: false,
        banner: {
            js: `/**\n * ${meta.scraper.name} v${meta.scraper.version} - generat din src/rodub/\n` +
                ' * Cheile se configurează în Nuvio: Settings → Plugins → RoDub.\n */',
        },
        logLevel: 'warning',
        // index.js folosește `module.exports` ca template-ul oficial; în bundle CJS e corect.
        logOverride: { 'commonjs-variable-in-esm': 'silent' },
    });
    const code = result.outputFiles[0].text;
    checkRuntimeCompat(code);
    return code;
}

// Verifică ce nu există în runtime-ul Nuvio (vezi NOTES.md, secțiunea 4).
function checkRuntimeCompat(code) {
    const problems = [];
    if (/\bprocess\.(env|argv|exit)\b/.test(code)) problems.push('referință la `process` rămasă în bundle');
    if (/\brequire\(/.test(code)) problems.push('`require(...)` în bundle (modulele nu există în aplicație)');
    if (/\basync\s+function\b|\bawait\s/.test(code)) problems.push('async/await netranspilat');
    if (/\bnew\s+FormData\b/.test(code)) problems.push('FormData nu există în aplicație');
    if (/(?<!typeof )\bsetTimeout\(/.test(code) && !/typeof setTimeout === "function"/.test(code)) {
        problems.push('setTimeout folosit fără verificare `typeof`');
    }
    if (problems.length > 0) throw new Error(`bundle incompatibil cu Nuvio:\n  - ${problems.join('\n  - ')}`);
}

export function buildManifest(meta = readMeta()) {
    const base = String(meta.publicBaseUrl || '').replace(/\/+$/, '');
    const filename = base ? `${base}/${meta.scraper.filename}` : meta.scraper.filename;
    return Object.assign({}, meta.repository, {
        scrapers: [Object.assign({}, meta.scraper, { filename })],
    });
}

export async function build() {
    const meta = readMeta();
    const code = await bundle(meta);
    const manifest = buildManifest(meta);

    mkdirSync(DIST, { recursive: true });
    writeFileSync(join(DIST, meta.scraper.filename), code);
    writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    console.log(`✅ dist/${meta.scraper.filename} (${(code.length / 1024).toFixed(1)} KB)`);
    console.log(`✅ dist/manifest.json → ${manifest.scrapers[0].filename}`);
    return { code, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    build().catch((error) => {
        console.error(`❌ Build eșuat: ${error.message}`);
        process.exit(1);
    });
}
