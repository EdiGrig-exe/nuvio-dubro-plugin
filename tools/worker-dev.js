#!/usr/bin/env node
/**
 * Rulează worker-ul FileList local, în Node, pe http://localhost:8787 — pentru teste înainte
 * de deploy. Secretele vin din .env (FILELIST_USERNAME, FILELIST_PASSKEY, WORKER_TOKEN);
 * KV-ul e înlocuit de un Map în memorie.
 *
 *   npm run worker:dev
 *   SOURCE_URL=http://localhost:8787/<WORKER_TOKEN> node test.js 109445 movie
 */
import { createServer } from 'node:http';
import worker from '../worker/src/index.js';
import { readEnvFile } from './env.js';

const PORT = Number(process.env.PORT) || 8787;
const fileEnv = readEnvFile(new URL('../.env', import.meta.url));

class MemoryKV {
    constructor() {
        this.map = new Map();
    }
    async get(key) {
        const entry = this.map.get(key);
        if (!entry) return null;
        if (entry.expires && entry.expires < Date.now()) {
            this.map.delete(key);
            return null;
        }
        return entry.value;
    }
    async put(key, value, options) {
        const ttl = options && options.expirationTtl;
        this.map.set(key, { value, expires: ttl ? Date.now() + ttl * 1000 : 0 });
    }
}

const env = {
    ACCESS_TOKEN: fileEnv.WORKER_TOKEN,
    FILELIST_USERNAME: fileEnv.FILELIST_USERNAME,
    FILELIST_PASSKEY: fileEnv.FILELIST_PASSKEY,
    TMDB_API_KEY: fileEnv.TMDB_API_KEY,
    CACHE: new MemoryKV(),
};

const missing = Object.entries({ WORKER_TOKEN: env.ACCESS_TOKEN, FILELIST_USERNAME: env.FILELIST_USERNAME, FILELIST_PASSKEY: env.FILELIST_PASSKEY })
    .filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
    console.error(`❌ Lipsesc din .env: ${missing.join(', ')}`);
    process.exit(1);
}

createServer(async (req, res) => {
    const started = Date.now();
    try {
        const response = await worker.fetch(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method }), env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        const path = req.url.replace(env.ACCESS_TOKEN, '<token>');
        console.log(`${req.method} ${path} → ${response.status} (${Date.now() - started} ms)`);
    } catch (e) {
        res.writeHead(500);
        res.end(String(e && e.message));
    }
}).listen(PORT, () => console.log(`Worker FileList local: http://localhost:${PORT}/<WORKER_TOKEN>/manifest.json`));
