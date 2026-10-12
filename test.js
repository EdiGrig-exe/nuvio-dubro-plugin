#!/usr/bin/env node
/**
 * Rulează dist/rodub.js în Node 18+ pe câteva titluri cunoscute și afișează stream-urile.
 * Cheile și URL-ul sursei vin din .env și sunt date plugin-ului la rulare ca SCRAPER_SETTINGS,
 * exact ca în aplicație. Bundle-ul nu le conține. Rulează întâi `npm run build`
 * (sau direct `npm run dev-test`).
 *
 *   node test.js                         film + serial S01E01 + desen animat
 *   node test.js 603 movie               un singur titlu
 *   node test.js 82728 tv 1 3            un episod
 *   node test.js --sandbox [...]         în context fără timere, ca în aplicație
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadProvider, printStreams } from './tools/harness.js';
import { settingsFromEnv } from './tools/env.js';

const CASES = [
    { label: 'Film: Home Alone (1990)', tmdbId: '771', type: 'movie' },
    { label: 'Serial: Stranger Things S01E01', tmdbId: '66732', type: 'tv', season: 1, episode: 1 },
    { label: 'Desen animat: Frozen (2013)', tmdbId: '109445', type: 'movie' },
];

const BUNDLE = new URL('./dist/rodub.js', import.meta.url);

async function main() {
    const args = process.argv.slice(2);
    const sandbox = args.includes('--sandbox');
    const positional = args.filter((a) => !a.startsWith('--'));

    if (!existsSync(BUNDLE)) {
        console.error('❌ dist/rodub.js nu există. Rulează `npm run build`.');
        process.exit(1);
    }
    const settings = settingsFromEnv(new URL('./.env', import.meta.url));
    const missing = [['TORBOX_API_KEY', settings.torboxApiKey], ['TMDB_API_KEY', settings.tmdbApiKey], ['SOURCE_URL', settings.sourceUrl]]
        .filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) console.log(`⚠️  Lipsesc din .env: ${missing.join(', ')}\n`);

    const provider = loadProvider(readFileSync(BUNDLE, 'utf8'), { sandbox, settings });
    if (typeof provider.getStreams !== 'function') {
        console.error('❌ bundle-ul nu exportă getStreams');
        process.exit(1);
    }

    const cases = positional.length > 0
        ? [{
            label: `TMDB ${positional[0]}`,
            tmdbId: positional[0],
            type: positional[1] || 'movie',
            season: positional[2] ? Number(positional[2]) : undefined,
            episode: positional[3] ? Number(positional[3]) : undefined,
        }]
        : CASES;

    console.log(`Mod: ${sandbox ? 'sandbox (fără timere, fetch ca în Nuvio)' : 'Node'}\n`);
    for (const c of cases) {
        const ep = c.type === 'tv' ? ` S${c.season}E${c.episode}` : '';
        console.log(`━━━ ${c.label}  [${c.type} ${c.tmdbId}${ep}]`);
        const started = Date.now();
        let streams;
        try {
            streams = await provider.getStreams(c.tmdbId, c.type, c.season, c.episode);
        } catch (error) {
            console.log(`  ✗ getStreams a aruncat excepție (nu ar trebui): ${error.message}`);
            process.exitCode = 1;
            continue;
        }
        console.log(`  ⏱  ${Date.now() - started} ms, ${streams.length} stream-uri`);
        printStreams(streams);
        console.log('');
    }
}

main();
