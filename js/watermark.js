/**
 * 著作權浮水印：在頁面角落顯示「Created by …」標示。
 *
 * 用法：<script src="js/watermark.js" defer></script>
 * 可在 script 標籤加 data- 屬性調整（都可省略）：
 *   data-text      顯示文字，預設「Created by 祐誠老師」
 *   data-position  bottom-right（預設）、bottom-left、top-right、top-left
 *   data-offset-x  離左右邊的距離（CSS 長度），預設 12px
 *   data-offset-y  離上下邊的距離（CSS 長度），預設 12px；要避開底部按鈕列時加大
 *   data-size      字級（CSS 長度），預設 14px
 *   data-opacity   透明度 0～1，預設 0.85
 *
 * 浮水印不攔截點擊（pointer-events: none），不影響頁面操作。
 * 注意：這只是作者標示，懂網頁的人仍可用開發者工具移除，無法真正防盜。
 */
(function () {
  var script = document.currentScript;
  var data = (script && script.dataset) || {};

  var text = data.text || 'Created by 祐誠老師';
  var position = /^(top|bottom)-(left|right)$/.test(data.position || '') ? data.position : 'bottom-right';
  var parts = position.split('-');
  var offsetX = data.offsetX || '12px';
  var offsetY = data.offsetY || '12px';
  var size = data.size || '14px';
  var opacity = isFinite(parseFloat(data.opacity)) ? data.opacity : '0.85';

  function mount() {
    if (document.querySelector('.cw-watermark')) return;
    var el = document.createElement('div');
    el.className = 'cw-watermark';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = text; // 用 textContent，不用 innerHTML

    var s = el.style;
    s.position = 'fixed';
    s[parts[0]] = offsetY;
    s[parts[1]] = offsetX;
    s.zIndex = '2147483000';
    s.pointerEvents = 'none';
    s.userSelect = 'none';
    s.webkitUserSelect = 'none';
    s.padding = '0.35em 0.9em';
    s.borderRadius = '999px';
    s.background = 'rgba(38, 48, 54, 0.92)';
    s.border = '1px solid rgba(255, 255, 255, 0.28)';
    s.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.25)';
    s.color = '#FFFFFF';
    s.font = '700 ' + size + '/1.2 "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    s.letterSpacing = '0.02em';
    s.whiteSpace = 'nowrap';
    s.opacity = opacity;
    document.body.appendChild(el);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
