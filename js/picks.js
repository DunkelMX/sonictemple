// =============================================================
// SonicTemple Planner — js/picks.js
// Group Picks page logic.
// Depends on: data.js, utils.js
// =============================================================

// ── State ─────────────────────────────────────────────────────

let activeDay    = 'all';
let activeFilter = 'atleast2';

// ── Render ────────────────────────────────────────────────────

function renderPicks() {
  const attending = getAttending();
  const me        = getMe();
  const results   = document.getElementById('picksResults');

  // Build list of bands that match filter
  let bands = SCHEDULE.filter(b => {
    // Day filter
    if (activeDay !== 'all' && b.day !== activeDay) return false;

    // Only attending-friend picks count
    const activePicks = b.picks.filter(id => attending.includes(id));

    switch (activeFilter) {
      case 'everyone':
        return activePicks.length === attending.length && attending.length > 0;
      case 'atleast2':
        return activePicks.length >= 2;
      case 'onlyme':
        if (!me || !attending.includes(me)) return false;
        return activePicks.includes(me) && activePicks.length === 1;
      default:
        return activePicks.length > 0;
    }
  });

  if (bands.length === 0) {
    const msg = activeFilter === 'onlyme' && !getMe()
      ? 'Select who you are (I am: above) to use the "Only me" filter.'
      : 'No bands match this filter.';
    results.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  // Group by day
  const grouped = {};
  DAYS.forEach(d => { grouped[d.id] = []; });
  bands.forEach(b => grouped[b.day].push(b));

  let html = '';

  DAYS.forEach(day => {
    const dayBands = grouped[day.id].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (dayBands.length === 0) return;

    html += `<div class="day-section">
      <div class="day-section-heading">${day.label}</div>
      <div class="picks-grid">`;

    dayBands.forEach(band => {
      const idx      = SCHEDULE.indexOf(band);
      const stage    = STAGES.find(s => s.id === band.stage);
      const attending = getAttending();
      const activePicks = band.picks.filter(id => attending.includes(id));

      // Friend chips — show all attending friends
      const chips = FRIENDS
        .filter(f => attending.includes(f.id))
        .map(f => {
          const picked   = band.picks.includes(f.id);
          const initials = friendInitials(f);
          return `<span class="friend-chip${picked ? '' : ' inactive'}"
                        style="background:${picked ? f.color : ''}"
                        title="${f.name}">${initials}</span>`;
        }).join('');

      html += `
        <div class="pick-card" data-idx="${idx}" role="button" tabindex="0"
             aria-label="${band.band}">
          <div class="pick-card-stage-bar" style="background:${stage?.color || '#555'}"></div>
          <div class="pick-card-name">${escHtml(band.band)}</div>
          <div class="pick-card-meta">${stage?.name || band.stage} · ${formatTimeRange(band.start, band.end)}</div>
          <div class="pick-card-friends">${chips}</div>
        </div>`;
    });

    html += `</div></div>`;
  });

  results.innerHTML = html;

  // Attach click handlers
  results.querySelectorAll('.pick-card').forEach(card => {
    const handler = () => {
      const idx = parseInt(card.dataset.idx, 10);
      openPopover(SCHEDULE[idx]);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

// ── Helpers ───────────────────────────────────────────────────

function friendInitials(f) {
  // "Friend1" → "F1"
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
        ${friendInitials(f)}
      </span>
      ${escHtml(f.name)}
    </label>`).join('');
}

// ── Me selector ───────────────────────────────────────────────

function buildMeSelector() {
  const sel = document.getElementById('meSelect');
  if (!sel) return;
  const me = getMe();
  FRIENDS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    if (f.id === me) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    setMe(sel.value || null);
    renderPicks();
  });
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Day tabs
  const dayTabs = document.querySelectorAll('#dayTabs .day-tab');
  dayTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeDay = tab.dataset.day;
      dayTabs.forEach(t => t.classList.toggle('active', t === tab));
      renderPicks();
    });
  });

  // Group filter
  const filterBtns = document.querySelectorAll('#groupFilter .filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      filterBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderPicks();
    });
  });

  // Me selector
  buildMeSelector();

  // Attending selector
  buildAttendingCheckboxes();
  initAttendingSelector(
    document.getElementById('attendingSelector'),
    () => renderPicks()
  );

  // Close attending dropdown when clicking outside
  document.addEventListener('click', e => {
    const sel = document.getElementById('attendingSelector');
    if (sel && !sel.contains(e.target)) sel.open = false;
  });

  // Initial render
  renderPicks();
});
