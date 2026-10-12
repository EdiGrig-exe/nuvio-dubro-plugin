// Documentație: https://api-docs.torbox.app (colecția Postman oficială)
export const TORBOX_BASE = 'https://api.torbox.app/v1/api';

// GET checkcached acceptă ~100 de hash-uri per request (limita lungimii URL-ului).
const CHECK_BATCH = 100;

// Erori createtorrent după care nu are rost să căutăm torrentul în cont.
const TERMINAL_ERRORS = ['DOWNLOAD_NOT_CACHED', 'BAD_TOKEN', 'NO_AUTH', 'AUTH_ERROR'];

function describe(status, data) {
    if (!data) return `HTTP ${status}`;
    return [`HTTP ${status}`, data.error, data.detail].filter(Boolean).join(' · ');
}

// Runtime-ul aplicației nu are FormData, iar body-ul de fetch e un string.
function multipart(boundary, fields) {
    return Object.keys(fields)
        .map((key) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${fields[key]}\r\n`)
        .join('') + `--${boundary}--\r\n`;
}

function sameFile(a, b) {
    if (a.name && b.name && a.name === b.name) return true;
    if (a.short_name && b.short_name && a.short_name === b.short_name) {
        return !a.size || !b.size || Number(a.size) === Number(b.size);
    }
    return false;
}

export function createTorbox(http, apiKey) {
    const auth = { Authorization: `Bearer ${apiKey}` };
    let accountList = null;

    // Map<hash lowercase, { name, size, files }>, doar cu torrentele aflate deja în cache.
    async function checkCached(hashes) {
        const cached = new Map();
        for (let i = 0; i < hashes.length; i += CHECK_BATCH) {
            const chunk = hashes.slice(i, i + CHECK_BATCH);
            const url = `${TORBOX_BASE}/torrents/checkcached?hash=${chunk.join(',')}&format=object&list_files=true`;
            const { ok, status, data } = await http.json(url, { headers: auth });
            if (!ok || !data || !data.success) throw new Error(`checkcached: ${describe(status, data)}`);

            const payload = data.data || {};
            const items = Array.isArray(payload)
                ? payload
                : Object.keys(payload).map((key) => Object.assign({ hash: key }, payload[key]));
            for (const item of items) {
                const hash = item && String(item.hash || '').toLowerCase();
                if (hash) cached.set(hash, { name: item.name, size: item.size, files: item.files || [] });
            }
        }
        return cached;
    }

    // POST multipart. add_only_if_cached garantează că nu pornim descărcări noi.
    async function createTorrent(magnet) {
        const boundary = `----RoDub${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
        const { status, data } = await http.json(`${TORBOX_BASE}/torrents/createtorrent`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }, auth),
            body: multipart(boundary, { magnet, add_only_if_cached: 'true', allow_zip: 'false' }),
        });
        const id = data && data.success && data.data ? (data.data.torrent_id ?? data.data.id) : null;
        if (id !== null && id !== undefined) return { id };
        return { id: null, code: data && data.error, message: describe(status, data) };
    }

    async function getTorrent(torrentId) {
        const url = `${TORBOX_BASE}/torrents/mylist?id=${encodeURIComponent(torrentId)}&bypass_cache=true`;
        const { ok, status, data } = await http.json(url, { headers: auth });
        if (!ok || !data || !data.success) throw new Error(`mylist id=${torrentId}: ${describe(status, data)}`);
        return Array.isArray(data.data) ? data.data[0] || null : data.data;
    }

    // Lista contului se citește o singură dată per apel getStreams, doar dacă e nevoie.
    async function findByHash(hash) {
        if (!accountList) {
            const { ok, status, data } = await http.json(`${TORBOX_BASE}/torrents/mylist?bypass_cache=true`, { headers: auth });
            if (!ok || !data) throw new Error(`mylist: ${describe(status, data)}`);
            accountList = Array.isArray(data.data) ? data.data : [];
        }
        return accountList.find((t) => String(t.hash || '').toLowerCase() === hash) || null;
    }

    // Adaugă torrentul (sau îl găsește dacă e deja în cont) și returnează torrent_id.
    async function ensureTorrent(hash, magnet) {
        const created = await createTorrent(magnet);
        if (created.id !== null) return created.id;
        if (TERMINAL_ERRORS.indexOf(created.code) === -1) {
            const existing = await findByHash(hash);
            if (existing) return existing.id;
        }
        throw new Error(`createtorrent: ${created.message}`);
    }

    // Id-urile de fișier din checkcached nu sunt garantat aceleași cu cele din cont,
    // așa că le luăm din mylist; checkcached rămâne doar fallback.
    async function resolveFileId(torrentId, cachedFile) {
        const torrent = await getTorrent(torrentId);
        const files = (torrent && torrent.files) || [];
        const match = files.find((f) => sameFile(f, cachedFile));
        if (match) return match.id;
        if (files.length === 0 && cachedFile.id !== undefined) return cachedFile.id;
        throw new Error(`fișierul „${cachedFile.short_name || cachedFile.name}" nu apare în torrentul ${torrentId}`);
    }

    // Permalink recomandat de TorBox: redirecționează spre CDN la redare, link-ul nu expiră.
    function streamUrl(torrentId, fileId) {
        return `${TORBOX_BASE}/torrents/requestdl?token=${encodeURIComponent(apiKey)}` +
            `&torrent_id=${encodeURIComponent(torrentId)}&file_id=${encodeURIComponent(fileId)}&redirect=true`;
    }

    return { checkCached, ensureTorrent, resolveFileId, streamUrl };
}
