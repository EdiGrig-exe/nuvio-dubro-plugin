const TMDB_BASE = 'https://api.themoviedb.org/3';
const ANIMATION_GENRE_ID = 16;

// Un singur request: titlul englez (din care se fac de obicei numele release-urilor), titlul
// original, traducerea ro-RO, external_ids pentru IMDb și genurile.
// `fetch` blochează în aplicație, deci fiecare request economisit contează.
export async function getMeta(http, apiKey, tmdbId, mediaType) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE}/${type}/${encodeURIComponent(tmdbId)}` +
        `?api_key=${encodeURIComponent(apiKey)}&language=en-US&append_to_response=external_ids,translations`;

    const { ok, status, data } = await http.json(url);
    if (!ok || !data) {
        throw new Error(`TMDB ${type}/${tmdbId} a răspuns cu ${status}`);
    }
    return parseMeta(data, type);
}

export function parseMeta(data, type) {
    const isTv = type === 'tv';
    const title = (isTv ? data.name : data.title) || '';
    const originalTitle = (isTv ? data.original_name : data.original_title) || title;
    const date = (isTv ? data.first_air_date : data.release_date) || '';
    const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
    const imdbId = (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || null;
    const genreIds = (data.genres || []).map((g) => g.id);

    return {
        type,
        title,
        originalTitle,
        titleRo: romanianTitle(data, isTv) || title,
        year,
        imdbId,
        isAnimation: genreIds.indexOf(ANIMATION_GENRE_ID) !== -1,
    };
}

function romanianTitle(data, isTv) {
    const list = (data.translations && data.translations.translations) || [];
    const ro = list.find((t) => t.iso_639_1 === 'ro' && t.iso_3166_1 === 'RO') ||
        list.find((t) => t.iso_639_1 === 'ro');
    if (!ro || !ro.data) return '';
    return (isTv ? ro.data.name : ro.data.title) || '';
}
