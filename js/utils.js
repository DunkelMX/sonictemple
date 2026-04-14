// =============================================================
// SonicTemple Planner — js/utils.js
// Shared helpers: time, localStorage, band detail popover.
// Loaded on all pages. Depends on data.js being loaded first.
// =============================================================

// ── Time helpers ─────────────────────────────────────────────

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'p' : 'a';
  const h12   = h % 12 || 12;
  return m === 0
    ? `${h12}${period}`
    : `${h12}:${m.toString().padStart(2, '0')}${period}`;
}

// "21:20" + "22:50" → "9:20–10:50p"
function formatTimeRange(start, end) {
  const [hs, ms] = start.split(':').map(Number);
  const [he, me] = end.split(':').map(Number);
  const hs12 = hs % 12 || 12;
  const he12 = he % 12 || 12;
  const period = he >= 12 ? 'p' : 'a';
  const sStr = ms === 0 ? `${hs12}` : `${hs12}:${ms.toString().padStart(2,'0')}`;
  const eStr = me === 0 ? `${he12}` : `${he12}:${me.toString().padStart(2,'0')}`;
  return `${sStr}–${eStr}${period}`;
}

function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── localStorage helpers ──────────────────────────────────────

const LS_ME        = 'sonictemple_me';
const LS_ATTENDING = 'sonictemple_attending';

function getMe() {
  return localStorage.getItem(LS_ME) || null;
}

function setMe(friendId) {
  if (friendId) localStorage.setItem(LS_ME, friendId);
  else          localStorage.removeItem(LS_ME);
}

function getAttending() {
  try {
    const stored = localStorage.getItem(LS_ATTENDING);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) { /* ignore */ }
  return FRIENDS.map(f => f.id); // default: all friends
}

function setAttending(ids) {
  localStorage.setItem(LS_ATTENDING, JSON.stringify(ids));
}

// ── Attending selector widget ─────────────────────────────────
// Renders into a <details> with class="attending-selector".
// Call once per page after DOM is ready.

function initAttendingSelector(detailsEl, onChangeCallback) {
  if (!detailsEl) return;
  const attending = getAttending();

  const checkboxes = detailsEl.querySelectorAll('input[type="checkbox"][data-friend]');
  checkboxes.forEach(cb => {
    cb.checked = attending.includes(cb.dataset.friend);
    cb.addEventListener('change', () => {
      const checked = Array.from(checkboxes)
        .filter(c => c.checked)
        .map(c => c.dataset.friend);
      // Never allow zero attending friends
      if (checked.length === 0) { cb.checked = true; return; }
      setAttending(checked);
      updateAttendingSummary(detailsEl, checked.length);
      if (onChangeCallback) onChangeCallback(checked);
    });
  });

  updateAttendingSummary(detailsEl, attending.length);
}

function updateAttendingSummary(detailsEl, count) {
  const summary = detailsEl.querySelector('summary');
  if (summary) {
    summary.textContent = count === FRIENDS.length
      ? `Attending: all ${count}`
      : `Attending: ${count} of ${FRIENDS.length}`;
  }
}

// ── Footer sync info ──────────────────────────────────────────

function renderSyncInfo() {
  const el = document.getElementById('syncInfo');
  if (!el) return;
  const rel  = relativeTime(GENERATED_AT);
  const src  = SHEET_SOURCE === 'hardcoded'
    ? 'hardcoded fallback (Google Sheet not configured)'
    : `Google Sheet`;
  el.textContent = `Schedule last synced: ${rel} · Source: ${src}`;
}

// ── Band detail popover ───────────────────────────────────────

function openPopover(bandEntry) {
  const backdrop = document.getElementById('popoverBackdrop');
  const popover  = document.getElementById('popover');
  if (!backdrop || !popover) return;

  const stage    = STAGES.find(s => s.id === bandEntry.stage);
  const dayObj   = DAYS.find(d => d.id  === bandEntry.day);
  const attending = getAttending();

  // Friends who picked this band, filtered to attending
  const pickers = bandEntry.picks.filter(id => attending.includes(id));

  // Find conflicts: other bands on same day, overlapping time, picked by any attending friend
  const startMin = toMinutes(bandEntry.start);
  const endMin   = toMinutes(bandEntry.end);

  const conflicts = SCHEDULE.filter(b => {
    if (b === bandEntry) return false;
    if (b.day !== bandEntry.day) return false;
    const bStart = toMinutes(b.start);
    const bEnd   = toMinutes(b.end);
    const overlaps = Math.max(startMin, bStart) < Math.min(endMin, bEnd);
    if (!overlaps) return false;
    return b.picks.some(id => attending.includes(id));
  });

  // Build HTML
  const friendChips = FRIENDS
    .filter(f => attending.includes(f.id))
    .map(f => {
      const picked = bandEntry.picks.includes(f.id);
      const initials = f.name.replace(/[^A-Z0-9]/gi,'').slice(0,2).toUpperCase() || f.id.slice(-1).toUpperCase();
      return `
        <div class="popover-friend-chip ${picked ? '' : 'inactive'}">
          <span class="dot" style="background:${f.color}"></span>
          ${f.name}
        </div>`;
    }).join('');

  const conflictItems = conflicts.map(c => {
    const cStage = STAGES.find(s => s.id === c.stage);
    const cPickers = c.picks.filter(id => attending.includes(id))
      .map(id => FRIENDS.find(f => f.id === id)?.name || id)
      .join(', ');
    return `
      <div class="popover-conflict-item">
        <span class="stage-dot" style="background:${cStage?.color || '#666'}"></span>
        <span>${c.band}</span>
        <span class="friends-who">(${cStage?.name || c.stage} · ${cPickers})</span>
      </div>`;
  }).join('');

  popover.innerHTML = `
    <div class="popover-top">
      <span class="popover-stage-tag" style="background:${stage?.color || '#333'}">${stage?.name || bandEntry.stage}</span>
      <button class="popover-close" onclick="closePopover()" aria-label="Close">✕</button>
    </div>
    <div class="popover-band-name">${bandEntry.band}</div>
    <div class="popover-time">${formatTimeRange(bandEntry.start, bandEntry.end)} · ${dayObj?.label || bandEntry.day}</div>

    <div class="popover-section">
      <div class="popover-section-label">Wants to see this</div>
      <div class="popover-friends">
        ${attending.length ? friendChips : '<span style="color:var(--text-muted);font-size:0.8rem">No one picked this yet</span>'}
      </div>
    </div>

    ${conflicts.length ? `
    <div class="popover-section">
      <div class="popover-section-label">Conflicts with (attending picks)</div>
      <div class="popover-conflicts">${conflictItems}</div>
    </div>` : ''}
  `;

  backdrop.classList.remove('hidden');
  popover.classList.remove('hidden');
}

function closePopover() {
  document.getElementById('popoverBackdrop')?.classList.add('hidden');
  document.getElementById('popover')?.classList.add('hidden');
}

// Close on backdrop click or Escape key
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('popoverBackdrop')
    ?.addEventListener('click', closePopover);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePopover();
  });
  renderSyncInfo();
});
