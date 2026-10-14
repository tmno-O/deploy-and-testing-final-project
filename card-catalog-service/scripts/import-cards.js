#!/usr/bin/env node
// One-off seed generator: downloads Pokémon cards from the Pokémon TCG API and writes data/mock-data.json.
// The service itself never calls the external API at runtime.
//
// Usage: node scripts/import-cards.js [--sets sv3pt5,swsh7,base1] [--out data/mock-data.json] [--dry-run]
// Optional env: POKEMONTCG_API_KEY (higher rate limits; never printed or stored)
const fs = require('fs');
const path = require('path');
const { buildSeed } = require('./lib/seed');

const API_BASE = 'https://api.pokemontcg.io/v2';
const DEFAULT_SETS = ['sv3pt5', 'swsh7', 'base1'];
const SELECT = [
  'id', 'name', 'supertype', 'subtypes', 'types', 'hp', 'rarity', 'artist',
  'convertedRetreatCost', 'attacks', 'weaknesses', 'images', 'set',
].join(',');
const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 60000;
const SET_ID = /^[A-Za-z0-9._-]{1,40}$/;

function parseArgs(argv) {
  const args = { sets: DEFAULT_SETS, out: path.join(__dirname, '..', 'data', 'mock-data.json'), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--sets') args.sets = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--out') args.out = path.resolve(String(argv[++i] || ''));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.sets.length === 0 || !args.sets.every((id) => SET_ID.test(id))) {
    throw new Error('--sets must be a comma-separated list of set ids such as sv3pt5,swsh7');
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The API is unreliable (502/504/timeouts are common), so retry with exponential backoff.
async function fetchJson(url) {
  const headers = { Accept: 'application/json' };
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      console.warn(`  attempt ${attempt}/${MAX_ATTEMPTS}: HTTP ${res.status}`);
    } catch (err) {
      if (err.fatal) throw err;
      console.warn(`  attempt ${attempt}/${MAX_ATTEMPTS}: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(Math.min(2000 * 2 ** (attempt - 1), 30000));
  }
  throw new Error(`Giving up on ${new URL(url).pathname} after ${MAX_ATTEMPTS} attempts`);
}

async function fetchSetCards(setId) {
  const cards = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${API_BASE}/cards`);
    url.searchParams.set('q', `set.id:${setId} supertype:Pokemon`);
    url.searchParams.set('select', SELECT);
    url.searchParams.set('pageSize', '250');
    url.searchParams.set('page', String(page));
    const body = await fetchJson(url.toString());
    if (!Array.isArray(body.data)) throw new Error(`Unexpected response for set ${setId}`);
    cards.push(...body.data);
    if (cards.length >= body.totalCount || body.data.length === 0) break;
  }
  return cards;
}

// Write to a temp file then rename, so an interrupted run never leaves a corrupt data file.
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = [];
  for (const setId of args.sets) {
    console.log(`Fetching set ${setId} ...`);
    const cards = await fetchSetCards(setId);
    console.log(`  ${cards.length} Pokémon cards`);
    raw.push(...cards);
  }

  const { seed, report } = buildSeed(raw, args.sets);
  console.log(`Usable candidates: ${report.candidates} (skipped ${report.skipped})`);
  console.log(`Selected ${seed.cards.length} cards:`, report.counts);
  if (report.unknownRarities.length > 0) {
    console.warn('WARNING: unknown source rarities mapped to "common":', report.unknownRarities.join(', '));
  }
  const empty = Object.entries(report.counts).filter(([, n]) => n === 0).map(([tier]) => tier);
  if (empty.length > 0) {
    throw new Error(`No cards for tier(s): ${empty.join(', ')}. Add more sets with --sets.`);
  }

  if (args.dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }
  writeAtomic(args.out, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`Wrote ${args.out}`);
}

main().catch((err) => {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
});
