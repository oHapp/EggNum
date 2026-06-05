/**
 * Dev panel — triple-click version footer to toggle
 */
document.addEventListener('DOMContentLoaded', function() {
  var footer = document.querySelector('footer');
  if (!footer) return;

  var panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = 'display:none;background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:12px;margin-top:8px;font-size:13px;';
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:6px;">🔧 Dev Tools</div>' +
    '<label>模拟日期: <input type="date" id="dev-date-input" style="font-size:14px;padding:4px;border-radius:4px;border:1px solid #ccc;"></label> ' +
    '<button id="dev-date-reset" style="padding:4px 10px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer;">重置</button> ' +
    '<span id="dev-date-status" style="color:#e65100;margin-left:6px;"></span>';
  footer.parentNode.insertBefore(panel, footer.nextSibling);

  // Init
  var override = localStorage.getItem('eggnum_dev_date');
  if (override) {
    document.getElementById('dev-date-input').value = override;
    document.getElementById('dev-date-status').textContent = '(生效中)';
    if (typeof updateDateDisplay === 'function') updateDateDisplay();
  }

  // Date change
  document.getElementById('dev-date-input').addEventListener('change', function() {
    var val = this.value;
    if (val) {
      localStorage.setItem('eggnum_dev_date', val);
      document.getElementById('dev-date-status').textContent = '(生效中)';
    } else {
      localStorage.removeItem('eggnum_dev_date');
      document.getElementById('dev-date-status').textContent = '';
    }
    if (typeof updateDateDisplay === 'function') updateDateDisplay();
    // Reload data with new date
    if (typeof pageReady !== 'undefined') { pageReady = false; }
    if (typeof autoLoadToday === 'function') autoLoadToday();
    if (typeof loadReserve === 'function') loadReserve();
  });

  // Reset
  document.getElementById('dev-date-reset').addEventListener('click', function() {
    localStorage.removeItem('eggnum_dev_date');
    document.getElementById('dev-date-input').value = '';
    document.getElementById('dev-date-status').textContent = '';
    if (typeof updateDateDisplay === 'function') updateDateDisplay();
    if (typeof pageReady !== 'undefined') { pageReady = false; }
    if (typeof autoLoadToday === 'function') autoLoadToday();
    if (typeof loadReserve === 'function') loadReserve();
  });

  // Triple-click footer to toggle
  var clicks = 0;
  var timer = null;
  footer.addEventListener('click', function() {
    clicks++;
    if (clicks === 1) {
      timer = setTimeout(function() { clicks = 0; }, 500);
    } else if (clicks === 3) {
      clearTimeout(timer);
      clicks = 0;
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
  });
});
