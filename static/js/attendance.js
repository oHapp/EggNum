/**
 * 考勤打卡 — 时间选择、分段编辑、导出 Excel
 */
document.addEventListener('DOMContentLoaded', function() {
  initAttendancePage();
  document.getElementById('att-save').addEventListener('click', saveAttendance);
  document.getElementById('att-add-slot').addEventListener('click', addSlot);
  document.getElementById('att-export-btn').addEventListener('click', exportExcel);

  // Date input change → reload entries
  document.getElementById('att-date-input').addEventListener('change', function() {
    document.getElementById('att-date-text').textContent = this.value;
    loadAttendanceEntries();
  });

  // 30-min step toggle
  document.getElementById('att-step-30').addEventListener('change', function() {
    var step = this.checked ? 1800 : 60;
    document.querySelectorAll('.att-slot__start, .att-slot__end').forEach(function(el) {
      el.step = step;
    });
  });

  // Export date defaults
  var today = localDateStr();
  document.getElementById('att-export-from').value = today;
  var to = new Date();
  to.setDate(to.getDate() + 30);
  document.getElementById('att-export-to').value = localDateStr(to);

  // Auto-update hours on time change
  document.getElementById('att-slots').addEventListener('change', function(e) {
    if (e.target.classList.contains('att-slot__start') || e.target.classList.contains('att-slot__end')) {
      updateSlotHours(e.target.closest('.att-slot'));
    }
  });
});

function initAttendancePage() {
  var now = new Date();
  var today = localDateStr(now);
  document.getElementById('att-date-text').textContent = today;
  document.getElementById('att-date-input').value = today;

  // Set default time slot to current time rounded +2h
  var rounded = roundTime(now.getHours(), now.getMinutes());
  var startH = rounded.h, startM = rounded.m;
  var endH = startH + 2, endM = startM;
  if (endH >= 24) { endH -= 24; }

  var slot = document.querySelector('.att-slot');
  var fmt = function(h, m) { return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  slot.querySelector('.att-slot__start').value = fmt(startH, startM);
  slot.querySelector('.att-slot__end').value = fmt(endH, endM);
  updateSlotHours(slot);

  loadAttendanceEntries();
}

// ── Time rounding (30-min base) ──
function roundTime(h, m) {
  var totalM = h * 60 + m;
  var remainder = totalM % 30;
  if (remainder <= 15) {
    totalM -= remainder;       // down to :00 or :30
  } else {
    totalM += (30 - remainder); // up to :30 or :00
  }
  totalM = totalM % (24 * 60);
  return { h: Math.floor(totalM / 60), m: totalM % 60 };
}

function localDateStr(date) {
  date = date || new Date();
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function calcHours(startVal, endVal) {
  var s = startVal.split(':'), e = endVal.split(':');
  var sm = parseInt(s[0]) * 60 + parseInt(s[1]);
  var em = parseInt(e[0]) * 60 + parseInt(e[1]);
  if (em <= sm) em += 24 * 60;
  return Math.round((em - sm) / 6) / 10; // round to 0.1h
}

// ── Slots ──
function addSlot() {
  var slots = document.getElementById('att-slots');
  var count = slots.querySelectorAll('.att-slot').length + 1;
  var div = document.createElement('div');
  div.className = 'att-slot';
  div.innerHTML =
    '<span class="att-slot__label">时段 ' + count + '</span>' +
    '<input type="time" class="att-slot__start" step="1800" value="09:00">' +
    '<span class="att-slot__sep">至</span>' +
    '<input type="time" class="att-slot__end" step="1800" value="11:00">' +
    '<span class="att-slot__hours">2h</span>' +
    '<button type="button" class="att-slot__remove" title="删除">✕</button>';
  slots.appendChild(div);

  div.querySelector('.att-slot__remove').addEventListener('click', function() {
    div.remove();
    renumberSlots();
  });

  // Apply current step setting
  var step = document.getElementById('att-step-30').checked ? 1800 : 60;
  div.querySelector('.att-slot__start').step = step;
  div.querySelector('.att-slot__end').step = step;
  updateSlotHours(div);

  // Show all remove buttons when more than 1 slot
  if (slots.querySelectorAll('.att-slot').length > 1) {
    slots.querySelectorAll('.att-slot__remove').forEach(function(b) { b.style.display = ''; });
  }
}

function renumberSlots() {
  var slots = document.querySelectorAll('.att-slot');
  if (slots.length <= 1) {
    slots.forEach(function(s) { s.querySelector('.att-slot__remove').style.display = 'none'; });
  }
  slots.forEach(function(s, i) {
    s.querySelector('.att-slot__label').textContent = '时段 ' + (i + 1);
  });
}

function updateSlotHours(slot) {
  var start = slot.querySelector('.att-slot__start').value;
  var end = slot.querySelector('.att-slot__end').value;
  var h = calcHours(start, end);
  slot.querySelector('.att-slot__hours').textContent = h + 'h';
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

    var hours = calcHours(start, end);
    try {
      await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_date: date, time_start: start, time_end: end, hours: hours, note: note }),
        cache: 'no-store'
      });
      saved++;
    } catch (err) {
      console.error('saveAttendance:', err);
    }
  }

  if (saved > 0) {
    if (typeof showToast === 'function') showToast('✅ 已保存 ' + saved + ' 条记录');
    document.getElementById('att-note').value = '';
    // Reset to single slot with current time
    var slotsDiv = document.getElementById('att-slots');
    slotsDiv.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'att-slot';
    var now = new Date();
    var r = roundTime(now.getHours(), now.getMinutes());
    var eh = r.h + 2, em = r.m;
    if (eh >= 24) eh -= 24;
    var fmt = function(h, m) { return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
    div.innerHTML =
      '<span class="att-slot__label">时段 1</span>' +
      '<input type="time" class="att-slot__start" step="1800" value="' + fmt(r.h, r.m) + '">' +
      '<span class="att-slot__sep">至</span>' +
      '<input type="time" class="att-slot__end" step="1800" value="' + fmt(eh, em) + '">' +
      '<span class="att-slot__hours">2h</span>' +
      '<button type="button" class="att-slot__remove" title="删除" style="display:none;">✕</button>';
    slotsDiv.appendChild(div);
    loadAttendanceEntries();
  } else {
    if (typeof showToast === 'function') showToast('⚠️ 请填写时间');
  }
}

// ── Load entries ──
async function loadAttendanceEntries() {
  var date = document.getElementById('att-date-input').value;
  try {
    var resp = await fetch('/api/attendance?from=' + date + '&to=' + date, { cache: 'no-store' });
    var data = await resp.json();
    renderEntries(data.entries || []);
  } catch (err) {
    console.error('loadAttendance:', err);
  }
  // Also load recent 3 days
  loadRecentEntries();
}

async function loadRecentEntries() {
  try {
    var resp = await fetch('/api/attendance?days=3', { cache: 'no-store' });
    var data = await resp.json();
    renderRecentEntries(data.entries || []);
  } catch (err) {
    console.error('loadRecentEntries:', err);
  }
}

function renderEntries(entries) {
  // Just update today's entries highlight
}

function renderRecentEntries(entries) {
  var container = document.getElementById('att-entries');
  if (entries.length === 0) {
    container.innerHTML = '<div class="att-empty">暂无记录</div>';
    return;
  }

  // Group by date
  var groups = {};
  entries.forEach(function(e) {
    if (!groups[e.record_date]) groups[e.record_date] = [];
    groups[e.record_date].push(e);
  });

  var html = '';
  var dates = Object.keys(groups).sort().reverse();
  dates.forEach(function(d) {
    var dayTotal = 0;
    var rows = '';
    groups[d].forEach(function(e) {
      dayTotal += e.hours;
      rows += '<div class="att-entry" data-id="' + e.id + '">' +
        '<span class="att-entry__time">' + e.time_start + '-' + e.time_end + '</span>' +
        '<span class="att-entry__hours">' + e.hours + 'h</span>' +
        (e.note ? '<span class="att-entry__note">' + e.note + '</span>' : '') +
        '<button class="att-entry__del" data-id="' + e.id + '">✕</button>' +
        '</div>';
    });
    html += '<div class="att-day">' +
      '<div class="att-day__head">' + d + ' <span class="att-day__total">' + dayTotal.toFixed(1) + 'h</span></div>' +
      rows + '</div>';
  });

  container.innerHTML = html;

  // Delete buttons
  container.querySelectorAll('.att-entry__del').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.id;
      if (confirm('删除这条记录？')) {
        fetch('/api/attendance/' + id, { method: 'DELETE', cache: 'no-store' }).then(function() {
          loadAttendanceEntries();
          loadRecentEntries();
        });
      }
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
