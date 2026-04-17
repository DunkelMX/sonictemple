// =============================================================
// SonicTemple Planner — js/stages.js
// Stage Breakdown page: picks grouped by stage, sorted by total picks.
// Depends on: data.js, utils.js
// =============================================================

function renderStages() {
  const attending  = getAttending();
  const container  = document.getElementById('stagesContainer');

  // Build annotated band list
  const bands = SCHEDULE.map(b => ({
    entry:       b,
    idx:         SCHEDULE.indexOf(b),
    activePicks: b.picks.filter(id => attending.includes(id)),
  })).filter(b => b.activePicks.length > 0);

  if (bands.length === 0) {
    container.innerHTML = '<div class="empty-state">No picks yet for the attending group.</div>';
    return;
  }

  // Group by stage
  const byStage = {};
  STAGES.forEach(s => { byStage[s.id] = []; });
  bands.forEach(b => { if (byStage[b.entry.stage]) byStage[b.entry.stage].push(b); });

  // Total picks per stage, sort stages desc
  const stageOrder = STAGES
    .map(s => ({ stage: s, total: byStage[s.id].reduce((sum, b) => sum + b.activePicks.length, 0) }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total);

  let html = '';

  stageOrder.forEach(({ stage, total }) => {
    const stageBands = byStage[stage.id];

    // Group by day in DAYS order, sorted by start time within each day
    html += `<div class="stage-section">
      <div class="stage-section-heading">
        <span class="stage-section-dot" style="background:${stage.color}"></span>
        ${escHtml(stage.name)}
        <span class="stage-section-total">${total} pick${total !== 1 ? 's' : ''}</span>
      </div>`;

    DAYS.forEach(day => {
      const dayBands = stageBands
        .filter(b => b.entry.day === day.id)
        .sort((a, b) => toMinutes(a.entry.start) - toMinutes(b.entry.start));

      if (dayBands.length === 0) return;

      html += `<div class="stage-day-group">
        <div class="stage-day-label">${day.label}</div>`;

      dayBands.forEach(b => {
        const chips = chipHtml(b.entry, attending);
        html += `
          <div class="stage-band-row pick-card" data-idx="${b.idx}" role="button" tabindex="0" aria-label="${b.entry.band}">
            <div class="pick-card-stage-bar" style="background:${stage.color}"></div>
            <div class="stage-band-time">${formatTimeRange(b.entry.start, b.entry.end)}</div>
            <div class="stage-band-name">${escHtml(b.entry.band)}</div>
            <div class="pick-card-friends">${chips}</div>
          </div>`;
      });

      html += `</div>`;
    });

    html += `</div>`;
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
    () => renderStages()
  );

  document.addEventListener('click', e => {
    const sel = document.getElementById('attendingSelector');
    if (sel && !sel.contains(e.target)) sel.open = false;
  });

  renderStages();
});
