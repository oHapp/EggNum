/**
 * 首页主逻辑 v1.1.3-dev
 */
var todayRecordId = null;
var autoSaveBusy = false;
var autoSavePending = false;
var pageReady = false;
var hasChanges = false;

function log() {
  var args = ['[EggNum]'].concat(Array.prototype.slice.call(arguments));
  console.log.apply(console, args);
}

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.spec-row').forEach(function(row) {
    new QuantityController(row);
  });

  document.querySelectorAll('.category-group__header').forEach(function(header) {
    header.addEventListener('click', function() {
      header.parentElement.classList.toggle('category-group--collapsed');
    });
  });

  var saveBtn = document.getElementById('btn-save');
  if (saveBtn) { saveBtn.addEventListener('click', handleSave); }

  var genBtn = document.getElementById('btn-generate');
  if (genBtn) { genBtn.addEventListener('click', handleGenerateCopy); }

  var dismissBtn = document.querySelector('.auto-load-bar__dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      resetAllToZero();
      hideAutoLoadBar();
      todayRecordId = null;
      scheduleAutoSave();
    });
  }

  createToastElement();
  updateDateDisplay();

  // Start loading
  autoLoadToday();

  // Debug dump
  fetch('/api/debug').then(function(r){return r.json()}).then(function(d){
    log('DB records:', d.record_count);
    d.records.forEach(function(r){
      log('  #'+r.id, r.record_date, 'qty='+r.total_qty, JSON.stringify(r.items));
    });
  });

  // Quantity change → save
  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('qty-display')) { scheduleAutoSave(); }
  });
  document.querySelectorAll('.spec-row').forEach(function(row) {
    row.addEventListener('pointerup', function() {
      setTimeout(function() { scheduleAutoSave(); }, 50);
    });
  });

  // pagehide only — visibilitychange was overwriting data on tab switch
  window.addEventListener('pagehide', function() { if (hasChanges) saveNowSync(); });
  // visibility change: only save if user actually changed something
  document.addEventListener('visibilitychange', function() {
    if (document.hidden && hasChanges) { saveNowSync(); }
  });
});

// ── Date ──
function updateDateDisplay() {
  var d = new Date();
  var el = document.querySelector('.meta-bar__date');
  if (el) { el.textContent = (d.getMonth()+1) + '月' + d.getDate() + '日'; }
}

function localDateStr(date) {
  date = date || new Date();
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d_ = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d_;
}

// ── Auto-load ──
async function autoLoadToday() {
  showAutoLoadBar('⏳ 加载中...', false);
  try {
    var dateParam = localDateStr();
    log('autoLoadToday: fetching /api/today?date=' + dateParam);
    var resp = await fetch('/api/today?date=' + dateParam + '&_=' + Date.now(), { cache: 'no-store' });
    var data = await resp.json();
    log('autoLoadToday: response', JSON.stringify(data));

    if (!data.found) {
      log('autoLoadToday: no data found for date=' + dateParam);
      showAutoLoadBar('📋 今日暂无记录', false);
      pageReady = true;
      return;
    }

    todayRecordId = data.record_id;
    log('autoLoadToday: loaded record_id=' + todayRecordId + ' items=' + data.items.length);

    var setCount = 0;
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      var row = document.querySelector(
        '.spec-row[data-category="' + escapeAttr(item.category) + '"][data-spec="' + item.spec + '"]'
      );
      if (!row) {
        log('autoLoadToday: WARN no row for ' + item.category + '/' + item.spec);
        continue;
      }
      var display = row.querySelector('.qty-display');
      if (!display) continue;
      display.value = item.quantity;
      if (item.quantity === 0) {
        row.classList.add('is-empty');
        display.classList.add('is-zero');
      } else {
        row.classList.remove('is-empty');
        display.classList.remove('is-zero');
        setCount++;
      }
    }
    log('autoLoadToday: set ' + setCount + ' non-zero values');
    showAutoLoadBar('📥 #' + todayRecordId + ' ' + data.record_date, true);
  } catch (err) {
    log('autoLoadToday: ERROR', err.message || err);
    showAutoLoadBar('⚠️ 加载失败: ' + (err.message || '网络错误'), false);
  } finally {
    pageReady = true;
  }
}

// ── Auto-save ──
function scheduleAutoSave() {
  if (!pageReady) { log('scheduleAutoSave: skipped (page not ready)'); return; }
  hasChanges = true;
  if (autoSaveBusy) { autoSavePending = true; return; }
  autoSaveBusy = true;
  autoSavePending = false;

  log('scheduleAutoSave: saving...');
  showAutoLoadBar('📝 保存中...', false);

  submitToBackend().then(function(result) {
    log('scheduleAutoSave: OK record_id=' + result.record_id);
    hasChanges = false;
    showAutoLoadBar('✅ 已保存 #' + result.record_id, false);
  }).catch(function(err) {
    log('scheduleAutoSave: FAIL', err.message || err);
    showAutoLoadBar('⚠️ ' + (err.message || '保存失败'), false);
  }).finally(function() {
    autoSaveBusy = false;
    if (autoSavePending) { autoSavePending = false; scheduleAutoSave(); }
    else {
      setTimeout(function() {
        var bar = document.getElementById('auto-load-bar');
        var textEl = bar && bar.querySelector('.auto-load-bar__text');
        if (textEl && textEl.textContent.indexOf('已保存') >= 0) {
          showAutoLoadBar('📥 #' + todayRecordId, true);
        }
      }, 2500);
    }
  });
}

function saveNowSync() {
  if (!pageReady || !todayRecordId) { log('saveNowSync: skipped (!ready or no id)'); return; }
  log('saveNowSync: sendBeacon');
  var rows = collectRows();
  var body = { store_name: getStoreName(), record_date: localDateStr(), items: rows, record_id: todayRecordId };
  navigator.sendBeacon('/api/submit', JSON.stringify(body));
}

// ── Backend submit ──
function submitToBackend() {
  var rows = collectRows();
  var body = { store_name: getStoreName(), record_date: localDateStr(), items: rows };
  if (todayRecordId) { body.record_id = todayRecordId; }
  log('submitToBackend: POST body has ' + rows.length + ' items, record_id=' + (todayRecordId||'null'));
  log('submitToBackend: date=' + body.record_date + ' store=' + body.store_name);
  // Show first 3 non-zero items
  var nonZero = rows.filter(function(r) { return r.quantity > 0; });
  log('submitToBackend: non-zero items (' + nonZero.length + '):', nonZero.slice(0, 5).map(function(r){return r.category+r.spec+'='+r.quantity}).join(', '));

  return fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.text().then(function(txt) { throw new Error('HTTP ' + resp.status + ': ' + txt.substring(0, 100)); });
    }
    return resp.json();
  }).then(function(data) {
    if (data.success) {
      todayRecordId = data.record_id;
      updateDateDisplay();
      log('submitToBackend: success, record_id=' + data.record_id);
      return data;
    }
    throw new Error(data.error || 'unknown');
  });
}

// ── Save button ──
async function handleSave() {
  if (!pageReady) { showToast('⚠️ 页面加载中，请稍候'); return; }
  var btn = document.getElementById('btn-save');
  var orig = btn.textContent;
  btn.textContent = '⏳ 保存中...';
  btn.disabled = true;
  try {
    await submitToBackend();
    showToast('💾 已保存');
    showAutoLoadBar('📥 #' + todayRecordId + ' (已保存)', true);
    if (navigator.vibrate) { navigator.vibrate(10); }
  } catch (err) {
    log('handleSave: FAIL', err.message || err);
    showToast('⚠️ ' + (err.message || '保存失败'));
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ── Generate & Copy ──
async function handleGenerateCopy() {
  if (!pageReady) { showToast('⚠️ 页面加载中，请稍候'); return; }
  var rows = collectRows();
  var storeName = getStoreName();
  var dateStr = localDateStr();
  var text = generateOutputText(storeName, dateStr, rows);

  var genBtn = document.getElementById('btn-generate');
  var orig = genBtn.textContent;
  genBtn.textContent = '⏳ ...';
  genBtn.disabled = true;

  var copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch(e) { copied = fallbackCopy(text); }
  showToast(copied ? '✅ 已复制到剪贴板' : '⚠️ 复制失败');
  if (copied && navigator.vibrate) { navigator.vibrate([10, 50, 10]); }

  try {
    await submitToBackend();
    showAutoLoadBar('📥 #' + todayRecordId + ' (已保存)', true);
  } catch (err) {
    log('handleGenerateCopy save: FAIL', err.message || err);
  } finally {
    genBtn.textContent = orig;
    genBtn.disabled = false;
  }
}

// ── Helpers ──
function getStoreName() {
  var el = document.querySelector('.meta-bar__store');
  return el ? el.textContent.trim() : '鹏泰(大福店)';
}

function collectRows() {
  var rows = [];
  document.querySelectorAll('.spec-row').forEach(function(row) {
    var display = row.querySelector('.qty-display');
    var rawVal = display.value.trim();
    var qty = (rawVal === '' || !/^\d+$/.test(rawVal)) ? 0 : parseInt(rawVal, 10);
    rows.push({ category: row.dataset.category, spec: parseInt(row.dataset.spec), quantity: qty });
  });
  return rows;
}

function generateOutputText(storeName, dateStr, rows) {
  var lines = [storeName + ' ' + dateStr];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    lines.push(r.category + r.spec + '枚:' + (r.quantity > 0 ? String(r.quantity) : ''));
  }
  return lines.join('\n');
}

function resetAllToZero() {
  document.querySelectorAll('.spec-row').forEach(function(row) {
    var d = row.querySelector('.qty-display');
    if (d) { d.value = '0'; row.classList.add('is-empty'); d.classList.add('is-zero'); }
  });
}

function escapeAttr(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function showAutoLoadBar(msg, showDismiss) {
  var bar = document.getElementById('auto-load-bar');
  if (!bar) return;
  bar.querySelector('.auto-load-bar__text').textContent = msg;
  var btn = bar.querySelector('.auto-load-bar__dismiss');
  if (btn) { btn.style.display = showDismiss ? '' : 'none'; }
  bar.style.display = 'flex';
}

function hideAutoLoadBar() {
  var bar = document.getElementById('auto-load-bar');
  if (bar) bar.style.display = 'none';
}

// ── Toast ──
function createToastElement() { if (!document.getElementById('toast')) { var e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; document.body.appendChild(e); } }
function showToast(msg, dur) {
  dur = dur || 2000;
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('toast--visible');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(function() { t.classList.remove('toast--visible'); }, dur);
}

// ── Fallback copy ──
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return true; } catch(e) { return false; }
  finally { document.body.removeChild(ta); }
}
