/**
 * 历史记录页交互
 * - 查看详情 (展开/收起)
 * - 一键复制
 * - 删除 (二次确认弹窗)
 * - 批量编辑模式 (长按卡片或点击批量按钮)
 */

let batchMode = false;
let selectedIds = new Set();
let confirmCallback = null; // For modal reuse

document.addEventListener('DOMContentLoaded', () => {
  createToastElement();

  // === View detail: expand/collapse ===
  document.querySelectorAll('.btn-view').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recordId = btn.dataset.recordId;
      await toggleDetail(recordId, btn);
    });
  });

  // === Copy ===
  document.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const recordId = btn.dataset.recordId;
      await handleCopy(recordId, btn);
    });
  });

  // === Delete (single) ===
  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const recordId = btn.dataset.recordId;
      showConfirmModal(
        '确认删除',
        '删除后将无法恢复。确定要删除这条记录吗？',
        async () => {
          await handleDelete(recordId);
        }
      );
    });
  });

  // === Long-press to enter batch mode ===
  document.querySelectorAll('.history-card').forEach((card) => {
    let pressTimer;
    card.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(() => {
        enterBatchMode();
        toggleCardSelection(card);
      }, 600);
    });
    card.addEventListener('pointerup', () => clearTimeout(pressTimer));
    card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    card.addEventListener('pointercancel', () => clearTimeout(pressTimer));
  });

  // === Batch toolbar buttons ===
  document.getElementById('btn-batch-cancel')?.addEventListener('click', exitBatchMode);
  document.getElementById('btn-batch-delete')?.addEventListener('click', () => {
    if (selectedIds.size === 0) {
      showToast('⚠️ 请先选择要删除的记录');
      return;
    }
    showConfirmModal(
      '批量删除',
      `确定要删除已选的 <strong>${selectedIds.size}</strong> 条记录吗？删除后无法恢复。`,
      async () => {
        await handleBatchDelete();
      }
    );
  });

  // === Modal cancel ===
  document.getElementById('btn-confirm-cancel')?.addEventListener('click', hideConfirmModal);

  // === Modal confirm (FIXED: capture callback before hiding) ===
  document.getElementById('btn-confirm-ok')?.addEventListener('click', async () => {
    if (!confirmCallback) return;
    // ★ Key fix: save callback reference BEFORE hideConfirmModal nullifies it
    const cb = confirmCallback;
    hideConfirmModal();
    try {
      await cb();
    } catch (err) {
      console.error('确认操作失败:', err);
      showToast('⚠️ 操作失败');
    }
  });

  // === Click overlay to close modal ===
  document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      hideConfirmModal();
    }
  });
});

// ==========================================
//  View Detail
// ==========================================

async function toggleDetail(recordId, btn) {
  const detailEl = document.querySelector(`[data-detail-id="${recordId}"]`);
  if (!detailEl) return;

  const isOpen = detailEl.style.display !== 'none';

  if (isOpen) {
    // Collapse
    detailEl.style.display = 'none';
    btn.textContent = '👁 查看';
    return;
  }

  // Expand: fetch full detail
  detailEl.style.display = 'block';
  const textEl = detailEl.querySelector(`[data-detail-text-id="${recordId}"]`);
  if (textEl) textEl.textContent = '加载中...';
  btn.textContent = '👁 收起';

  try {
    const resp = await fetch(`/api/history/${recordId}`);
    const data = await resp.json();

    if (data.success && textEl) {
      textEl.textContent = data.text;
    } else if (textEl) {
      textEl.textContent = '加载失败: ' + (data.error || '未知错误');
    }
  } catch (err) {
    console.error('加载详情失败:', err);
    if (textEl) textEl.textContent = '网络错误，请重试';
  }
}

// ==========================================
//  Copy
// ==========================================

async function handleCopy(recordId, btn) {
  // Visual feedback: brief highlight, no text change (avoids layout flash)
  btn.classList.add('btn-copy--active');

  try {
    const resp = await fetch(`/api/history/${recordId}/text`);
    const data = await resp.json();

    if (!data.success) {
      showToast('⚠️ 获取文本失败');
      return;
    }

    let copied = false;
    try {
      await navigator.clipboard.writeText(data.text);
      copied = true;
    } catch (_err) {
      copied = fallbackCopy(data.text);
    }

    if (copied) {
      showToast('✅ 已复制到剪贴板');
      if (navigator.vibrate) {
        navigator.vibrate([10, 50, 10]);
      }
    } else {
      showToast('⚠️ 复制失败');
    }
  } catch (err) {
    console.error('复制失败:', err);
    showToast('⚠️ 网络错误');
  } finally {
    btn.classList.remove('btn-copy--active');
  }
}

// ==========================================
//  Delete (single)
// ==========================================

async function handleDelete(recordId) {
  try {
    const resp = await fetch(`/api/history/${recordId}`, { method: 'DELETE' });
    const data = await resp.json();

    if (data.success) {
      showToast('🗑 已删除');
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
      // Remove card from DOM with animation
      const card = document.querySelector(`.history-card[data-record-id="${recordId}"]`);
      if (card) {
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
          card.remove();
          checkEmptyState();
          // Also remove parent date group if empty
          cleanupDateGroups();
        }, 250);
      }
    } else {
      showToast('⚠️ 删除失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    console.error('删除失败:', err);
    showToast('⚠️ 网络错误');
  }
}

// ==========================================
//  Batch Delete
// ==========================================

async function handleBatchDelete() {
  const ids = Array.from(selectedIds);
  let successCount = 0;
  let failCount = 0;

  for (const id of ids) {
    try {
      const resp = await fetch(`/api/history/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        successCount++;
        const card = document.querySelector(`.history-card[data-record-id="${id}"]`);
        if (card) {
          card.style.transition = 'opacity 0.2s, transform 0.2s';
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
          setTimeout(() => card.remove(), 250);
        }
      } else {
        failCount++;
      }
    } catch (err) {
      failCount++;
    }
  }

  showToast(`✅ 已删除 ${successCount} 条` + (failCount > 0 ? `，${failCount} 条失败` : ''));
  exitBatchMode();
  setTimeout(() => {
    checkEmptyState();
    cleanupDateGroups();
  }, 300);
}

// ==========================================
//  Batch Mode
// ==========================================

function enterBatchMode() {
  if (batchMode) return;
  batchMode = true;
  selectedIds.clear();

  document.querySelectorAll('.history-card__check').forEach((el) => {
    el.style.display = 'flex';
  });
  document.querySelectorAll('.history-card .batch-checkbox').forEach((cb) => {
    cb.checked = false;
    // Remove old listener first to avoid duplicates
    cb.removeEventListener('change', onCheckboxChange);
    cb.addEventListener('change', onCheckboxChange);
  });
  document.getElementById('batch-toolbar').style.display = 'flex';

  updateBatchCount();
}

function exitBatchMode() {
  batchMode = false;
  selectedIds.clear();

  document.querySelectorAll('.history-card__check').forEach((el) => {
    el.style.display = 'none';
  });
  document.querySelectorAll('.history-card .batch-checkbox').forEach((cb) => {
    cb.checked = false;
    cb.removeEventListener('change', onCheckboxChange);
  });
  document.getElementById('batch-toolbar').style.display = 'none';
}

function toggleCardSelection(card) {
  if (!batchMode) return;
  const cb = card.querySelector('.batch-checkbox');
  if (cb) {
    cb.checked = !cb.checked;
    onCheckboxChange({ target: cb });
  }
}

function onCheckboxChange(e) {
  const cb = e.target;
  const id = parseInt(cb.dataset.id);
  if (cb.checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  updateBatchCount();
}

function updateBatchCount() {
  const el = document.getElementById('batch-count');
  if (el) el.textContent = selectedIds.size;
}

// ==========================================
//  Confirm Modal
// ==========================================

function showConfirmModal(title, body, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').innerHTML = body;
  document.getElementById('confirm-modal').style.display = 'flex';
  confirmCallback = callback;

  // Focus the cancel button by default (safe choice)
  setTimeout(() => document.getElementById('btn-confirm-cancel')?.focus(), 100);
}

function hideConfirmModal() {
  document.getElementById('confirm-modal').style.display = 'none';
  confirmCallback = null;
}

function checkEmptyState() {
  const remaining = document.querySelectorAll('.history-card');
  if (remaining.length === 0) {
    // Remove all existing date groups
    document.querySelectorAll('.history-date-group').forEach((g) => g.remove());
    document.getElementById('batch-toolbar')?.remove();
    const container = document.querySelector('.container');
    // Avoid double empty state
    if (!container.querySelector('.empty-state')) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = '<p>📭 暂无历史记录</p><p style="margin-top:8px;"><a href="/" style="color:var(--color-primary);">返回首页录入</a></p>';
      container.appendChild(emptyDiv);
    }
  }
}

function cleanupDateGroups() {
  document.querySelectorAll('.history-date-group').forEach((group) => {
    const cards = group.querySelectorAll('.history-card');
    if (cards.length === 0) {
      group.remove();
    }
  });
}

// ==========================================
//  Shared utilities
// ==========================================

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
    return true;
  } catch (_err) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function createToastElement() {
  if (document.getElementById('toast')) return;
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  document.body.appendChild(el);
}

function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast--visible');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('toast--visible');
  }, duration);
}
