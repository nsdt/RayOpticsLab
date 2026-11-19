/* Bilingual presentation adapter. It never edits input values, configuration or pixels.
 * WeakMap records preserve original messages across dynamic UI updates and language changes.
 * Message pairs are explicit translations; optical kernels do not depend on this module. */
(function (root) {
  'use strict';
  // Earlier versions also saved auto-detected languages. Ignore those legacy values.
  const languagePreferenceKey = 'ray-optics-language-choice';
  const normalize = (s) => s.replace(/\s+/g, ' ').trim(),
    escape = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const exact = new Map(),
    patterns = [],
    fragments = [];
  for (const [source, english] of root.UIEnglish) {
    const key = normalize(source);
    if (key.includes('$' + '{')) {
      const pieces = key.split(/\$\{[^}]*\}/g);
      if (pieces.length > 1 && english.includes('{0}'))
        patterns.push([
          new RegExp(
            '^' + pieces.map(escape).join('(.*?)') + (pieces[pieces.length - 1] ? '' : '$'),
          ),
          english,
        ]);
    } else {
      exact.set(key, english);
      if (key.length > 1 || /[球正負左右回本秒]/.test(key)) fragments.push(key);
    }
  }
  fragments.sort((a, b) => b.length - a.length);
  const fragmentRE = new RegExp([...new Set(fragments)].map(escape).join('|'), 'g');
  let language = 'en',
    initialized = false,
    observer,
    scheduled = false;
  const records = new WeakMap(),
    attributeRecords = new WeakMap(),
    excluded = 'script,style,code,pre,textarea,.help-source,[translate="no"],[data-own-i18n]';
  function translate(text) {
    if (language === 'ja' || typeof text !== 'string') return text;
    const key = normalize(text);
    if (exact.has(key))
      return (
        text.slice(0, text.length - text.trimStart().length) +
        exact.get(key) +
        text.slice(text.trimEnd().length)
      );
    for (const [pattern, english] of patterns) {
      const match = key.match(pattern);
      if (match)
        return (
          english.replace(/\{(\d+)\}/g, (_, i) => translate(match[Number(i) + 1] || '')) +
          translate(key.slice(match[0].length))
        );
    }
    return text.replace(fragmentRE, (m) => exact.get(m));
  }
  function nodeText(node) {
    const actual = node.nodeValue,
      prior = records.get(node);
    const source = prior && actual === prior.last ? prior.source : actual;
    const last = translate(source);
    records.set(node, { source, last });
    if (actual !== last) node.nodeValue = last;
  }
  function attributes(el) {
    let values = attributeRecords.get(el);
    if (!values) {
      values = {};
      attributeRecords.set(el, values);
    }
    for (const name of ['title', 'aria-label', 'placeholder', 'alt', 'label']) {
      if (!el.hasAttribute(name)) continue;
      const actual = el.getAttribute(name),
        prior = values[name],
        source = prior && actual === prior.last ? prior.source : actual,
        last = translate(source);
      values[name] = { source, last };
      if (actual !== last) el.setAttribute(name, last);
    }
  }
  function scan() {
    scheduled = false;
    observer?.disconnect();
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const el = node.nodeType === 1 ? node : node.parentElement;
          return el?.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node = walker.currentNode;
    do {
      if (node.nodeType === 3) nodeText(node);
      else if (node.nodeType === 1) attributes(node);
    } while ((node = walker.nextNode()));
    observer?.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'label'],
    });
  }
  function sourceText(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      const r = records.get(node);
      return r && r.last === node.nodeValue ? r.source : node.nodeValue;
    }
    return Array.from(node.childNodes).map(sourceText).join('');
  }
  function sourceClone(node) {
    const clone = node.cloneNode(false);
    if (node.nodeType === 3) clone.nodeValue = sourceText(node);
    else for (const child of node.childNodes) clone.appendChild(sourceClone(child));
    return clone;
  }
  function setLanguage(value, { remember = true } = {}) {
    language = value === 'ja' ? 'ja' : 'en';
    document.documentElement.lang = language;
    if (remember) {
      try {
        localStorage.setItem(languagePreferenceKey, language);
      } catch {}
    }
    const select = document.getElementById('interfaceLanguage');
    if (select) select.value = language;
    root.ContextHelp?.closeHelp();
    document.dispatchEvent(new Event('languagechange'));
    scan();
  }
  function init() {
    if (initialized) return;
    initialized = true;
    // Start in English unless the user has already selected a language.
    try {
      const saved = localStorage.getItem(languagePreferenceKey);
      language = saved === 'ja' ? 'ja' : 'en';
    } catch {
      language = 'en';
    }
    observer = new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(scan);
      }
    });
    document
      .getElementById('interfaceLanguage')
      .addEventListener('change', (e) => setLanguage(e.target.value));
    const originalAlert = root.alert.bind(root);
    root.alert = (message) => originalAlert(translate(String(message)));
    setLanguage(language, { remember: false });
  }
  root.I18n = {
    init,
    setLanguage,
    translate,
    sourceText,
    sourceClone,
    refresh: scan,
    get language() {
      return language;
    },
  };
})(globalThis);
