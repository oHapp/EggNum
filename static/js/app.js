/**
 * 首页主逻辑
 * - 加减按钮初始化
 * - 日期动态显示 (客户端本地时间)
 * - 自动加载今日数据
 * - 自动保存 (每次改动立即保存, 500ms 冷却)
 * - pagehide / visibilitychange 兜底保存
 * - 保存按钮 + 生成并复制按钮
 */

let todayRecordId = null;
let autoSaveBusy = false;
let autoSavePending = false;
let pageReady = false;  // block saves until autoLoadToday finishes

document.addEventListener('DOMContentLoaded', () => {
  // Init all quantity controllers
  document.querySelectorAll('.spec-row').forEach((row) => {
    new QuantityController(row);
  });

  // Category collapse toggle
  document.querySelectorAll('.category-group__header').forEach((header) => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('category-group--collapsed');
    });
  });

  // Save button
  const saveBtn = document.getElementById('btn-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => handleSave());
  }

  // Generate & Copy button
  const genBtn = document.getElementById('btn-generate');
  if (genBtn) {
    genBtn.addEventListener('click', () => handleGenerateCopy());
  }

  // Dismiss auto-load bar
  const dismissBtn = document.querySelector('.auto-load-bar__dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      resetAllToZero();
      hideAutoLoadBar();
      todayRecordId = null;
      scheduleAutoSave();
    });
  }

  // Toast
  createToastElement();

  // Update date to client local time
  updateDateDisplay();

  // Auto-load today's data from backend
  autoLoadToday();

  // Debug: dump DB state to console
  fetch('/api/debug').then(function(r){return r.json()}).then(function(d){
    console.log('DB has', d.record_count, 'records');
    d.records.forEach(function(r){ console.log(' #'+r.id, r.record_date, 'qty='+r.total_qty, r.items.map(function(i){return i.category+i.spec+':'+i.quantity}).join(', ')); });
  });

  // Listen for quantity changes → save immediately
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('qty-display')) {
      scheduleAutoSave();
    }
  });
  document.querySelectorAll('.spec-row').forEach((row) => {
    row.addEventListener('pointerup', () => {
      setTimeout(() => scheduleAutoSave(), 50);
    });
  });

  // pagehide: fires more reliably than beforeunload on mobile (Android)
  window.addEventListener('pagehide', () => {
    saveNowSync();
  });

  // visibilitychange: save when app goes to background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveNowSync(); }
  });
});

// ==========================================
//  Date display — always client local time
// ==========================================

function updateDateDisplay() {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const el = document.querySelector('.meta-bar__date');
  if (el) {
    el.textContent = month + '月' + day + '日';
  }
}

// ==========================================
//  Auto-save: save immediately on every change (500ms cooldown)
//  Avoids data loss when Android kills the app
// ==========================================

function scheduleAutoSave() {
  if (!pageReady) return;  // don't save before initial load completes
  if (autoSaveBusy) {
    autoSavePending = true;
    return;
  }
  autoSaveBusy = true;
  autoSavePending = false;
  showAutoLoadBar('📝 保存中...', false);

  lastSavePromise = submitToBackend().then(function() {
    showAutoLoadBar('✅ 已自动保存', false);
  }).catch(function(err) {
    console.error('autoSave:', err);
    showAutoLoadBar('⚠️ 保存失败', false);
  }).finally(function() {
    autoSaveBusy = false;
    // If another change happened during save, save again
    if (autoSavePending) {
      autoSavePending = false;
      scheduleAutoSave();
    } else {
      // Revert to normal state after a moment
      setTimeout(function() {
        var bar = document.getElementById('auto-load-bar');
        var textEl = bar && bar.querySelector('.auto-load-bar__text');
        if (textEl && textEl.textContent.indexOf('已自动保存') >= 0) {
          showAutoLoadBar('📥 已加载今日数据', true);
        }
      }, 2500);
    }
  });
}

/** Synchronous save via sendBeacon (for pagehide/visibilitychange) */
function saveNowSync() {
  if (!pageReady || !todayRecordId) return;  // nothing to save
  var rows = collectRows();
  var storeName = document.querySelector('.meta-bar__store').textContent.trim();
  var date = new Date();
  var body = { store_name: storeName, record_date: localDateStr(date), items: rows };
  if (todayRecordId) { body.record_id = todayRecordId; }
  navigator.sendBeacon('/api/submit', JSON.stringify(body));
}

function triggerAutoSave() {
  scheduleAutoSave();
}

// ==========================================
//  Auto-load today's data from backend
// ==========================================

async function autoLoadToday() {
  // Always show bar first to keep layout stable
  showAutoLoadBar('⏳ 加载中...', false);
  try {
    const resp = await fetch('/api/today?date=' + localDateStr() + '&_=' + Date.now());
    const data = await resp.json();
    if (!data.found) {
      showAutoLoadBar('📋 今日暂无记录', false);
      pageReady = true;
      return;
    }

    todayRecordId = data.record_id;
    for (const item of data.items) {
      const row = document.querySelector(
        '.spec-row[data-category="' + escapeAttr(item.category) + '"][data-spec="' + item.spec + '"]'
      );
      if (!row) continue;
      const display = row.querySelector('.qty-display');
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
    showAutoLoadBar('📥 record#' + todayRecordId + ' ' + data.record_date, true);
  } catch (err) {
    console.error('autoLoadToday:', err);
    showAutoLoadBar('⚠️ 加载失败', false);
  } finally {
    pageReady = true;
  }
}

function showAutoLoadBar(msg, showDismiss) {
  var bar = document.getElementById('auto-load-bar');
  if (!bar) return;
  bar.querySelector('.auto-load-bar__text').textContent = msg;
  var dismissBtn = bar.querySelector('.auto-load-bar__dismiss');
  if (dismissBtn) {
    dismissBtn.style.display = showDismiss ? '' : 'none';
  }
  bar.style.display = 'flex';
}

function hideAutoLoadBar() {
  const bar = document.getElementById('auto-load-bar');
  if (bar) bar.style.display = 'none';
}

function resetAllToZero() {
  document.querySelectorAll('.spec-row').forEach((row) => {
    const display = row.querySelector('.qty-display');
    if (display) {
      display.value = '0';
      row.classList.add('is-empty');
      display.classList.add('is-zero');
    }
  });
}

// ==========================================
//  Collect current form data
// ==========================================

function collectRows() {
  var rows = [];
  document.querySelectorAll('.spec-row').forEach(function(row) {
    var display = row.querySelector('.qty-display');
    var rawVal = display.value.trim();
    var quantity = (rawVal === '' || !/^\d+$/.test(rawVal)) ? 0 : parseInt(rawVal, 10);
    rows.push({
      category: row.dataset.category,
      spec: parseInt(row.dataset.spec),
      quantity: quantity
    });
  });
  return rows;
}

// ==========================================
//  Local date helper (NOT UTC — fixes timezone bug)
// ==========================================

function localDateStr(date) {
  date = date || new Date();
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// ==========================================
//  Shared backend submit
// ==========================================

async function submitToBackend() {
  var rows = collectRows();
  var storeName = document.querySelector('.meta-bar__store').textContent.trim();
  var date = new Date();
  var dateStr = localDateStr(date);
  var body = { store_name: storeName, record_date: dateStr, items: rows };
  if (todayRecordId) { body.record_id = todayRecordId; }

  var resp = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var data = await resp.json();
  if (data.success) {
    todayRecordId = data.record_id;
    updateDateDisplay();  // refresh date in case day changed
    return data;
  }
  throw new Error(data.error || 'save failed');
}

// ==========================================
//  Save button (immediate persist, no clipboard)
// ==========================================

async function handleSave() {
  var saveBtn = document.getElementById('btn-save');
  var origText = saveBtn.textContent;
  saveBtn.textContent = '⏳ 保存中...';
  saveBtn.disabled = true;
  try {
    await submitToBackend();
    showToast('💾 已保存');
    showAutoLoadBar('📥 record#' + todayRecordId + ' (已保存)', true);
    if (navigator.vibrate) { navigator.vibrate(10); }
  } catch (err) {
    console.error('handleSave:', err);
    showToast('⚠️ 保存失败，请重试');
  } finally {
    saveBtn.textContent = origText;
    saveBtn.disabled = false;
  }
}

// ==========================================
//  Generate & Copy button
// ==========================================

async function handleGenerateCopy() {
  var rows = collectRows();
  var storeName = document.querySelector('.meta-bar__store').textContent.trim();
  var date = new Date();

  var genBtn = document.getElementById('btn-generate');
  var origText = genBtn.textContent;
  genBtn.textContent = '⏳ ...';
  genBtn.disabled = true;

  // 1. Generate text (instant, client-side), date as 2026-06-05
  var text = generateOutputText(storeName, localDateStr(date), rows);

  // 2. Copy to clipboard
  var copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (_err) {
    copied = fallbackCopy(text);
  }
  if (copied) {
    showToast('✅ 已复制到剪贴板');
    if (navigator.vibrate) { navigator.vibrate([10, 50, 10]); }
  } else {
    showToast('⚠️ 复制失败，请重试');
  }

  // 3. Save to backend
  try {
    await submitToBackend();
    showAutoLoadBar('📥 record#' + todayRecordId + ' (已保存)', true);
  } catch (err) {
    console.error('handleGenerateCopy save:', err);
  } finally {
    genBtn.textContent = origText;
    genBtn.disabled = false;
  }
}

// ==========================================
//  Output text generation
// ==========================================

function generateOutputText(storeName, dateStr, rows) {
  var lines = [storeName + ' ' + dateStr];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var qtyStr = (r.quantity && r.quantity > 0) ? String(r.quantity) : '';
    lines.push(r.category + r.spec + '枚:' + qtyStr);
  }
  return lines.join('\n');
}

// ==========================================
//  Utilities
// ==========================================

function escapeAttr(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); return true; }
  catch (_err) { return false; }
  finally { document.body.removeChild(ta); }
}

function createToastElement() {
  if (document.getElementById('toast')) return;
  var el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  document.body.appendChild(el);
}

function showToast(message, duration) {
  duration = duration || 2000;
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast--visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(function() {
    toast.classList.remove('toast--visible');
  }, duration);
}
