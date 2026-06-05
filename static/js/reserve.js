/**
 * 库存留存页面逻辑
 * - 加载留存数据 (跨天累计)
 * - +/- 联动出库登记
 */
var reserveReady = false;

document.addEventListener('DOMContentLoaded', function() {
  loadReserve();
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
    })
    .catch(function(err) {
      console.error('loadReserve:', err);
    });
}

/** Copy report quantities to hints on reserve tab */
function refreshReportHints() {
  document.querySelectorAll('#tab-reserve .report-qty-hint').forEach(function(hint) {
    var cat = hint.dataset.category;
    var sp = hint.dataset.spec;
    var reportRow = document.querySelector(
      '#tab-report .spec-row[data-category="' + escapeAttr(cat) + '"][data-spec="' + sp + '"]'
    );
    if (!reportRow) { hint.textContent = '出库: -'; return; }
    var display = reportRow.querySelector('.qty-display');
    hint.textContent = '出库: ' + (display ? display.value : '-');
  });
}

function bindReserveButtons() {
  document.querySelectorAll('#tab-reserve .spec-row').forEach(function(row) {
    var plus = row.querySelector('.reserve-plus');
    var minus = row.querySelector('.reserve-minus');

    // Remove old listeners by cloning
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

function handleReserveDelta(row, delta) {
  var category = row.dataset.category;
  var spec = parseInt(row.dataset.spec);
  var display = row.querySelector('.qty-display');
  var currentVal = parseInt(display.value) || 0;

  // For delta < 0 (decrease reserve): check reserve > 0
  if (delta < 0 && currentVal <= 0) return;

  // Optimistic UI update
  var newReserveVal = currentVal + delta;
  display.value = newReserveVal;
  row.classList.toggle('is-empty', newReserveVal === 0);
  display.classList.toggle('is-zero', newReserveVal === 0);

  if (navigator.vibrate) navigator.vibrate(10);

  // Send to server
  var body = {
    category: category,
    spec: spec,
    delta: delta,
    date: typeof localDateStr === 'function' ? localDateStr() : new Date().toISOString().split('T')[0]
  };

  fetch('/api/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.success) {
      // Rollback on failure
      display.value = currentVal;
      row.classList.toggle('is-empty', currentVal === 0);
      display.classList.toggle('is-zero', currentVal === 0);
      showReserveToast('⚠️ ' + (data.error || '操作失败'));
    } else {
      // Sync report page display
      syncReportDisplay(category, spec, -delta);
      refreshReportHints();
      if (typeof refreshReserveHints === 'function') refreshReserveHints();
      showReserveToast(delta > 0 ? '📦 +1 已存入留存' : '📤 -1 已取出留存');
    }
  }).catch(function(err) {
    // Rollback
    display.value = currentVal;
    row.classList.toggle('is-empty', currentVal === 0);
    display.classList.toggle('is-zero', currentVal === 0);
    console.error('handleReserveDelta:', err);
  });
}

/**
 * Update the report tab's display to reflect reserve changes.
 * deltaForReport: the change to apply to the report quantity.
 * If reserve increased (delta=1), report decreases (-1).
 */
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

  // Trigger report auto-save
  if (typeof scheduleAutoSave === 'function') {
    scheduleAutoSave();
  }
}

function showReserveToast(msg) {
  if (typeof showToast === 'function') {
    showToast(msg, 1500);
    return;
  }
  // Fallback
  var bar = document.getElementById('reserve-bar');
  if (bar) {
    var el = bar.querySelector('.auto-load-bar__text');
    if (el) el.textContent = msg;
  }
}
