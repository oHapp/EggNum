/**
 * 考勤全部记录页：查看、编辑、删除旧记录
 */
var editingAttendanceId = null;

document.addEventListener('DOMContentLoaded', function() {
  loadAttendanceHistory();
});

function loadAttendanceHistory() {
  var el = document.getElementById('att-history-list');
  el.innerHTML = '<div class="att-empty">加载中...</div>';

  fetch('/api/attendance-history', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      renderAttendanceHistory(data.groups || []);
    })
    .catch(function(err) {
      console.error('attendance history:', err);
      el.innerHTML = '<div class="att-empty">加载失败，请重试</div>';
    });
}

function renderAttendanceHistory(groups) {
  var el = document.getElementById('att-history-list');
  if (!groups.length) {
    el.innerHTML = '<div class="att-empty">暂无记录</div>';
    return;
  }

  var html = '';
  groups.forEach(function(group) {
    html += '<div class="att-day">' +
      '<div class="att-day__head">' +
        '<span>' + escapeHtml(group.date) + '</span>' +
        '<span class="att-day__total">' + Number(group.total || 0).toFixed(1) + 'h</span>' +
      '</div>';

    group.entries.forEach(function(entry) {
      html += renderAttendanceEntry(entry);
    });

    html += '</div>';
  });

  el.innerHTML = html;
  bindAttendanceHistoryActions();
}

function renderAttendanceEntry(entry) {
  return '<div class="att-entry att-entry--editable" data-id="' + entry.id + '">' +
    '<div class="att-entry__main">' +
      '<span class="att-entry__time">' + escapeHtml(entry.time_start) + '-' + escapeHtml(entry.time_end) + '</span>' +
      '<span class="att-entry__hours">' + Number(entry.hours || 0).toFixed(1) + 'h</span>' +
      (entry.note ? '<span class="att-entry__note">' + escapeHtml(entry.note) + '</span>' : '') +
    '</div>' +
    '<div class="att-entry__actions">' +
      '<button type="button" class="att-entry__edit" data-id="' + entry.id + '">编辑</button>' +
      '<button type="button" class="att-entry__del" data-id="' + entry.id + '">✕</button>' +
    '</div>' +
    '<div class="att-entry-editor" style="display:none;">' +
      '<input type="date" class="att-edit-date" value="' + escapeAttr(entry.record_date) + '">' +
      '<input type="time" class="att-edit-start" value="' + escapeAttr(entry.time_start) + '">' +
      '<span class="att-edit-sep">至</span>' +
      '<input type="time" class="att-edit-end" value="' + escapeAttr(entry.time_end) + '">' +
      '<span class="att-edit-hours">' + Number(entry.hours || 0).toFixed(1) + 'h</span>' +
      '<input type="text" class="att-edit-note" value="' + escapeAttr(entry.note || '') + '" placeholder="备注">' +
      '<button type="button" class="att-edit-save" data-id="' + entry.id + '">保存</button>' +
      '<button type="button" class="att-edit-cancel" data-id="' + entry.id + '">取消</button>' +
    '</div>' +
  '</div>';
}

function bindAttendanceHistoryActions() {
  document.querySelectorAll('.att-entry__edit').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openAttendanceEditor(btn.dataset.id);
    });
  });

  document.querySelectorAll('.att-entry__del').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteAttendanceEntry(btn.dataset.id);
    });
  });

  document.querySelectorAll('.att-edit-save').forEach(function(btn) {
    btn.addEventListener('click', function() {
      saveAttendanceEntry(btn.dataset.id);
    });
  });

  document.querySelectorAll('.att-edit-cancel').forEach(function(btn) {
    btn.addEventListener('click', function() {
      closeAttendanceEditor(btn.dataset.id);
    });
  });

  document.querySelectorAll('.att-entry-editor').forEach(function(editor) {
    editor.addEventListener('change', function(e) {
      if (e.target.classList.contains('att-edit-start') || e.target.classList.contains('att-edit-end')) {
        updateEditorHours(editor);
      }
    });
  });
}

function openAttendanceEditor(id) {
  if (editingAttendanceId && editingAttendanceId !== id) {
    closeAttendanceEditor(editingAttendanceId);
  }

  var row = document.querySelector('.att-entry[data-id="' + id + '"]');
  if (!row) return;

  editingAttendanceId = id;
  row.classList.add('att-entry--editing');
  row.querySelector('.att-entry__main').style.display = 'none';
  row.querySelector('.att-entry__actions').style.display = 'none';
  row.querySelector('.att-entry-editor').style.display = 'grid';
  updateEditorHours(row.querySelector('.att-entry-editor'));
}

function closeAttendanceEditor(id) {
  var row = document.querySelector('.att-entry[data-id="' + id + '"]');
  if (!row) return;

  row.classList.remove('att-entry--editing');
  row.querySelector('.att-entry__main').style.display = '';
  row.querySelector('.att-entry__actions').style.display = '';
  row.querySelector('.att-entry-editor').style.display = 'none';
  if (editingAttendanceId === id) editingAttendanceId = null;
}

function saveAttendanceEntry(id) {
  var row = document.querySelector('.att-entry[data-id="' + id + '"]');
  if (!row) return;

  var editor = row.querySelector('.att-entry-editor');
  var recordDate = editor.querySelector('.att-edit-date').value;
  var start = editor.querySelector('.att-edit-start').value;
  var end = editor.querySelector('.att-edit-end').value;
  var note = editor.querySelector('.att-edit-note').value.trim();

  if (!recordDate || !start || !end) {
    alert('请填写日期和时间');
    return;
  }

  var hours = calcAttendanceHours(start, end);
  fetch('/api/attendance/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record_date: recordDate,
      time_start: start,
      time_end: end,
      hours: hours,
      note: note
    }),
    cache: 'no-store'
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (!resp.ok || !data.success) {
        throw new Error(data.error || '保存失败');
      }
      editingAttendanceId = null;
      loadAttendanceHistory();
    });
  }).catch(function(err) {
    alert(err.message || '保存失败');
  });
}

function deleteAttendanceEntry(id) {
  if (!confirm('删除这条考勤记录？')) return;

  fetch('/api/attendance/' + id, {
    method: 'DELETE',
    cache: 'no-store'
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (!resp.ok || !data.success) {
        throw new Error(data.error || '删除失败');
      }
      loadAttendanceHistory();
    });
  }).catch(function(err) {
    alert(err.message || '删除失败');
  });
}

function updateEditorHours(editor) {
  var start = editor.querySelector('.att-edit-start').value;
  var end = editor.querySelector('.att-edit-end').value;
  var el = editor.querySelector('.att-edit-hours');
  if (!start || !end) {
    el.textContent = '0h';
    return;
  }
  el.textContent = calcAttendanceHours(start, end).toFixed(1) + 'h';
}

function calcAttendanceHours(start, end) {
  var sm = timeToMinutes(start);
  var em = timeToMinutes(end);
  if (em <= sm) em += 1440;
  return Math.round((em - sm) / 6) / 10;
}

function timeToMinutes(value) {
  var parts = value.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
