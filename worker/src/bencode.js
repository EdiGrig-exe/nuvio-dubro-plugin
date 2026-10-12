// Calculează info-hash-ul (SHA-1 al dicționarului „info") dintr-un fișier .torrent.
// Nu decodează tot fișierul: doar sare peste valori până găsește cheia „info".

const D = 0x64; // d
const L = 0x6c; // l
const I = 0x69; // i
const E = 0x65; // e
const COLON = 0x3a;

function readLength(bytes, pos) {
    let n = 0;
    while (bytes[pos] !== COLON) {
        const digit = bytes[pos] - 0x30;
        if (digit < 0 || digit > 9) throw new Error('bencode invalid: lungime');
        n = n * 10 + digit;
        pos++;
    }
    return { length: n, start: pos + 1 };
}

// Returnează poziția de după valoarea care începe la `pos`.
function skipValue(bytes, pos) {
    const c = bytes[pos];
    if (c === I) {
        const end = bytes.indexOf(E, pos);
        if (end === -1) throw new Error('bencode invalid: întreg');
        return end + 1;
    }
    if (c === L || c === D) {
        pos++;
        while (bytes[pos] !== E) {
            if (pos >= bytes.length) throw new Error('bencode invalid: listă/dicționar neterminat');
            pos = skipValue(bytes, pos);
        }
        return pos + 1;
    }
    const { length, start } = readLength(bytes, pos);
    return start + length;
}

export function infoSlice(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes[0] !== D) throw new Error('fișierul nu e un .torrent valid');
    let pos = 1;
    while (pos < bytes.length && bytes[pos] !== E) {
        const { length, start } = readLength(bytes, pos);
        const key = String.fromCharCode.apply(null, bytes.subarray(start, start + length));
        const valueStart = start + length;
        const valueEnd = skipValue(bytes, valueStart);
        if (key === 'info') return bytes.subarray(valueStart, valueEnd);
        pos = valueEnd;
    }
    throw new Error('fișierul .torrent nu are dicționar „info"');
}

export async function infoHash(buffer) {
    const digest = await crypto.subtle.digest('SHA-1', infoSlice(buffer));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
