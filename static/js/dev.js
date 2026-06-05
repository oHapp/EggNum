/**
 * Dev panel — triple-click version footer to toggle
 */
document.addEventListener('DOMContentLoaded', function() {
  var footer = document.querySelector('footer');
  if (!footer) return;

  var panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = 'display:none;background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:12px;margin-top:8px;font-size:13px;';
  panel.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">🔧 Dev Tools</div>' +
    '<div style="color:#888;">日期切换请点击上方日期标签。其他调试工具待添加。</div>';
  footer.parentNode.insertBefore(panel, footer.nextSibling);

  // Triple-click footer to toggle
  var clicks = 0;
  var timer = null;
  footer.addEventListener('click', function() {
    clicks++;
    if (clicks === 1) timer = setTimeout(function() { clicks = 0; }, 500);
    else if (clicks === 3) { clearTimeout(timer); clicks = 0; panel.style.display = panel.style.display === 'none' ? '' : 'none'; }
  });
});
