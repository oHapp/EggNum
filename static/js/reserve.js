/**
 * 扣留页面逻辑 v1.3.4-dev
 */
var reserveReady = false;
var reserveConfirmed = false;
var reserveLinked = true;
var reserveCooldown = {}; // per-row cooldown to prevent race condition

document.addEventListener('DOMContentLoaded', function() {
  loadReserve();

  // Linkage toggle: only confirm when turning OFF
  var tog = document.getElementById('reserve-link-toggle');
  if (tog) {
    tog.checked = reserveLinked;
    document.getElementById('reserve-link-label').textContent = '联动: 开';
    tog.addEventListener('change', function() {
      var newState = tog.checked;
      // Only confirm when turning OFF
      if (!newState && !confirm('关闭联动后，留存 ± 不再影响出库数量。确定？')) {
        tog.checked = true; // revert
        return;
      }
      reserveLinked = newState;
      document.getElementById('reserve-link-label').textContent =
        reserveLinked ? '联动: 开' : '联动: 关';

      // Log linkage change
      fetch('/api/reserve/history/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_date: new Date().toISOString().split('T')[0], category: '__联动__', spec: 0, delta: newState ? 0 : -1 })
      }).catch(function(){});
    });
  }
});

function loadReserve() {
  fetch('/api/reserve', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        var row = document.querySelector(
          '#tab-reserve .spec-row[data-category="' + escapeAttr(item.category) + '"][data-spec="' + item.spec + '"]'
        );
        if (!row) continue;
        var display = row.querySelector('.qty-display');
        if (!display) continue;
        display.value = item.quantity;
        if (item.quantity === 0) {
          row.classList.add('is-empty');
          display.classList.add('is-zero');
        } else {
          row.classList.remove('is-empty');
          display.classList.remove('is-zero');
        }
      }
      reserveReady = true;
      bindReserveButtons();
      refreshReportHints();
      updateReserveTotals();
    })
    .catch(function(err) {
      console.error('loadReserve:', err);
    });
}

function refreshReportHints() {
  document.querySelectorAll('#tab-reserve .report-qty-hint').forEach(function(hint) {
    var cat = hint.dataset.category;
    var sp = hint.dataset.spec;
    var reportRow = document.querySelector(
      '#tab-report .spec-row[data-category="' + escapeAttr(cat) + '"][data-spec="' + sp + '"]'
    );
    if (!reportRow) { hint.textContent = '出库: 0'; return; }
    var display = reportRow.querySelector('.qty-display');
    hint.textContent = '出库: ' + (display ? display.value : '0');
  });
}

function bindReserveButtons() {
  document.querySelectorAll('#tab-reserve .spec-row').forEach(function(row) {
    var plus = row.querySelector('.reserve-plus');
    var minus = row.querySelector('.reserve-minus');
    var newPlus = plus.cloneNode(true);
    var newMinus = minus.cloneNode(true);
    plus.parentNode.replaceChild(newPlus, plus);
    minus.parentNode.replaceChild(newMinus, minus);

    newPlus.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      handleReserveDelta(row, 1);
    });
    newMinus.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      handleReserveDelta(row, -1);
    });
  });
}

function getReportQty(cat, sp) {
  var row = document.querySelector(
    '#tab-report .spec-row[data-category="' + escapeAttr(cat) + '"][data-spec="' + sp + '"]'
  );
  if (!row) return 0;
  var d = row.querySelector('.qty-display');
  return d ? (parseInt(d.value, 10) || 0) : 0;
}

function handleReserveDelta(row, delta) {
  var category = row.dataset.category;
  var spec = parseInt(row.dataset.spec);
  var key = category + '_' + spec;

  // Cooldown: prevent race condition on rapid clicks
  if (reserveCooldown[key]) return;
  reserveCooldown[key] = true;
  setTimeout(function() { reserveCooldown[key] = false; }, 300);

  var display = row.querySelector('.qty-display');
  var currentVal = parseInt(display.value) || 0;

  if (delta < 0 && currentVal <= 0) return;

  // If linkage is ON and trying to add to reserve, check report has stock
  if (delta > 0 && reserveLinked) {
    var reportQty = getReportQty(category, spec);
    if (reportQty <= 0) {
      if (!reserveConfirmed) {
        // Show confirm once
        if (confirm('⚠️ 今日出库数量为 0，确定要存入留存吗？\n\n确认后本次访问不再提示。')) {
          reserveConfirmed = true;
        } else {
          return;
        }
      }
      // If already confirmed this session, just proceed (report stays 0, reserve increases)
    }
  }

  var newReserveVal = currentVal + delta;
  display.value = newReserveVal;
  row.classList.toggle('is-empty', newReserveVal === 0);
  display.classList.toggle('is-zero', newReserveVal === 0);

  if (navigator.vibrate) navigator.vibrate(10);

  var body = {
    category: category,
    spec: spec,
    delta: delta
  };
  // Only sync with report if linkage is ON
  if (reserveLinked && typeof localDateStr === 'function') {
    body.date = localDateStr();
  }

  fetch('/api/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.success) {
      display.value = currentVal;
      row.classList.toggle('is-empty', currentVal === 0);
      display.classList.toggle('is-zero', currentVal === 0);
      showReserveToast('⚠️ ' + (data.error || '操作失败'));
    } else {
      if (reserveLinked) {
        syncReportDisplay(category, spec, -delta);
      }
      refreshReportHints();
      if (typeof refreshReserveHints === 'function') refreshReserveHints();
      if (typeof updateReportTotals === 'function') updateReportTotals();
      updateReserveTotals();
      showReserveToast(delta > 0 ? '📦 +1' : '📤 -1');
    }
  }).catch(function(err) {
    display.value = currentVal;
    row.classList.toggle('is-empty', currentVal === 0);
    display.classList.toggle('is-zero', currentVal === 0);
    console.error('handleReserveDelta:', err);
  });
}

function syncReportDisplay(category, spec, deltaForReport) {
  var reportRow = document.querySelector(
    '#tab-report .spec-row[data-category="' + escapeAttr(category) + '"][data-spec="' + spec + '"]'
  );
  if (!reportRow) return;
  var display = reportRow.querySelector('.qty-display');
  if (!display) return;
  var current = parseInt(display.value) || 0;
  var newVal = current + deltaForReport;
  if (newVal < 0) newVal = 0;
  display.value = newVal;
  reportRow.classList.toggle('is-empty', newVal === 0);
  display.classList.toggle('is-zero', newVal === 0);
  if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
}

function showReserveToast(msg) {
  if (typeof showToast === 'function') { showToast(msg, 1500); return; }
  var bar = document.getElementById('reserve-bar');
  if (bar) { var el = bar.querySelector('.auto-load-bar__text'); if (el) el.textContent = msg; }
}

function updateReserveTotals() {
  var grandTotal = 0;
  document.querySelectorAll('#tab-reserve .category-group').forEach(function(group) {
    var catTotal = 0;
    group.querySelectorAll('.spec-row').forEach(function(row) {
      var d = row.querySelector('.qty-display');
      catTotal += d ? (parseInt(d.value, 10) || 0) : 0;
    });
    grandTotal += catTotal;
    var el = group.querySelector('.category-total');
    if (el) el.textContent = catTotal;
  });
  var barEl = document.querySelector('#reserve-bar .auto-load-bar__text');
  if (barEl) {
    barEl.textContent = '📦 扣留 ｜ 总计: ' + grandTotal + '（跨天累计）';
  }
}
