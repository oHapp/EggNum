/**
 * Tab switching between 出库登记, 库存留存, 考勤
 */
document.addEventListener('DOMContentLoaded', function() {
  // Restore last active tab
  try {
    var savedTab = sessionStorage.getItem('eggnum_tab');
    if (savedTab) {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('tab-btn--active'); });
      var target = document.querySelector('.tab-btn[data-tab="' + savedTab + '"]');
      if (target) { target.classList.add('tab-btn--active'); }
      document.querySelectorAll('.tab-page').forEach(function(p) { p.style.display = 'none'; });
      var page = document.getElementById('tab-' + savedTab);
      if (page) page.style.display = '';
    }
  } catch(e) {}

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

      // Remember which tab for when user returns
      try { sessionStorage.setItem('eggnum_tab', tab); } catch(e) {}

      // When switching, refresh cross-tab hints
      if (tab === 'report' && typeof updateDateDisplay === 'function') {
        updateDateDisplay();
      }
      if (typeof refreshReportHints === 'function') refreshReportHints();
      if (typeof refreshReserveHints === 'function') refreshReserveHints();
      if (typeof updateReportTotals === 'function') updateReportTotals();
      if (typeof updateReserveTotals === 'function') updateReserveTotals();
    });
  });
});
