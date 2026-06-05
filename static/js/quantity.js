/**
 * 加减按钮控制器 — QuantityController
 *
 * 防误触策略（用户指定）：
 *   按下 < 200ms 且移动 < 8px → 计入点击，增加/减少数量
 *   按下 >= 200ms 或有明显移动 → 忽略（当作滑动/长按）
 */

// ── Press duration & movement thresholds ──
var TAP_MAX_DURATION = 200;  // ms — longer than this = ignored
var TAP_MAX_MOVEMENT = 8;    // px — movement beyond this = ignored


function QuantityController(rowElement) {
  this.row      = rowElement;
  this.display  = rowElement.querySelector('.qty-display');
  this.btnMinus = rowElement.querySelector('.btn-minus');
  this.btnPlus  = rowElement.querySelector('.btn-plus');
  this.min      = 0;
  this.max      = 999;
  this._lastValidValue = 0;

  this._pressStartTime = 0;
  this._pressStartX = 0;
  this._pressStartY = 0;
  this._pressTarget = null;

  this._bindEvents();
  this._syncEmptyState();
}

QuantityController.prototype._bindEvents = function() {
  var self = this;

  // ── [+] button: pointerdown records, pointerup decides ──
  this.btnPlus.addEventListener('pointerdown', function(e) {
    self._pressStart(e, 'plus');
  });
  this.btnPlus.addEventListener('pointerup', function(e) {
    self._pressEnd(e, 'plus');
  });
  this.btnPlus.addEventListener('pointercancel', function() {
    self._pressCancel();
  });

  // ── [-] button ──
  this.btnMinus.addEventListener('pointerdown', function(e) {
    self._pressStart(e, 'minus');
  });
  this.btnMinus.addEventListener('pointerup', function(e) {
    self._pressEnd(e, 'minus');
  });
  this.btnMinus.addEventListener('pointercancel', function() {
    self._pressCancel();
  });

  // blur: sanitize manual input
  this.display.addEventListener('blur', function() { self._sanitizeValue(); });

  // Enter key
  this.display.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); self.display.blur(); }
  });

  // Prevent text selection on buttons
  this.btnMinus.addEventListener('selectstart', function(e) { e.preventDefault(); });
  this.btnPlus.addEventListener('selectstart', function(e) { e.preventDefault(); });
};

// ── Press tracking ──

QuantityController.prototype._pressStart = function(e, which) {
  this._pressStartTime = Date.now();
  this._pressStartX = e.clientX;
  this._pressStartY = e.clientY;
  this._pressTarget = which;
};

QuantityController.prototype._pressEnd = function(e, which) {
  if (this._pressTarget !== which) { this._pressCancel(); return; }

  var elapsed = Date.now() - this._pressStartTime;
  var dx = Math.abs(e.clientX - this._pressStartX);
  var dy = Math.abs(e.clientY - this._pressStartY);

  this._pressTarget = null;

  // Reject: too long or moved too much
  if (elapsed >= TAP_MAX_DURATION || dx > TAP_MAX_MOVEMENT || dy > TAP_MAX_MOVEMENT) {
    return;
  }

  // Accept: it's a deliberate tap
  e.preventDefault();
  if (which === 'plus') {
    this.increment();
  } else {
    this.decrement();
  }
  this._hapticFeedback();
};

QuantityController.prototype._pressCancel = function() {
  this._pressTarget = null;
};

// ── Core methods ──

QuantityController.prototype.getValue = function() {
  var raw = this.display.value.trim();
  if (raw === '') return 0;
  var n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
};

QuantityController.prototype.setValue = function(val) {
  var clamped = Math.max(this.min, Math.min(this.max, val));
  this.display.value = clamped;
  this._lastValidValue = clamped;
  this._syncEmptyState();
};

QuantityController.prototype.increment = function() {
  this.setValue(this.getValue() + 1);
  this._animateButton(this.btnPlus);
};

QuantityController.prototype.decrement = function() {
  if (this.getValue() > 0) {
    this.setValue(this.getValue() - 1);
    this._animateButton(this.btnMinus);
  }
};

// ── Helpers ──

QuantityController.prototype._sanitizeValue = function() {
  var raw = this.display.value.trim();
  if (raw === '') { this.setValue(0); return; }
  if (!/^\d+$/.test(raw)) { this.setValue(this._lastValidValue || 0); return; }
  var n = parseInt(raw, 10);
  if (n < this.min) { this.setValue(this.min); }
  else if (n > this.max) { this.setValue(this.max); }
  else { this._lastValidValue = n; this.setValue(n); }
};

QuantityController.prototype._syncEmptyState = function() {
  var isEmpty = this.getValue() === 0;
  if (isEmpty) {
    this.row.classList.add('is-empty');
    this.display.classList.add('is-zero');
  } else {
    this.row.classList.remove('is-empty');
    this.display.classList.remove('is-zero');
  }
};

QuantityController.prototype._hapticFeedback = function() {
  if (navigator.vibrate) { navigator.vibrate(10); }
};

QuantityController.prototype._animateButton = function(btn) {
  btn.classList.add('btn-pressed');
  setTimeout(function() { btn.classList.remove('btn-pressed'); }, 100);
};
