// =============================================================
// SonicTemple Planner — js/report.js
// Conflict Report page: horizontal timeline per friend.
// Annotates meet / split / free-window moments.
// Depends on: data.js, utils.js
// =============================================================

const LABEL_W   = 110;  // px — friend label column width
const ROW_H     = 52;   // px — height of each friend row
const PX_PER_MIN_REPORT = 3.5;
const FREE_THRESHOLD = 15; // minutes — minimum gap to show as "free window"

// ── State ─────────────────────────────────────────────────────

let activeDay = 'sunday';

// ── Main render ───────────────────────────────────────────────

function renderReport(dayId) {
  const container = document.getElementById('reportContainer');
  const attending = getAttending();

  // Bands that any attending friend has picked for this day
  const dayPicks = SCHEDULE.filter(b =>
    b.day === dayId && b.picks.some(id => attending.includes(id))
  );

  if (dayPicks.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:50px 16px">
      No picks for this day yet.<br>
      Add picks in your Google Sheet, then sync — or select more friends above.
    </div>`;
    return;
  }

  // Time range for this day (all bands, not just picked ones — for axis alignment)
  const allDayBands = SCHEDULE.filter(b => b.day === dayId);
  const allMin  = allDayBands.flatMap(b => [toMinutes(b.start), toMinutes(b.end)]);
  const rawStart = Math.min(...allMin);
  const rawEnd   = Math.max(...allMin);
  const dayStart = Math.floor((rawStart - 10) / 30) * 30;
  const dayEnd   = Math.ceil ((rawEnd   + 10) / 30) * 30;

  const trackW   = (dayEnd - dayStart) * PX_PER_MIN_REPORT;
  const totalW   = LABEL_W + trackW;

  // Per-friend pick lists
  const friendPicks = attending.map(fId => ({
    friend: FRIENDS.find(f => f.id === fId),
    picks:  dayPicks
      .filter(b => b.picks.includes(fId))
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
  })).filter(fp => fp.friend);

  // Compute annotations
  const { meets, splits, freeWindows } = computeAnnotations(friendPicks, dayStart, dayEnd, attending);

  // ── Build HTML ─────────────────────────────────────────────

  let html = `<div class="report-scroll">
    <div class="report-inner" style="min-width:${totalW + 20}px">`;

  // Time ruler
  html += `<div class="report-ruler" style="padding-left:${LABEL_W}px; position:sticky; top:calc(var(--nav-h) + var(--tabs-h) + 52px)">`;
  for (let t = dayStart; t <= dayEnd; t += 30) {
    const left = (t - dayStart) * PX_PER_MIN_REPORT;
    html += `<span class="ruler-label" style="left:${left}px">${formatTime(minutesToHHMM(t))}</span>`;
    html += `<span class="ruler-tick"  style="left:${left}px"></span>`;
  }
  html += `</div>`;

  // Tracks area
  html += `<div class="report-tracks-outer" style="position:relative">`;

  // Annotation layer
  html += `<div class="report-annotations" style="left:${LABEL_W}px; width:${trackW}px; top:0; bottom:0; position:absolute; pointer-events:none; z-index:5">`;

  freeWindows.forEach(fw => {
    const left  = (fw.start - dayStart) * PX_PER_MIN_REPORT;
    const width = (fw.end   - fw.start) * PX_PER_MIN_REPORT;
    html += `<div class="free-window" style="left:${left}px; width:${width}px">
      <span class="free-window-label">free</span>
    </div>`;
  });

  splits.forEach(sp => {
    const left = (sp.time - dayStart) * PX_PER_MIN_REPORT;
    html += `<div class="split-marker" style="left:${left}px" title="Split: ${sp.detail}"></div>`;
  });

  html += `</div>`; // annotation layer

  // Friend rows
  friendPicks.forEach(({ friend, picks: fPicks }) => {
    html += `<div class="report-friend-row">
      <div class="report-friend-label" style="width:${LABEL_W}px">
        <div class="report-friend-avatar" style="background:${friend.color}">
          ${friendInitialsReport(friend)}
        </div>
        <span>${escHtml(friend.name)}</span>
      </div>
      <div class="report-friend-track" style="height:${ROW_H}px">`;

    if (fPicks.length === 0) {
      html += `<span class="report-no-picks">No picks</span>`;
    }

    fPicks.forEach(band => {
      const idx    = SCHEDULE.indexOf(band);
      const stage  = STAGES.find(s => s.id === band.stage);
      const left   = (toMinutes(band.start) - dayStart) * PX_PER_MIN_REPORT;
      const width  = Math.max((toMinutes(band.end) - toMinutes(band.start)) * PX_PER_MIN_REPORT, 4);
      const isMeet = meets.some(m => m.band === band);
      const color  = stage?.color || '#555';

      html += `
        <div class="report-band-block${isMeet ? ' is-meet' : ''}"
             style="left:${left}px; width:${width}px; background:${color}"
             data-idx="${idx}"
             role="button" tabindex="0"
             title="${band.band} · ${formatTimeRange(band.start, band.end)}">
          <span>${escHtml(band.band)}</span>
        </div>`;
    });

    html += `</div></div>`; // track + row
  });

  html += `</div>`; // tracks-outer
  html += `</div></div>`; // inner + scroll

  container.innerHTML = html;

  // Click handlers on band blocks
  container.querySelectorAll('.report-band-block').forEach(block => {
    const handler = () => {
      const idx = parseInt(block.dataset.idx, 10);
      openPopover(SCHEDULE[idx]);
    };
    block.addEventListener('click', handler);
    block.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

// ── Conflict algorithm ────────────────────────────────────────

function computeAnnotations(friendPicks, dayStart, dayEnd, attending) {
  // Collect all time breakpoints
  const allPicks = friendPicks.flatMap(fp => fp.picks);
  const breakpoints = [...new Set(
    allPicks.flatMap(b => [toMinutes(b.start), toMinutes(b.end)])
  )].sort((a, b) => a - b);

  const meets       = [];
  const splitTimes  = new Set();
  const splitDetail = {};
  const busyIntervals = []; // [{start, end}] — times when any friend is busy

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const t1 = breakpoints[i];
    const t2 = breakpoints[i + 1];
    const mid = (t1 + t2) / 2;

    // Which friends are active at mid?
    const active = friendPicks.map(fp => {
      const band = fp.picks.find(b =>
        toMinutes(b.start) <= mid && toMinutes(b.end) > mid
      );
      return band ? { friend: fp.friend, band, stage: band.stage } : null;
    }).filter(Boolean);

    if (active.length === 0) continue;

    busyIntervals.push({ start: t1, end: t2 });

    // Meets: 2+ friends at same band (same band object)
    const bandCounts = {};
    active.forEach(a => {
      const key = SCHEDULE.indexOf(a.band);
      bandCounts[key] = bandCounts[key] || { band: a.band, friends: [] };
      bandCounts[key].friends.push(a.friend);
    });
    Object.values(bandCounts).forEach(entry => {
      if (entry.friends.length >= 2 && !meets.find(m => m.band === entry.band)) {
        meets.push({ band: entry.band, friends: entry.friends });
      }
    });

    // Splits: 2+ friends active at different stages
    const stages = [...new Set(active.map(a => a.stage))];
    if (stages.length >= 2) {
      splitTimes.add(t1);
      splitDetail[t1] = active
        .map(a => `${a.friend.name}@${a.stage}`)
        .join(', ');
    }
  }

  const splits = Array.from(splitTimes).map(time => ({
    time,
    detail: splitDetail[time] || '',
  }));

  // Free windows: merge busyIntervals, find gaps ≥ FREE_THRESHOLD
  const merged = mergeIntervals(busyIntervals);
  const freeWindows = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i].end;
    const gapEnd   = merged[i + 1].start;
    if (gapEnd - gapStart >= FREE_THRESHOLD) {
      freeWindows.push({ start: gapStart, end: gapEnd });
    }
  }

  return { meets, splits, freeWindows };
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

// ── Helpers ───────────────────────────────────────────────────

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function friendInitialsReport(f) {
  const match = f.name.match(/^([A-Za-z]+)(\d+)$/);
  if (match) return match[1][0].toUpperCase() + match[2];
  return f.name.slice(0, 2).toUpperCase();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Attending selector ────────────────────────────────────────

function buildAttendingCheckboxes() {
  const container = document.getElementById('attendingCheckboxes');
  if (!container) return;
  const attending = getAttending();
  container.innerHTML = FRIENDS.map(f => `
    <label>
      <input type="checkbox" data-friend="${f.id}" ${attending.includes(f.id) ? 'checked' : ''}>
      <span class="friend-chip" style="background:${f.color};width:20px;height:20px;font-size:0.55rem">
        ${friendInitialsReport(f)}
      </span>
      ${escHtml(f.name)}
    </label>`).join('');
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('#dayTabs .day-tab');

  function activateTab(dayId) {
    activeDay = dayId;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.day === dayId));
    renderReport(dayId);
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.day));
  });

  // Attending selector
  buildAttendingCheckboxes();
  initAttendingSelector(
    document.getElementById('attendingSelector'),
    () => renderReport(activeDay)
  );

  document.addEventListener('click', e => {
    const sel = document.getElementById('attendingSelector');
    if (sel && !sel.contains(e.target)) sel.open = false;
  });

  activateTab('sunday');
});
