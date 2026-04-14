#!/usr/bin/env node
// =============================================================
// SonicTemple Planner — scripts/sync-sheet.js
//
// Fetches Schedule + Picks tabs from a public Google Sheet,
// merges them, and regenerates js/data.js.
//
// No npm dependencies — uses only Node.js built-ins.
//
// Env vars:
//   SHEET_ID     — Google Sheet ID (required; exits 0 if missing)
//   GID_SCHEDULE — Sheet gid for Schedule tab (default: 0)
//   GID_PICKS    — Sheet gid for Picks tab    (default: 1)
//
// Usage:
//   SHEET_ID=your_sheet_id node scripts/sync-sheet.js
// =============================================================

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────

const SHEET_ID     = process.env.SHEET_ID    || '';
const GID_SCHEDULE = process.env.GID_SCHEDULE || '0';
const GID_PICKS    = process.env.GID_PICKS    || '1';
const OUT_PATH     = path.join(__dirname, '..', 'js', 'data.js');

// Friend columns in Picks tab (columns F onwards, 0-indexed col 5+)
const FRIEND_IDS = ['friend1','friend2','friend3','friend4','friend5','friend6','friend7'];

// ── Entry point ───────────────────────────────────────────────

async function main() {
  if (!SHEET_ID) {
    console.log('[sync-sheet] SHEET_ID not set — skipping sync, keeping existing data.js');
    process.exit(0);
  }

  console.log(`[sync-sheet] Fetching from Sheet ID: ${SHEET_ID}`);

  const [scheduleCsv, picksCsv] = await Promise.all([
    fetchCsv(SHEET_ID, GID_SCHEDULE),
    fetchCsv(SHEET_ID, GID_PICKS),
  ]);

  const schedule = parseScheduleCsv(scheduleCsv);
  const picks    = parsePicksCsv(picksCsv);

  // Merge picks into schedule entries
  // Key: "band|day|stage" (lowercase, normalized)
  schedule.forEach(entry => {
    const key = makeKey(entry.band, entry.day, entry.stage);
    entry.picks = picks[key] || [];
  });

  const pickedCount = schedule.filter(e => e.picks.length > 0).length;
  console.log(`[sync-sheet] ${schedule.length} bands, ${pickedCount} with at least one pick`);

  writeDataJs(schedule);
  console.log(`[sync-sheet] Written to ${OUT_PATH}`);
}

// ── CSV fetch ─────────────────────────────────────────────────

function fetchCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'sonictemple-planner/1.0' },
    }, res => {
      // Follow redirect (Google Sheets export redirects once)
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        https.get(res.headers.location, {
          headers: { 'User-Agent': 'sonictemple-planner/1.0' },
        }, res2 => collectBody(res2, resolve, reject));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching gid=${gid}`));
        return;
      }
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

// ── CSV parser (no deps, handles quoted fields) ───────────────

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
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim());
  return fields;
}

// ── Schedule tab parser ───────────────────────────────────────
// Expected columns: Day | Stage | Band | Start | End

function parseScheduleCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  // Skip header row
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const [day, stage, band, start, end] = rows[i];
    if (!band || !day || !stage || !start || !end) continue;

    const startH = normalizeTime(start);
    const endH   = normalizeTime(end);
    if (!startH || !endH) {
      console.warn(`[sync-sheet] Skipping row ${i+1}: invalid time "${start}" / "${end}"`);
      continue;
    }

    entries.push({
      band:  band.trim(),
      day:   normalizeDayId(day.trim()),
      stage: normalizeStageId(stage.trim()),
      start: startH,
      end:   endH,
      picks: [],
    });
  }
  return entries;
}

// ── Picks tab parser ──────────────────────────────────────────
// Expected columns: Band | Day | Stage | Start | End | Friend1..Friend7

function parsePicksCsv(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return {};

  const picks = {}; // key → [friendId, ...]
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const [band, day, stage] = row;
    if (!band) continue;

    const key = makeKey(band.trim(), normalizeDayId(day.trim()), normalizeStageId(stage.trim()));
    const picked = [];

    for (let fi = 0; fi < FRIEND_IDS.length; fi++) {
      const val = (row[5 + fi] || '').trim();
      if (val === '✅' || val.toLowerCase() === 'x' || val === '1' || val.toLowerCase() === 'yes') {
        picked.push(FRIEND_IDS[fi]);
      }
    }

    if (picked.length > 0) picks[key] = picked;
  }
  return picks;
}

// ── Time normalizer ───────────────────────────────────────────
// Accepts: "9:20p", "21:20", "9:20 PM", "9:20pm"
// Returns: "HH:MM" (24h) or null

function normalizeTime(raw) {
  raw = raw.trim().toLowerCase();

  // Already 24h "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':').map(Number);
    if (h > 23 || m > 59) return null;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
  }

  // 12h with am/pm suffix: "9:20p", "9:20pm", "9:20 pm"
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(a|p|am|pm)$/);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const period = match[3][0];
    if (period === 'p' && h !== 12) h += 12;
    if (period === 'a' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
  }

  return null;
}

// ── ID normalizers ────────────────────────────────────────────

function normalizeDayId(raw) {
  const lower = raw.toLowerCase();
  if (lower.includes('thu') || lower.includes('may 14') || lower === 'thursday') return 'thursday';
  if (lower.includes('fri') || lower.includes('may 15') || lower === 'friday')   return 'friday';
  if (lower.includes('sat') || lower.includes('may 16') || lower === 'saturday') return 'saturday';
  if (lower.includes('sun') || lower.includes('may 17') || lower === 'sunday')   return 'sunday';
  return lower.replace(/\s+/g, '');
}

function normalizeStageId(raw) {
  return raw.toLowerCase().replace(/\s+/g, '');
}

function makeKey(band, day, stage) {
  return `${band.toLowerCase()}|${day}|${stage}`;
}

// ── Write data.js ─────────────────────────────────────────────

function writeDataJs(schedule) {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const now      = new Date().toISOString();

  const scheduleJson = schedule.map(e => {
    const picksJson = JSON.stringify(e.picks);
    return `  { band: ${JSON.stringify(e.band)}, day: ${JSON.stringify(e.day)}, stage: ${JSON.stringify(e.stage)}, start: ${JSON.stringify(e.start)}, end: ${JSON.stringify(e.end)}, picks: ${picksJson} },`;
  }).join('\n');

  const content = `// =============================================================
// SonicTemple Planner — js/data.js
// AUTO-GENERATED by scripts/sync-sheet.js
// Last synced: ${now}
// =============================================================

const GENERATED_AT = ${JSON.stringify(now)};
const SHEET_SOURCE  = ${JSON.stringify(sheetUrl)};

const FRIENDS = [
  { id: 'friend1', name: 'DK',   color: '#e74c3c' },
  { id: 'friend2', name: 'MG',   color: '#3498db' },
  { id: 'friend3', name: 'Abel', color: '#2ecc71' },
  { id: 'friend4', name: 'Friend4', color: '#f39c12' },
  { id: 'friend5', name: 'Friend5', color: '#9b59b6' },
  { id: 'friend6', name: 'Friend6', color: '#1abc9c' },
  { id: 'friend7', name: 'Friend7', color: '#e91e63' },
];

const STAGES = [
  { id: 'temple',    name: 'Temple',    color: '#cc0000' },
  { id: 'cathedral', name: 'Cathedral', color: '#1a6b3c' },
  { id: 'citadel',   name: 'Citadel',   color: '#1a3a6b' },
  { id: 'sanctuary', name: 'Sanctuary', color: '#6b1a6b' },
  { id: 'altar',     name: 'Altar',     color: '#8b5e3c' },
];

const DAYS = [
  { id: 'thursday', label: 'Thu · May 14', date: '2026-05-14' },
  { id: 'friday',   label: 'Fri · May 15', date: '2026-05-15' },
  { id: 'saturday', label: 'Sat · May 16', date: '2026-05-16' },
  { id: 'sunday',   label: 'Sun · May 17', date: '2026-05-17' },
];

const SCHEDULE = [
${scheduleJson}
];
`;

  fs.writeFileSync(OUT_PATH, content, 'utf8');
}

// ── Run ───────────────────────────────────────────────────────

main().catch(err => {
  console.error('[sync-sheet] Error:', err.message);
  process.exit(1);
});
