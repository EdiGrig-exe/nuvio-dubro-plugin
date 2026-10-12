import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isRomanianDub,
    parseQuality,
    formatSize,
    compareStreams,
    matchesEpisode,
    classifyRelease,
    pickFile,
} from '../src/rodub/filters.js';

const DUBBED = [
    'Frozen.2013.1080p.BluRay.x264.Dublat.RO',
    'Toy Story 4 (2019) Dublat in Romana 1080p',
    'Kung Fu Panda 2008 1080p Dublat în Română',
    'Shrek.2001.RoDub.720p.WEB-DL',
    'Cars.2006.1080p.WEB-DL.RO.Audio.x264',
    'Moana.2016.Audio.RO.1080p.BluRay',
    'Coco.2017.ROMANIAN.DUB.1080p.WEB-DL',
    'Encanto.2021.1080p.WEB-DL.ROMANIAN.x264-GRP',
    'Minions.2015.Romanian.Dubbed.720p.BluRay',
    'Bluey.S01E03.Dublat.Romana.1080p.WEB',
    'Paw.Patrol.S02.Dublat.In.Romana.720p',
    'The Lion King 1994 [Dublat RO] 1080p',
    'Inside.Out.2015.1080p.BluRay.Dual.Audio.EN.RO',
    'Up.2009.MULTi.Audio(EN,RO,HU).1080p.BluRay',
    'Zootopia.2016.1080p.Audio.Romana.x265',
    'Madagascar.2005.RO-DUB.1080p.WEB-DL',
    'Ratatouille.2007.1080p.RoAudio.BluRay',
    'Tom si Jerry - Desene Animate Dublate in Romana',
    'Despicable.Me.2010.1080p.BluRay.DUBLAT.ROMANA.AC3',
    'Spirited.Away.2001.1080p.BluRay.ROMANIAN.DUBBED.x264',
];

const NOT_DUBBED = [
    'Ronin.1998.1080p.BluRay.x264',
    'RoboCop.1987.2160p.UHD.BluRay.x265',
    'The.Rum.Diary.2011.1080p.BluRay.DTS.x264',
    'Roma.2018.1080p.NF.WEB-DL.DDP5.1.x264',
    'Mr.Robot.S01E01.1080p.WEB-DL',
    'Romancing.the.Stone.1984.1080p.BluRay',
    'Frozen.2013.1080p.BluRay.x264.RoSub',
    'Frozen.2013.1080p.Subtitrat.In.Romana',
    'Kingdom.2019.1080p.WEB.Romanian.Subtitles',
    'Movie.2019.1080p.WEB-DL.MULTi.Subs.incl.Romanian',
    'Film.2020.1080p.Turkce.Dublaj.WEB-DL',
    'Home.Alone.1990.1080p.BluRay.x264-RO',
    'Spirited.Away.2001.1080p.BluRay.Dual.Audio.ENG.JAP',
    'Amelie.2001.FRENCH.1080p.BluRay.x264',
    'Interstellar.2014.EN.Audio.RO.Sub.1080p',
    'Pro.Evolution.Soccer.2019.Documentary.1080p',
];

test('isRomanianDub: recunoaște variantele de dublaj românesc', () => {
    for (const name of DUBBED) assert.equal(isRomanianDub(name), true, name);
});

test('isRomanianDub: respinge release-uri fără dublaj RO (inclusiv „RO" izolat)', () => {
    for (const name of NOT_DUBBED) assert.equal(isRomanianDub(name), false, name);
});

test('setul de teste are cel puțin 20 de nume realiste', () => {
    assert.ok(DUBBED.length + NOT_DUBBED.length >= 20);
});

test('parseQuality', () => {
    assert.equal(parseQuality('Frozen.2013.2160p.UHD.BluRay'), '2160p');
    assert.equal(parseQuality('Frozen.2013.4K.HDR.Dublat'), '2160p');
    assert.equal(parseQuality('Frozen.2013.UHD.BluRay.1080p'), '1080p');
    assert.equal(parseQuality('Frozen.2013.1080i.HDTV'), '1080p');
    assert.equal(parseQuality('Frozen.2013.720p.WEB'), '720p');
    assert.equal(parseQuality('Frozen.2013.576p.DVDRip'), '480p');
    assert.equal(parseQuality('Frozen.2013.DVDRip.Dublat'), 'SD');
});

test('formatSize', () => {
    assert.equal(formatSize(4.2 * 1024 ** 3), '4.20 GB');
    assert.equal(formatSize(700 * 1024 ** 2), '700 MB');
    assert.equal(formatSize(0), '');
});

test('compareStreams: calitate descrescătoare, apoi mărime descrescătoare', () => {
    const list = [
        { quality: '720p', size: 9e9 },
        { quality: '1080p', size: 2e9 },
        { quality: '2160p', size: 1e9 },
        { quality: '1080p', size: 5e9 },
        { quality: 'SD', size: 1e10 },
    ];
    list.sort(compareStreams);
    assert.deepEqual(list.map((s) => `${s.quality}/${s.size}`), [
        '2160p/1000000000', '1080p/5000000000', '1080p/2000000000', '720p/9000000000', 'SD/10000000000',
    ]);
});

test('matchesEpisode: formate SxxEyy, 1x03, intervale', () => {
    assert.ok(matchesEpisode('Bluey.S01E03.Dublat', 1, 3));
    assert.ok(matchesEpisode('Bluey S1E3 Dublat', 1, 3));
    assert.ok(matchesEpisode('Bluey.S01.E03.1080p', 1, 3));
    assert.ok(matchesEpisode('Bluey 1x03 Dublat', 1, 3));
    assert.ok(matchesEpisode('Bluey.S01E01-E05.Dublat', 1, 3));
    assert.ok(matchesEpisode('Bluey.S01E02E03.Dublat', 1, 3));
    assert.ok(!matchesEpisode('Bluey.S01E13.Dublat', 1, 3));
    assert.ok(!matchesEpisode('Bluey.S02E03.Dublat', 1, 3));
    assert.ok(!matchesEpisode('Bluey.S01E01-1080p.Dublat', 1, 3));
    assert.ok(!matchesEpisode('Movie.1920x1080.Dublat', 19, 20));
});

test('classifyRelease: episod exact, pachete de sezon, alte episoade', () => {
    assert.equal(classifyRelease('Bluey.S01E03.1080p.Dublat', 1, 3), 'episode');
    assert.equal(classifyRelease('Bluey.1x03.Dublat', 1, 3), 'episode');
    assert.equal(classifyRelease('Bluey.S01.1080p.WEB-DL.Dublat', 1, 3), 'pack');
    assert.equal(classifyRelease('Bluey Season 1 Dublat Romana', 1, 3), 'pack');
    assert.equal(classifyRelease('Bluey Sezonul 1 Dublat', 1, 3), 'pack');
    assert.equal(classifyRelease('Bluey.S01-S03.1080p.Dublat', 2, 3), 'pack');
    assert.equal(classifyRelease('Bluey Complete Series Dublat', 2, 3), 'pack');
    assert.equal(classifyRelease('Bluey.Dublat.Romana.1080p', 1, 3), 'unknown');
    assert.equal(classifyRelease('Bluey.S01E05.Dublat', 1, 3), null);
    assert.equal(classifyRelease('Bluey.S02.Dublat', 1, 3), null);
});

const f = (id, name, size) => ({ id, name, short_name: name.split('/').pop(), size });

test('pickFile: film → cel mai mare video, fără sample', () => {
    const files = [
        f(0, 'Frozen/Frozen.2013.1080p.mkv', 8e9),
        f(1, 'Frozen/Sample/sample.mkv', 9e9),
        f(2, 'Frozen/Frozen.nfo', 1e3),
        f(3, 'Frozen/Extras/Making.Of.mp4', 1e9),
    ];
    assert.equal(pickFile(files, { type: 'movie' }).id, 0);
});

test('pickFile: pachet de sezon → fișierul SxxEyy', () => {
    const files = [
        f(10, 'Bluey.S01/Bluey.S01E01.1080p.mkv', 3e8),
        f(11, 'Bluey.S01/Bluey.S01E03.1080p.mkv', 3e8),
        f(12, 'Bluey.S01/Bluey.S01E13.1080p.mkv', 4e8),
    ];
    assert.equal(pickFile(files, { type: 'tv', season: 1, episode: 3, releaseKind: 'pack' }).id, 11);
});

test('pickFile: „Episode 3" în folderul sezonului corect', () => {
    const files = [
        f(20, 'Bluey/Season 1/Episode 3.mp4', 3e8),
        f(21, 'Bluey/Season 2/Episode 3.mp4', 3e8),
        f(22, 'Bluey/Season 1/Episode 13.mp4', 3e8),
    ];
    assert.equal(pickFile(files, { type: 'tv', season: 1, episode: 3, releaseKind: 'pack' }).id, 20);
    assert.equal(pickFile(files, { type: 'tv', season: 2, episode: 3, releaseKind: 'pack' }).id, 21);
});

test('pickFile: potriviri ambigue sau lipsă → null', () => {
    const multiSeason = [f(30, 'Show/Episode 3.mkv', 1), f(31, 'Show/Extra/Episode 3.mkv', 1)];
    assert.equal(pickFile(multiSeason, { type: 'tv', season: 1, episode: 3, releaseKind: 'pack' }), null);
    const otherEpisodes = [f(40, 'Show.S01E01.mkv', 1), f(41, 'Show.S01E02.mkv', 1)];
    assert.equal(pickFile(otherEpisodes, { type: 'tv', season: 1, episode: 3, releaseKind: 'pack' }), null);
    assert.equal(pickFile([f(50, 'readme.txt', 1)], { type: 'movie' }), null);
});

test('pickFile: release de episod cu un singur video fără marcaje', () => {
    const files = [f(60, 'Bluey.S01E03/video.mkv', 3e8), f(61, 'Bluey.S01E03/info.nfo', 1)];
    assert.equal(pickFile(files, { type: 'tv', season: 1, episode: 3, releaseKind: 'episode' }).id, 60);
});
