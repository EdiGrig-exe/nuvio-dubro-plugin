#!/usr/bin/env node
// Scurtătură: rulează test.js în modul sandbox (fără timere, fetch ca în aplicația Nuvio).
process.argv.push('--sandbox');
await import('../test.js');
