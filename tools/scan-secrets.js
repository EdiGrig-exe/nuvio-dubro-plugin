#!/usr/bin/env node
/**
 * Caută în fișierele date (sau în folderele date, recursiv) șiruri care seamănă cu chei API.
 * Iese cu cod 1 dacă găsește ceva — folosit în GitHub Actions înainte de publicare.
 *
 *   node tools/scan-secrets.js dist
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RULES = [
    {
        name: 'UUID (formatul cheilor TorBox)',
        re: /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi,
    },
    {
        name: '32 caractere hex (formatul cheilor TMDB v3)',
        re: /(?<![0-9a-z])[0-9a-f]{32}(?![0-9a-z])/gi,
    },
    {
        name: 'JWT (token TMDB v4 / Bearer)',
        re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    },
    {
        name: 'token GitHub',
        re: /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,
    },
    {
        name: 'valoare lungă lângă key/token/secret',
        re: /(?:api[_-]?key|apikey|token|secret|password|passwd|bearer|authorization)["']?\s*[:=]?\s*["']?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/gi,
    },
];

function mask(value) {
    return value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} caractere)`;
}

export function scanText(text) {
    const findings = [];
    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, index) => {
        for (const rule of RULES) {
            rule.re.lastIndex = 0;
            let m;
            while ((m = rule.re.exec(line)) !== null) {
                findings.push({ line: index + 1, rule: rule.name, match: mask(m[0]) });
            }
        }
    });
    return findings;
}

function listFiles(path) {
    if (statSync(path).isDirectory()) {
        return readdirSync(path).flatMap((name) => listFiles(join(path, name)));
    }
    return [path];
}

function main(paths) {
    if (paths.length === 0) {
        console.error('folosire: node tools/scan-secrets.js <fișier|folder>...');
        process.exit(2);
    }
    const files = paths.flatMap(listFiles);
    let total = 0;
    for (const file of files) {
        for (const f of scanText(readFileSync(file, 'utf8'))) {
            console.error(`❌ ${file}:${f.line}  ${f.rule}: ${f.match}`);
            total++;
        }
    }
    if (total > 0) {
        console.error(`\n${total} posibile secrete în ${files.length} fișiere. Publicarea e oprită.`);
        process.exit(1);
    }
    console.log(`✅ Niciun secret găsit în ${files.length} fișiere: ${files.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2));
}
