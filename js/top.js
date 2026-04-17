// =============================================================
// SonicTemple Planner — js/top.js
// Top Picks page: Hall of Fame + ranked bands by day.
// Depends on: data.js, utils.js
// =============================================================

// ── Render ────────────────────────────────────────────────────

function renderTop() {
  const attending = getAttending();
  const container = document.getElementById('topContainer');

  // Annotate every band with activePicks count
  const bands = SCHEDULE
    .map(b => ({ entry: b, idx: SCHEDULE.indexOf(b), activePicks: b.picks.filter(id => attending.includes(id)) }))
    .filter(b => b.activePicks.length > 0);

  if (bands.length === 0) {
    container.innerHTML = '<div class="empty-state">No picks yet for the attending group.</div>';
    return;
  }

  let html = '';

  // ── Hall of Fame ──────────────────────────────────────────
  const sorted = [...bands].sort((a, b) =>
    b.activePicks.length - a.activePicks.length || a.entry.band.localeCompare(b.entry.band)
  );

  // Include all entries tied at 3rd place
  const threshold = sorted.length >= 3 ? sorted[2].activePicks.length : 0;
  const hofBands  = sorted.filter((b, i) => i < 3 || b.activePicks.length >= threshold).slice(0, 6);

  const medals = ['#1', '#2', '#3'];
  const medalClass = ['gold', 'silver', 'bronze'];

  html += `<div class="hof-section">
    <div class="hof-heading">Hall of Fame</div>
    <div class="hof-grid">`;

  hofBands.forEach((b, i) => {
    const stage = STAGES.find(s => s.id === b.entry.stage);
    const day   = DAYS.find(d => d.id === b.entry.day);
    const chips = chipHtml(b.entry, attending);
    const medalLabel = medals[i] || `#${i + 1}`;
    const cls = medalClass[i] || '';

    html += `
      <div class="hof-card pick-card" data-idx="${b.idx}" role="button" tabindex="0" aria-label="${b.entry.band}">
        <div class="pick-card-stage-bar" style="background:${stage?.color || '#555'}"></div>
        <div class="hof-card-top">
          <span class="rank-medal ${cls}">${medalLabel}</span>
          <span class="pick-count-badge">${b.activePicks.length}/${attending.length}</span>
        </div>
        <div class="pick-card-name">${escHtml(b.entry.band)}</div>
        <div class="pick-card-meta">${day?.label || b.entry.day} · ${stage?.name || b.entry.stage} · ${formatTimeRange(b.entry.start, b.entry.end)}</div>
        <div class="pick-card-friends">${chips}</div>
      </div>`;
  });

  html += `</div></div>`;

  // ── Per-day sections ──────────────────────────────────────
  DAYS.forEach(day => {
    const dayBands = bands
      .filter(b => b.entry.day === day.id)
      .sort((a, b) => b.activePicks.length - a.activePicks.length || a.entry.band.localeCompare(b.entry.band));

    if (dayBands.length === 0) return;

    html += `<div class="day-section">
      <div class="day-section-heading">${day.label}</div>
      <div class="picks-grid">`;

    dayBands.forEach((b, i) => {
      const stage = STAGES.find(s => s.id === b.entry.stage);
      const chips = chipHtml(b.entry, attending);

      html += `
        <div class="pick-card" data-idx="${b.idx}" role="button" tabindex="0" aria-label="${b.entry.band}">
          <div class="pick-card-stage-bar" style="background:${stage?.color || '#555'}"></div>
          <div class="top-rank-row">
            <span class="rank-number">#${i + 1}</span>
            <span class="pick-count-badge">${b.activePicks.length}/${attending.length}</span>
          </div>
          <div class="pick-card-name">${escHtml(b.entry.band)}</div>
          <div class="pick-card-meta">${stage?.name || b.entry.stage} · ${formatTimeRange(b.entry.start, b.entry.end)}</div>
          <div class="pick-card-friends">${chips}</div>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.pick-card').forEach(card => {
    const handler = () => openPopover(SCHEDULE[parseInt(card.dataset.idx, 10)]);
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

// ── Helpers ───────────────────────────────────────────────────

function chipHtml(band, attending) {
  return FRIENDS
    .filter(f => attending.includes(f.id))
    .map(f => {
      const picked   = band.picks.includes(f.id);
      const initials = friendInitials(f);
      return `<span class="friend-chip${picked ? '' : ' inactive'}"
                    style="background:${picked ? f.color : ''}"
                    title="${f.name}">${initials}</span>`;
    }).join('');
}

function friendInitials(f) {
  const match = f.name.match(/^([A-Za-z]+)(\d+)$/);
  if (match) return match[1][0].toUpperCase() + match[2];
  return f.name.slice(0, 2).toUpperCase();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildAttendingCheckboxes() {
  const container = document.getElementById('attendingCheckboxes');
  if (!container) return;
  const attending = getAttending();
  container.innerHTML = FRIENDS.map(f => `
    <label>
      <input type="checkbox" data-friend="${f.id}" ${attending.includes(f.id) ? 'checked' : ''}>
      <span class="friend-chip" style="background:${f.color};width:20px;height:20px;font-size:0.55rem">
        ${friendInitials(f)}
      </span>
      ${escHtml(f.name)}
    </label>`).join('');
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildAttendingCheckboxes();
  initAttendingSelector(
    document.getElementById('attendingSelector'),
    () => renderTop()
  );

  document.addEventListener('click', e => {
    const sel = document.getElementById('attendingSelector');
    if (sel && !sel.contains(e.target)) sel.open = false;
  });

  renderTop();
});
