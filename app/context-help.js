/* Accessible contextual help shared by every settings panel. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let ready = false,
    tip,
    tipOwner,
    hideTimer;
  function element(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function closeHelp() {
    clearTimeout(hideTimer);
    if (tipOwner) {
      tipOwner.setAttribute('aria-expanded', 'false');
      tipOwner.removeAttribute('aria-describedby');
    }
    tipOwner = null;
    if (tip) tip.hidden = true;
  }
  function positionHelp() {
    if (!tipOwner) return;
    const b = tipOwner.getBoundingClientRect(),
      pad = 12;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    const right = b.right + 12;
    const left =
      right + w < innerWidth - pad ? right : Math.max(pad, Math.min(b.left, innerWidth - w - pad));
    const top = Math.max(pad, Math.min(b.bottom + 8, innerHeight - h - pad));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function help(host, name, content, extend = false) {
    if (!host) return;
    const existing = host.querySelector(':scope > .help-button');
    if (existing) {
      if (extend) existing.helpContents.push(content);
      return;
    }
    const b = element('button', 'help-button', '?');
    b.type = 'button';
    b.setAttribute('aria-label', name + 'の説明');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'contextHelp');
    b.helpContents = [content];
    const open = () => {
      clearTimeout(hideTimer);
      if (tipOwner !== b) closeHelp();
      tipOwner = b;
      tip.replaceChildren();
      const title = element('strong', null, name);
      tip.append(title);
      const body = element('div', 'help-body');
      for (const source of b.helpContents) {
        const value = source();
        if (typeof value === 'string') body.append(element('p', null, value));
        else body.append(value);
      }
      tip.append(body);
      tip.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      b.setAttribute('aria-describedby', 'contextHelp');
      root.I18n?.refresh();
      positionHelp();
    };
    b.addEventListener('mouseenter', open);
    b.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(closeHelp, 180);
    });
    b.addEventListener('focus', open);
    b.addEventListener('blur', (e) => {
      if (!tip.contains(e.relatedTarget)) closeHelp();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });
    host.append(b);
  }
  function sources(...ids) {
    return () => {
      const fragment = document.createDocumentFragment();
      for (const id of ids) {
        const src = $(id);
        if (!src?.textContent.trim()) continue;
        const p = element('p');
        for (const child of src.childNodes)
          p.append(root.I18n ? root.I18n.sourceClone(child) : child.cloneNode(true));
        p.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
        fragment.append(p);
      }
      return fragment;
    };
  }
  function caption(id) {
    const input = $(id);
    if (!input) return null;
    const label = input.closest('label');
    if (!label) return null;
    let cap = label.querySelector(':scope > .control-caption');
    if (!cap) {
      cap = element('span', 'control-caption');
      for (const node of [...label.childNodes]) {
        if (node === input || (node.nodeType === 1 && node.contains(input))) break;
        cap.append(node);
      }
      label.prepend(cap);
    }
    return cap;
  }
  function fieldHelp(id, content, name) {
    const cap = caption(id);
    help(
      cap,
      name || (root.I18n?.sourceText(cap) || cap?.textContent || '').trim() || id,
      typeof content === 'function' ? content : () => content,
    );
  }
  function fromSource(id, ...ids) {
    fieldHelp(id, sources(...ids));
    ids.forEach((key) => $(key)?.classList.add('help-source'));
  }

  function init() {
    if (ready) return;
    ready = true;
    tip = element('div', 'context-help');
    tip.id = 'contextHelp';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
    tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tip.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(closeHelp, 180);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHelp();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!tip.contains(e.target) && !e.target.closest('.help-button')) closeHelp();
    });
    window.addEventListener('resize', closeHelp);
    document.addEventListener(
      'scroll',
      () => {
        if (!tipOwner) return;
        const anchor = tipOwner.getBoundingClientRect();
        const panel = tipOwner.closest('aside')?.getBoundingClientRect();
        const top = Math.max(0, panel?.top ?? 0),
          bottom = Math.min(innerHeight, panel?.bottom ?? innerHeight);
        if (!tipOwner.isConnected || anchor.bottom < top || anchor.top > bottom) closeHelp();
        else positionHelp();
      },
      { capture: true, passive: true },
    );
  }
  root.ContextHelp = { init, help, fieldHelp, fromSource, sources, caption, closeHelp };
})(globalThis);
