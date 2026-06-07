/**
 * 考勤打卡 v2
 */
document.addEventListener('DOMContentLoaded', function() {
  initAttendance();
  document.getElementById('att-save').addEventListener('click', saveAttendance);
  document.getElementById('att-add-slot').addEventListener('click', addSlot);
  document.getElementById('att-export-btn').addEventListener('click', exportExcel);
  document.getElementById('att-leave-btn').addEventListener('click', quickLeave);

  // Date change → reload
  document.getElementById('att-date-input').addEventListener('change', function() {
    document.getElementById('att-date-text').textContent = this.value;
    loadEntries();
  });

  // 30-min toggle
  document.getElementById('att-step-30').addEventListener('change', function() {
    applyStepToAll();
  });

  // Listen for time changes on all slots
  document.getElementById('att-slots').addEventListener('change', function(e) {
    var slot = e.target.closest('.att-slot');
    if (!slot) return;
    if (e.target.classList.contains('att-slot__start') || e.target.classList.contains('att-slot__end')) {
      if (e.target.classList.contains('att-slot__start')) autoEndTime(slot);
      enforceStep(e.target);
      updateSlotHours(slot);
    }
  });

  // Export date defaults
  var today = localDateStr();
  document.getElementById('att-export-from').value = today;
  var to = new Date(); to.setDate(to.getDate() + 30);
  document.getElementById('att-export-to').value = localDateStr(to);
});

// ── Init ──
function initAttendance() {
  var now = new Date();
  var today = localDateStr(now);
  document.getElementById('att-date-text').textContent = today;
  document.getElementById('att-date-input').value = today;

  resetToSingleSlot();
  loadEntries();
}

function resetToSingleSlot() {
  var slotsDiv = document.getElementById('att-slots');
  slotsDiv.innerHTML = '';

  var now = new Date();
  var r = roundTime(now.getHours(), now.getMinutes());
  var eh = r.h + 2, em = r.m;
  if (eh >= 24) eh -= 24;

  var div = document.createElement('div');
  div.className = 'att-slot';
  div.innerHTML =
    '<span class="att-slot__label">时段 1</span>' +
    '<input type="time" class="att-slot__start" value="' + fmtTime(r.h, r.m) + '">' +
    '<span class="att-slot__sep">至</span>' +
    '<input type="time" class="att-slot__end" value="' + fmtTime(eh, em) + '">' +
    '<span class="att-slot__hours">2h</span>' +
    '<button type="button" class="att-slot__remove" title="删除" style="display:none;">✕</button>';
  slotsDiv.appendChild(div);
  applyStepToAll();
}

// ── Time helpers ──
function roundTime(h, m) {
  var total = h * 60 + m;
  var rem = total % 30;
  if (rem <= 15) total -= rem;
  else total += (30 - rem);
  total = total % (24 * 60);
  return { h: Math.floor(total / 60), m: total % 60 };
}

function fmtTime(h, m) { return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }
function localDateStr(d) { d = d || new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function calcHours(s, e) {
  var sm = parseInt(s.split(':')[0])*60 + parseInt(s.split(':')[1]);
  var em = parseInt(e.split(':')[0])*60 + parseInt(e.split(':')[1]);
  if (em <= sm) em += 1440;
  return Math.round((em - sm) / 6) / 10;
}

// ── 30-min enforcement ──
function enforceStep(input) {
  if (!document.getElementById('att-step-30').checked) return;
  var parts = input.value.split(':');
  if (parts.length !== 2) return;
  var h = parseInt(parts[0]), m = parseInt(parts[1]);
  var r = roundTime(h, m);
  input.value = fmtTime(r.h, r.m);
}

function applyStepToAll() {
  document.querySelectorAll('.att-slot__start, .att-slot__end').forEach(function(el) {
    enforceStep(el);
  });
}

// ── Auto end = start + 2h (exact, no rounding) ──
function autoEndTime(slot) {
  var startVal = slot.querySelector('.att-slot__start').value;
  if (!startVal) return;
  var parts = startVal.split(':');
  var h = parseInt(parts[0]), m = parseInt(parts[1]);
  var total = h * 60 + m + 120;
  total = total % (24 * 60);
  var eh = Math.floor(total / 60), em = total % 60;
  slot.querySelector('.att-slot__end').value = fmtTime(eh, em);
}

// ── Slots ──
function addSlot() {
  var slotsDiv = document.getElementById('att-slots');
  var count = slotsDiv.querySelectorAll('.att-slot').length + 1;
  var div = document.createElement('div');
  div.className = 'att-slot';
  div.innerHTML =
    '<span class="att-slot__label">时段 ' + count + '</span>' +
    '<input type="time" class="att-slot__start" value="09:00">' +
    '<span class="att-slot__sep">至</span>' +
    '<input type="time" class="att-slot__end" value="11:00">' +
    '<span class="att-slot__hours">2h</span>' +
    '<button type="button" class="att-slot__remove" title="删除">✕</button>';
  slotsDiv.appendChild(div);

  div.querySelector('.att-slot__remove').addEventListener('click', function() {
    div.remove();
    renumberSlots();
  });

  applyStepToAll();
  updateSlotHours(div);

  // Show all remove buttons
  var allSlots = slotsDiv.querySelectorAll('.att-slot');
  if (allSlots.length > 1) {
    allSlots.forEach(function(s) { s.querySelector('.att-slot__remove').style.display = ''; });
  }
}

function renumberSlots() {
  var slots = document.querySelectorAll('.att-slot');
  if (slots.length <= 1) {
    slots.forEach(function(s) { s.querySelector('.att-slot__remove').style.display = 'none'; });
  }
  slots.forEach(function(s, i) { s.querySelector('.att-slot__label').textContent = '时段 ' + (i+1); });
}

function updateSlotHours(slot) {
  var start = slot.querySelector('.att-slot__start').value;
  var end = slot.querySelector('.att-slot__end').value;
  if (start && end) slot.querySelector('.att-slot__hours').textContent = calcHours(start, end) + 'h';
}

// ── Quick leave ──
function quickLeave() {
  document.getElementById('att-note').value = '请假';
  var slotsDiv = document.getElementById('att-slots');
  slotsDiv.innerHTML = '';
  var div = document.createElement('div');
  div.className = 'att-slot';
  div.innerHTML =
    '<span class="att-slot__label">时段 1</span>' +
    '<input type="time" class="att-slot__start" value="00:00">' +
    '<span class="att-slot__sep">至</span>' +
    '<input type="time" class="att-slot__end" value="00:00">' +
    '<span class="att-slot__hours">0h</span>' +
    '<button type="button" class="att-slot__remove" title="删除" style="display:none;">✕</button>';
  slotsDiv.appendChild(div);
  applyStepToAll();
}

// ── Save ──
async function saveAttendance() {
  var date = document.getElementById('att-date-input').value;
  var note = document.getElementById('att-note').value.trim();
  var slots = document.querySelectorAll('.att-slot');
  var saved = 0;

  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    var start = s.querySelector('.att-slot__start').value;
    var end = s.querySelector('.att-slot__end').value;
    if (!start || !end) continue;
    enforceStep(s.querySelector('.att-slot__start'));
    enforceStep(s.querySelector('.att-slot__end'));
    start = s.querySelector('.att-slot__start').value;
    end = s.querySelector('.att-slot__end').value;
    var hours = calcHours(start, end);

    try {
      await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_date: date, time_start: start, time_end: end, hours: hours, note: note }),
        cache: 'no-store'
      });
      saved++;
    } catch (err) { console.error(err); }
  }

  if (saved > 0) {
    if (typeof showToast === 'function') showToast('✅ 已保存 ' + saved + ' 条');
    document.getElementById('att-note').value = '';
    resetToSingleSlot();
    loadEntries();
  } else {
    if (typeof showToast === 'function') showToast('⚠️ 请填写时间');
  }
}

// ── Load ──
async function loadEntries() {
  var date = document.getElementById('att-date-input').value;
  try {
    var resp = await fetch('/api/attendance?from=' + date + '&to=' + date, { cache: 'no-store' });
    var data = await resp.json();
    renderDateGroup(date, data.entries || []);
  } catch (err) { console.error(err); }
  loadRecent();
}

async function loadRecent() {
  try {
    var resp = await fetch('/api/attendance?days=3', { cache: 'no-store' });
    var data = await resp.json();
    renderRecent(data.entries || []);
  } catch (err) { console.error(err); }
}

function renderDateGroup(date, entries) {
  // Today's entries are rendered inside loadRecent
}

function renderRecent(entries) {
  var container = document.getElementById('att-entries');
  if (!entries.length) {
    container.innerHTML = '<div class="att-empty">暂无记录</div>';
    return;
  }
  var groups = {};
  entries.forEach(function(e) {
    if (!groups[e.record_date]) groups[e.record_date] = [];
    groups[e.record_date].push(e);
  });
  var dates = Object.keys(groups).sort().reverse();
  var html = '';
  dates.forEach(function(d) {
    var total = 0;
    var rows = '';
    groups[d].forEach(function(e) {
      total += e.hours;
      rows += '<div class="att-entry" data-id="' + e.id + '">' +
        '<span class="att-entry__time">' + e.time_start + '-' + e.time_end + '</span>' +
        '<span class="att-entry__hours">' + e.hours + 'h</span>' +
        (e.note ? '<span class="att-entry__note">' + e.note + '</span>' : '') +
        '<button class="att-entry__del" data-id="' + e.id + '">✕</button></div>';
    });
    html += '<div class="att-day">' +
      '<div class="att-day__head">' + d + ' <span class="att-day__total">' + total.toFixed(1) + 'h</span></div>' +
      rows + '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.att-entry__del').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (!confirm('删除？')) return;
      fetch('/api/attendance/' + btn.dataset.id, { method: 'DELETE', cache: 'no-store' })
        .then(function() { loadRecent(); });
    });
  });
}

// ── Export ──
function exportExcel() {
  var from = document.getElementById('att-export-from').value;
  var to = document.getElementById('att-export-to').value;
  if (!from || !to) { alert('请选择起止日期'); return; }
  window.open('/api/attendance/export?from=' + from + '&to=' + to, '_blank');
}
