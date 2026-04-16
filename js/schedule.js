// =============================================================
// SonicTemple Planner — js/schedule.js
// Vertical timeline grid for the Schedule page.
// Depends on: data.js, utils.js
// =============================================================

const PX_PER_MIN = 2.2;

// ── State ─────────────────────────────────────────────────────

const LS_DAY = 'sonictemple_day';

function getActiveDay() {
  const stored = localStorage.getItem(LS_DAY);
  if (stored && DAYS.find(d => d.id === stored)) return stored;
  // Default to the first day that has data
  const today = new Date().toISOString().slice(0, 10);
  const todayDay = DAYS.find(d => d.date === today);
  if (todayDay) return todayDay.id;
  return 'sunday';
}

function setActiveDay(dayId) {
  localStorage.setItem(LS_DAY, dayId);
}

// ── Render ────────────────────────────────────────────────────

function renderSchedule(dayId) {
  const container = document.getElementById('scheduleContainer');
  const dayBands  = SCHEDULE.filter(b => b.day === dayId);

  if (dayBands.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:60px 0">
      Schedule not yet announced for this day.
    </div>`;
    return;
  }

  // Time range
  const allMin   = dayBands.flatMap(b => [toMinutes(b.start), toMinutes(b.end)]);
  const rawStart = Math.min(...allMin);
  const rawEnd   = Math.max(...allMin);
  const dayStart = Math.floor((rawStart - 15) / 30) * 30;
  const dayEnd   = Math.ceil ((rawEnd   + 15) / 30) * 30;
  const totalH   = (dayEnd - dayStart) * PX_PER_MIN;

  const attending = getAttending();

  // Stage header — outside the scroll wrapper so sticky works vs the page, not the wrapper
  let html = `<div class="timeline-header" aria-hidden="true">`;
  html += `<div class="time-gutter"></div>`;
  STAGES.forEach(st => {
    html += `<div class="stage-header" style="border-bottom-color:${st.color}">${st.name}</div>`;
  });
  html += `</div>`;

  html += `<div class="timeline-wrapper">`;

  // Body
  html += `<div class="timeline-body">`;

  // Time axis
  html += `<div class="time-axis" style="height:${totalH}px" aria-hidden="true">`;
  for (let t = dayStart; t <= dayEnd; t += 30) {
    const top = (t - dayStart) * PX_PER_MIN;
    html += `<span class="time-label" style="top:${top}px">${formatTime(minutesToHHMM(t))}</span>`;
  }
  html += `</div>`;

  // Stage columns
  STAGES.forEach(st => {
    const stageBands = dayBands.filter(b => b.stage === st.id);
    html += `<div class="stage-col" style="height:${totalH}px">`;

    stageBands.forEach((band, _) => {
      const idx      = SCHEDULE.indexOf(band);
      const top      = (toMinutes(band.start) - dayStart) * PX_PER_MIN;
      const height   = Math.max((toMinutes(band.end) - toMinutes(band.start)) * PX_PER_MIN, 26);
      const activePickers = band.picks.filter(id => attending.includes(id));
      const hasPicks = activePickers.length > 0;

      const dots = activePickers.map(id => {
        const f = FRIENDS.find(f => f.id === id);
        return f ? `<span class="friend-dot" style="background:${f.color}" title="${f.name}"></span>` : '';
      }).join('');

      html += `
        <div class="band-card${hasPicks ? ' has-picks' : ''}"
             style="top:${top}px; height:${height}px; border-left-color:${st.color}"
             data-idx="${idx}"
             role="button"
             tabindex="0"
             aria-label="${band.band}, ${formatTimeRange(band.start, band.end)}">
          <div class="band-name">${escHtml(band.band)}</div>
          ${height > 34 ? `<div class="band-time-label">${formatTimeRange(band.start, band.end)}</div>` : ''}
          ${hasPicks ? `<div class="friend-dots">${dots}</div>` : ''}
        </div>`;
    });

    html += `</div>`;
  });

  html += `</div>`; // timeline-body
  html += `</div>`; // timeline-wrapper

  container.innerHTML = html;

  // Sync stage header horizontal scroll with the timeline wrapper
  const wrapper = container.querySelector('.timeline-wrapper');
  const header  = container.querySelector('.timeline-header');
  if (wrapper && header) {
    wrapper.addEventListener('scroll', () => {
      header.scrollLeft = wrapper.scrollLeft;
    }, { passive: true });
  }

  // Attach click / keyboard handlers
  container.querySelectorAll('.band-card').forEach(card => {
    const handler = () => {
      const idx = parseInt(card.dataset.idx, 10);
      openPopover(SCHEDULE[idx]);
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
  });
}

// ── Utilities ─────────────────────────────────────────────────

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tabs    = document.querySelectorAll('.day-tab');
  let activeDay = getActiveDay();

  function activateTab(dayId) {
    activeDay = dayId;
    setActiveDay(dayId);
    tabs.forEach(t => t.classList.toggle('active', t.dataset.day === dayId));
    renderSchedule(dayId);
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.day));
  });

  activateTab(activeDay);
});
