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
    '<div style="color:#888;font-size:12px;">日期切换请点击上方日期标签。</div>' +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;">' +
    '<input type="checkbox" id="dev-offline">' +
    '📴 模拟离线（测试保存重试）</label>';
  footer.parentNode.insertBefore(panel, footer.nextSibling);

  // Offline toggle — intercepts fetch + sendBeacon to simulate network failure
  var offlineActive = false;
  var origFetch = window.fetch;
  var origBeacon = navigator.sendBeacon;
  document.getElementById('dev-offline').addEventListener('change', function() {
    offlineActive = this.checked;
    if (offlineActive) {
      window.fetch = function() {
        return Promise.reject(new Error('Simulated offline'));
      };
      navigator.sendBeacon = function() { return false; };
      if (typeof showToast === 'function') showToast('📴 已切换为离线模式', 2000);
    } else {
      window.fetch = origFetch;
      navigator.sendBeacon = origBeacon;
      if (typeof showToast === 'function') showToast('🌐 已恢复在线模式', 2000);
    }
  });

  // Triple-click footer to toggle
  var clicks = 0;
  var timer = null;
  footer.addEventListener('click', function() {
    clicks++;
    if (clicks === 1) timer = setTimeout(function() { clicks = 0; }, 500);
    else if (clicks === 3) { clearTimeout(timer); clicks = 0; panel.style.display = panel.style.display === 'none' ? '' : 'none'; }
  });
});
