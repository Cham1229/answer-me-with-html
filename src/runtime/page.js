(() => {
  const root = document.documentElement;
  // Each toolbar list sets one root attribute; its options name the values, so the runtime names no theme or mode.
  for (const [name, attr] of [['theme', 'data-theme'], ['mode', 'data-mode']]) {
    const select = document.querySelector(`select[data-am="${name}"]`);
    if (!select) continue;
    select.value = root.getAttribute(attr);
    select.addEventListener('change', () => root.setAttribute(attr, select.value));
  }

  const copyBtn = document.querySelector('[data-am="copy"]');
  copyBtn?.addEventListener('click', async () => {
    const nodes = document.querySelectorAll('#am-source');
    const text = nodes[nodes.length - 1]?.value ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const original = copyBtn.textContent;
    copyBtn.textContent = copyBtn.dataset.done;
    setTimeout(() => { copyBtn.textContent = original; }, 1400);
  });

  // ── Diagram Lightbox & Pan-Zoom Viewer ─────────────
  const diagrams = document.querySelectorAll('.am-diagram');
  if (diagrams.length) {
    const lang = (root.getAttribute('lang') || 'zh').slice(0, 2);
    const I18N = {
      zh: { expand: '展开查看图表', in: '放大', out: '缩小', reset: '重置比例', close: '关闭', diagram: '图表查看', mode: '切换明暗' }, // lang-ok: viewer UI labels
      en: { expand: 'Expand diagram', in: 'Zoom in', out: 'Zoom out', reset: 'Reset zoom', close: 'Close', diagram: 'Diagram Viewer', mode: 'Toggle theme' },
      ja: { expand: '拡大表示', in: '拡大', out: '縮小', reset: '縮尺をリセット', close: '閉じる', diagram: 'ダイアグラム', mode: 'テーマ切り替え' }, // lang-ok: viewer UI labels
    };
    const t = I18N[lang] || I18N.zh;

    const lb = document.createElement('div');
    lb.className = 'am-lightbox';
    lb.setAttribute('hidden', '');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('role', 'dialog');
    lb.innerHTML = `
      <div class="am-lightbox-backdrop"></div>
      <div class="am-lightbox-header">
        <div class="am-lightbox-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          <span class="am-lightbox-title-text"></span>
        </div>
        <div class="am-lightbox-actions">
          <button class="am-lightbox-mode-btn" data-action="toggle-mode" title="${t.mode}" aria-label="${t.mode}">🌓</button>
          <button class="am-lightbox-close" data-action="close" title="${t.close}" aria-label="${t.close}">✕</button>
        </div>
      </div>
      <div class="am-lightbox-stage">
        <div class="am-lightbox-canvas am-diagram"></div>
      </div>
      <div class="am-lightbox-bar">
        <button class="am-lightbox-btn" data-action="zoom-out" title="${t.out}" aria-label="${t.out}">-</button>
        <button class="am-lightbox-scale" data-action="zoom-reset" title="${t.reset}" aria-label="${t.reset}">100%</button>
        <button class="am-lightbox-btn" data-action="zoom-in" title="${t.in}" aria-label="${t.in}">+</button>
      </div>
    `;
    document.body.append(lb);

    const backdrop = lb.querySelector('.am-lightbox-backdrop');
    const titleText = lb.querySelector('.am-lightbox-title-text');
    const stage = lb.querySelector('.am-lightbox-stage');
    const canvas = lb.querySelector('.am-lightbox-canvas');
    const scaleBtn = lb.querySelector('.am-lightbox-scale');
    const zoomInBtn = lb.querySelector('[data-action="zoom-in"]');
    const zoomOutBtn = lb.querySelector('[data-action="zoom-out"]');
    const modeBtn = lb.querySelector('.am-lightbox-mode-btn');
    const closeBtn = lb.querySelector('.am-lightbox-close');

    let scale = 1, x = 0, y = 0, fitScale = 1, curVw = 800, curVh = 600;
    let isDragging = false, didDrag = false, startX = 0, startY = 0, origX = 0, origY = 0;
    let lastTrigger = null;

    const apply = () => {
      canvas.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
      scaleBtn.textContent = `${Math.round(scale * 100)}%`;
    };

    const zoomTo = (newScale, pivotX, pivotY) => {
      newScale = Math.max(0.2, Math.min(6.0, newScale));
      if (Math.abs(newScale - scale) < 0.0001) return;
      const r = newScale / scale;
      x = pivotX - (pivotX - x) * r;
      y = pivotY - (pivotY - y) * r;
      scale = newScale;
      apply();
    };

    const open = (diag, trigger) => {
      const svg = diag.querySelector('svg');
      if (!svg) return;
      lastTrigger = trigger;

      const panel = diag.closest('.am-panel');
      const panelTitle = panel?.querySelector('.am-panel-head h2')?.textContent?.trim() || panel?.querySelector('h2')?.textContent?.trim() || t.diagram;
      if (titleText) titleText.textContent = panelTitle;

      const clone = svg.cloneNode(true);
      const vb = svg.viewBox?.baseVal;
      curVw = (vb && vb.width > 0) ? vb.width : (parseFloat(svg.getAttribute('width')) || svg.clientWidth || 800);
      curVh = (vb && vb.height > 0) ? vb.height : (parseFloat(svg.getAttribute('height')) || svg.clientHeight || 600);
      clone.style.width = `${curVw}px`;
      clone.style.height = `${curVh}px`;
      canvas.innerHTML = '';
      canvas.append(clone);
      lb.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';

      const rect = stage.getBoundingClientRect();
      const pad = 48;
      const availW = Math.max(100, rect.width - pad * 2);
      const availH = Math.max(100, rect.height - pad * 2);
      fitScale = Math.min(availW / curVw, availH / curVh, 1.0);
      scale = fitScale;
      x = (rect.width - curVw * scale) / 2;
      y = (rect.height - curVh * scale) / 2;
      apply();
      closeBtn.focus();
    };

    const close = () => {
      if (lb.hasAttribute('hidden')) return;
      lb.setAttribute('hidden', '');
      canvas.innerHTML = '';
      document.body.style.overflow = '';
      lastTrigger?.focus();
    };

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
      zoomTo(scale * factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      origX = x;
      origY = y;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('am-panning');
    });

    stage.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 4) didDrag = true;
      x = origX + dx;
      y = origY + dy;
      apply();
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      stage.classList.remove('am-panning');
      try { stage.releasePointerCapture(e.pointerId); } catch {}
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    stage.addEventListener('dblclick', () => {
      const rect = stage.getBoundingClientRect();
      scale = fitScale;
      x = (rect.width - curVw * scale) / 2;
      y = (rect.height - curVh * scale) / 2;
      apply();
    });

    scaleBtn.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect();
      scale = (Math.abs(scale - fitScale) < 0.05 && fitScale < 0.95) ? 1.0 : fitScale;
      x = (rect.width - curVw * scale) / 2;
      y = (rect.height - curVh * scale) / 2;
      apply();
    });

    zoomInBtn.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect();
      zoomTo(scale * 1.25, rect.width / 2, rect.height / 2);
    });

    zoomOutBtn.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect();
      zoomTo(scale / 1.25, rect.width / 2, rect.height / 2);
    });

    modeBtn?.addEventListener('click', () => {
      const modes = ['auto', 'light', 'dark'];
      const cur = root.getAttribute('data-mode') || 'auto';
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      root.setAttribute('data-mode', next);
      const modeSelect = document.querySelector('select[data-am="mode"]');
      if (modeSelect) modeSelect.value = next;
    });

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lb.hasAttribute('hidden')) close();
    });

    const expandSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
    diagrams.forEach((diag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'am-diagram-expand';
      btn.title = t.expand;
      btn.setAttribute('aria-label', t.expand);
      btn.innerHTML = expandSvg;
      btn.addEventListener('click', () => open(diag, btn));
      diag.append(btn);
    });
  }
})();
