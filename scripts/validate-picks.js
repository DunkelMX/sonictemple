#!/usr/bin/env node
// =============================================================
// SonicTemple Planner — scripts/validate-picks.js
//
// Compares the live Picks tab in Google Sheet against js/data.js.
// Reports any missing or phantom picks per band/friend.
//
// Exit code 0 = clean, 1 = mismatches found.
//
// Env vars:
//   SHEET_ID  — Google Sheet ID (required)
//   GID_PICKS — Sheet gid for Picks tab (default: 1)
//
// Usage:
//   SHEET_ID=your_sheet_id GID_PICKS=139743283 node scripts/validate-picks.js
// =============================================================

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const vm    = require('vm');

const SHEET_ID  = process.env.SHEET_ID  || '';
const GID_PICKS = process.env.GID_PICKS || '1';
const DATA_PATH = path.join(__dirname, '..', 'js', 'data.js');

// ── Entry point ───────────────────────────────────────────────

async function main() {
  if (!SHEET_ID) {
    console.error('[validate] SHEET_ID not set — aborting');
    process.exit(1);
  }

  console.log(`[validate] Fetching Picks tab (gid=${GID_PICKS})...`);
  const picksCsv = await fetchCsv(SHEET_ID, GID_PICKS);
  const { picks: sheetPicks, friends } = parsePicksCsv(picksCsv);

  console.log(`[validate] ${friends.length} friends: ${friends.map(f => f.name).join(', ')}`);

  const schedule = loadSchedule();
  const scheduleByKey = {};
  for (const entry of schedule) {
    scheduleByKey[makeKey(entry.band, entry.day, entry.stage)] = entry;
  }

  const errors   = [];
  const warnings = [];
  let   checked  = 0;

  // Check every band that has picks in the sheet
  for (const [key, sheetPickList] of Object.entries(sheetPicks)) {
    const entry = scheduleByKey[key];
    if (!entry) {
      warnings.push(`  NOT IN SCHEDULE: ${key}`);
      continue;
    }

    const sheetSet = new Set(sheetPickList);
    const dataSet  = new Set(entry.picks);

    const missing = [...sheetSet].filter(id => !dataSet.has(id));
    const phantom = [...dataSet].filter(id => !sheetSet.has(id));

    if (missing.length || phantom.length) {
      errors.push(`  MISMATCH  ${key}`
        + (missing.length ? `\n    missing in data.js : [${missing.join(', ')}]` : '')
        + (phantom.length ? `\n    phantom in data.js : [${phantom.join(', ')}]` : ''));
    }
    checked++;
  }

  // Check data.js bands with picks that have NO corresponding sheet entry
  for (const entry of schedule) {
    if (entry.picks.length === 0) continue;
    const key = makeKey(entry.band, entry.day, entry.stage);
    if (!sheetPicks[key]) {
      errors.push(`  PHANTOM   ${key} — picks in data.js [${entry.picks.join(', ')}] but not in sheet`);
    }
  }

  // Report
  console.log(`\n[validate] Checked ${checked} bands with picks\n`);

  if (warnings.length) {
    console.log(`WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(w));
    console.log('');
  }

  if (errors.length === 0) {
    console.log(`OK — all picks match between sheet and data.js`);
    process.exit(0);
  } else {
    console.log(`FAILED — ${errors.length} mismatch(es) found:`);
    errors.forEach(e => console.log(e));
    process.exit(1);
  }
}

// ── Load SCHEDULE from data.js ────────────────────────────────

function loadSchedule() {
  const src = fs.readFileSync(DATA_PATH, 'utf8')
    .replace(/\bconst\b/g, 'var');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.SCHEDULE;
}

// ── CSV fetch ─────────────────────────────────────────────────

function fetchCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'sonictemple-planner/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        https.get(res.headers.location, { headers: { 'User-Agent': 'sonictemple-planner/1.0' } },
          res2 => collectBody(res2, resolve, reject));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} fetching gid=${gid}`)); return; }
      collectBody(res, resolve, reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function collectBody(res, resolve, reject) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
  res.on('error', reject);
}

// ── CSV parser ────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    rows.push(parseCsvRow(line));
  }
  return rows;
}

function parseCsvRow(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  fields.push(cur.trim());
  return fields;
}

// ── Picks tab parser ──────────────────────────────────────────

function parsePicksCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { picks: {}, friends: [] };

  const header  = rows[0];
  const friends = [];
  for (let fi = 0; fi < header.length - 5; fi++) {
    const name = (header[5 + fi] || '').trim();
    if (!name || /^Friend\d+$/i.test(name)) continue;
    friends.push({ id: slugify(name), name });
  }

  // Build a column-index → friend mapping (preserves original column position)
  const colFriend = [];
  for (let fi = 0; fi < header.length - 5; fi++) {
    const name = (header[5 + fi] || '').trim();
    if (!name || /^Friend\d+$/i.test(name)) { colFriend.push(null); continue; }
    colFriend.push(slugify(name));
  }

  const picks = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const [band, day, stage] = row;
    if (!band) continue;

    const key    = makeKey(band.trim(), normalizeDayId(day.trim()), normalizeStageId(stage.trim()));
    const picked = [];

    for (let fi = 0; fi < colFriend.length; fi++) {
      if (!colFriend[fi]) continue;
      const val = (row[5 + fi] || '').trim();
      if (val === '✅' || val.toLowerCase() === 'x' || val === '1' || val.toLowerCase() === 'yes') {
        picked.push(colFriend[fi]);
      }
    }

    if (picked.length > 0) picks[key] = picked;
  }

  return { picks, friends };
}

// ── Helpers ───────────────────────────────────────────────────

function makeKey(band, day, stage) {
  return `${band.toLowerCase()}|${day}|${stage}`;
}

function normalizeDayId(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes('thu') || lower.includes('may 14')) return 'thursday';
  if (lower.includes('fri') || lower.includes('may 15')) return 'friday';
  if (lower.includes('sat') || lower.includes('may 16')) return 'saturday';
  if (lower.includes('sun') || lower.includes('may 17')) return 'sunday';
  return lower.replace(/\s+/g, '');
}

function normalizeStageId(raw) {
  return raw.toLowerCase().replace(/\s+/g, '');
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// ── Run ───────────────────────────────────────────────────────

main().catch(err => {
  console.error('[validate] Error:', err.message);
  process.exit(1);
});
