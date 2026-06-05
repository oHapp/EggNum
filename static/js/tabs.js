/**
 * Tab switching between 出库登记 and 库存留存
 */
document.addEventListener('DOMContentLoaded', function() {
  var btns = document.querySelectorAll('.tab-btn');
  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tab = btn.dataset.tab;

      // Toggle active button
      btns.forEach(function(b) { b.classList.remove('tab-btn--active'); });
      btn.classList.add('tab-btn--active');

      // Toggle visible page
      document.querySelectorAll('.tab-page').forEach(function(p) { p.style.display = 'none'; });
      document.getElementById('tab-' + tab).style.display = '';

      // When switching to report, refresh date display
      if (tab === 'report' && typeof updateDateDisplay === 'function') {
        updateDateDisplay();
      }
    });
  });
});
