/**
 * 鸡蛋库存登记助手 — 首页逻辑 v1.2.0
 */
var todayRecordId = null;
var autoSaveBusy = false;
var autoSavePending = false;
var pageReady = false;
var hasChanges = false;
var lastSaved = {};  // snapshot of last saved values, for delta detection

document.addEventListener('DOMContentLoaded', function() {
  // Init quantity controllers (report tab only)
  document.querySelectorAll('#tab-report .spec-row').forEach(function(row) {
    new QuantityController(row);
  });

  // Category collapse
  document.querySelectorAll('.category-group__header').forEach(function(header) {
    header.addEventListener('click', function() {
      header.parentElement.classList.toggle('category-group--collapsed');
    });
  });

  // Buttons
  document.getElementById('btn-save').addEventListener('click', handleSave);
  document.getElementById('btn-generate').addEventListener('click', handleGenerateCopy);

  // Dismiss auto-load bar
  var dismissBtn = document.querySelector('.auto-load-bar__dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      resetAllToZero();
      hideAutoLoadBar();
      todayRecordId = null;
      hasChanges = true;
      scheduleAutoSave();
    });
  }

  createToastElement();
  updateDateDisplay();
  initDatePicker();
  autoLoadToday();

  // Quantity change events
  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('qty-display')) { scheduleAutoSave(); }
  });
  document.querySelectorAll('#tab-report .spec-row').forEach(function(row) {
    row.addEventListener('pointerup', function() {
      setTimeout(function() { scheduleAutoSave(); }, 50);
    });
  });

  // Emergency save on page close
  window.addEventListener('pagehide', function() {
    if (hasChanges) saveNowSync();
  });
});

// ── Date helpers ──
function updateDateDisplay() {
  var ds = getDateStr();
  var parts = ds.split('-');
  var el = document.querySelector('.meta-bar__date');
  if (!el) return;
  el.textContent = parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';

  var isOverride = false;
  try { isOverride = !!localStorage.getItem('eggnum_dev_date'); } catch(e) {}

  // Highlight override state
  el.style.background = isOverride ? '#fff3e0' : '#f0f0f0';
  el.style.color = isOverride ? '#e65100' : '';

  // Show/hide reset button
  var resetBtn = document.querySelector('.meta-bar__reset-date');
  if (resetBtn) resetBtn.style.display = isOverride ? '' : 'none';
}

function initDatePicker() {
  var wrap = document.querySelector('.meta-bar__date-wrap');
  if (!wrap) return;

  // Create a transparent date input overlaid on the date text
  var input = document.createElement('input');
  input.type = 'date';
  input.className = 'meta-bar__date-input';
  input.value = getDateStr();
  wrap.style.position = 'relative';
  wrap.appendChild(input);

  input.addEventListener('change', function() {
    if (input.value) {
      var today = localDateStr();
      if (input.value === today) {
        localStorage.removeItem('eggnum_dev_date');
      } else {
        localStorage.setItem('eggnum_dev_date', input.value);
      }
    } else {
      localStorage.removeItem('eggnum_dev_date');
    }
    updateDateDisplay();
    pageReady = false;
    autoLoadToday();
    if (typeof loadReserve === 'function') loadReserve();
  });

  // Reset button
  var resetBtn = document.querySelector('.meta-bar__reset-date');
  if (resetBtn) {
    resetBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      localStorage.removeItem('eggnum_dev_date');
      updateDateDisplay();
      pageReady = false;
      autoLoadToday();
      if (typeof loadReserve === 'function') loadReserve();
      showToast('📅 已重置为今天');
    });
  }
}

// Dev date override (set via dev panel, stored in localStorage)
function getDateStr() {
  try {
    var ov = localStorage.getItem('eggnum_dev_date');
    if (ov) {
      var today = localDateStr();
      if (ov === today) { localStorage.removeItem('eggnum_dev_date'); return today; }
      return ov;
    }
  } catch(e) {}
  return localDateStr();
}

function localDateStr(date) {
  date = date || new Date();
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

// ── Auto-load ──
async function autoLoadToday() {
  showAutoLoadBar('⏳ 加载中...', false);
  try {
    var resp = await fetch('/api/today?date=' + getDateStr() + '&_=' + Date.now(), { cache: 'no-store' });
    var data = await resp.json();

    if (!data.found) {
      showAutoLoadBar('📋 今日暂无记录', false);
      pageReady = true;
      return;
    }

    todayRecordId = data.record_id;
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      var row = document.querySelector(
        '#tab-report .spec-row[data-category="' + escapeAttr(item.category) + '"][data-spec="' + item.spec + '"]'
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

    showAutoLoadBar('📥 已加载今日数据', true);
    snapshotValues();
    refreshReserveHints();
  } catch (err) {
    console.error('autoLoadToday:', err);
    showAutoLoadBar('⚠️ 加载失败', false);
  } finally {
    setTimeout(function() { pageReady = true; }, 300);
  }
}

function snapshotValues() {
  document.querySelectorAll('#tab-report .spec-row').forEach(function(row) {
    var key = row.dataset.category + '_' + row.dataset.spec;
    var display = row.querySelector('.qty-display');
    lastSaved[key] = display ? (parseInt(display.value) || 0) : 0;
  });
}

/** Copy reserve quantities to hints on report tab */
function refreshReserveHints() {
  document.querySelectorAll('#tab-report .reserve-qty-hint').forEach(function(hint) {
    var cat = hint.dataset.category;
    var sp = hint.dataset.spec;
    var reserveRow = document.querySelector(
      '#tab-reserve .spec-row[data-category="' + escapeAttr(cat) + '"][data-spec="' + sp + '"]'
    );
    if (!reserveRow) { hint.textContent = '留存: 0'; return; }
    var display = reserveRow.querySelector('.qty-display');
    hint.textContent = '留存: ' + (display ? display.value : '0');
  });
}

// ── Auto-save ──
function scheduleAutoSave() {
  if (!pageReady) return;
  hasChanges = true;
  if (autoSaveBusy) { autoSavePending = true; return; }
  autoSaveBusy = true;
  autoSavePending = false;

  showAutoLoadBar('📝 保存中...', false);

  submitToBackend().then(function() {
    hasChanges = false;
    showAutoLoadBar('✅ 已保存', false);
  }).catch(function(err) {
    console.error('autoSave failed:', err);
    showAutoLoadBar('⚠️ ' + (err.message || '保存失败'), false);
  }).finally(function() {
    autoSaveBusy = false;
    if (autoSavePending) { autoSavePending = false; scheduleAutoSave(); }
    else {
      setTimeout(function() {
        var bar = document.getElementById('auto-load-bar');
        var textEl = bar && bar.querySelector('.auto-load-bar__text');
        if (textEl && textEl.textContent.indexOf('已保存') >= 0) {
          showAutoLoadBar('📥 已加载今日数据', true);
        }
      }, 2500);
    }
  });
}

function saveNowSync() {
  var rows = collectRows();
  var body = { store_name: getStoreName(), record_date: getDateStr(), items: rows, record_id: todayRecordId };
  navigator.sendBeacon('/api/submit', JSON.stringify(body));
}

// ── Backend submit ──
function submitToBackend() {
  var rows = collectRows();
  var body = { store_name: getStoreName(), record_date: getDateStr(), items: rows };
  if (todayRecordId) body.record_id = todayRecordId;

  // Send only changed items to avoid overwriting concurrent edits
  var changed = [];
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i].category + '_' + rows[i].spec;
    if (lastSaved[key] !== rows[i].quantity) {
      changed.push(rows[i]);
    }
  }
  if (changed.length > 0 && changed.length < rows.length) {
    body.items = changed;
    body.merge = true;  // tell server to merge, not replace
  }

  return fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.text().then(function(txt) {
        throw new Error('HTTP ' + resp.status + ': ' + txt.substring(0, 80));
      });
    }
    return resp.json();
  }).then(function(data) {
    if (data.success) {
      todayRecordId = data.record_id;
      updateDateDisplay();
      snapshotValues();  // update snapshot after successful save
      return data;
    }
    throw new Error(data.error || 'unknown');
  });
}

// ── Save button ──
async function handleSave() {
  if (!pageReady) { showToast('⚠️ 页面加载中'); return; }
  var btn = document.getElementById('btn-save');
  var orig = btn.textContent;
  btn.textContent = '⏳ 保存中...';
  btn.disabled = true;
  try {
    await submitToBackend();
    hasChanges = false;
    showToast('💾 已保存');
    showAutoLoadBar('📥 已加载今日数据', true);
    if (navigator.vibrate) navigator.vibrate(10);
  } catch (err) {
    showToast('⚠️ ' + (err.message || '保存失败'));
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ── Generate & Copy ──
async function handleGenerateCopy() {
  if (!pageReady) { showToast('⚠️ 页面加载中'); return; }
  var rows = collectRows();
  var text = generateOutputText(getStoreName(), getDateStr(), rows);

  var btn = document.getElementById('btn-generate');
  var orig = btn.textContent;
  btn.textContent = '⏳ ...';
  btn.disabled = true;

  var copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; }
  catch (e) { copied = fallbackCopy(text); }
  showToast(copied ? '✅ 已复制到剪贴板' : '⚠️ 复制失败');
  if (copied && navigator.vibrate) navigator.vibrate([10, 50, 10]);

  try {
    await submitToBackend();
    hasChanges = false;
    showAutoLoadBar('📥 已加载今日数据', true);
  } catch (err) {
    console.error('generateCopy save:', err);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ── Helpers ──
function getStoreName() {
  var el = document.querySelector('.meta-bar__store');
  return el ? el.textContent.trim() : '鹏泰(大福店)';
}

function collectRows() {
  var rows = [];
  document.querySelectorAll('#tab-report .spec-row').forEach(function(row) {
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
  document.querySelectorAll('#tab-report .spec-row').forEach(function(row) {
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
  if (btn) btn.style.display = showDismiss ? '' : 'none';
  bar.style.display = 'flex';
}

function hideAutoLoadBar() {
  var bar = document.getElementById('auto-load-bar');
  if (bar) bar.style.display = 'none';
}

function createToastElement() {
  if (!document.getElementById('toast')) {
    var e = document.createElement('div');
    e.id = 'toast';
    e.className = 'toast';
    document.body.appendChild(e);
  }
}

function showToast(msg, dur) {
  dur = dur || 2000;
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('toast--visible');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(function() { t.classList.remove('toast--visible'); }, dur);
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return true; }
  catch (e) { return false; }
  finally { document.body.removeChild(ta); }
}
