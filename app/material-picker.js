/* Catalog filtering is UI state: it never changes the active optical scene. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let readConfig,
    lastSignature = '';
  const normalized = (text) => text.normalize('NFKC').toLocaleLowerCase().trim();
  function matches(p, query) {
    const model = MaterialCatalog.models[p.values.material];
    return normalized(
      [
        p.id,
        p.label,
        p.group,
        model.label,
        MaterialCatalog.types[model.type],
        root.I18n?.translate(
          [p.label, p.group, model.label, MaterialCatalog.types[model.type]].join(' '),
        ),
      ].join(' '),
    ).includes(query);
  }
  function sync(c) {
    if (!$('presetSearch')) return;
    const query = normalized($('presetSearch').value),
      signature = JSON.stringify([query, c.preset, root.I18n?.language]);
    if (signature === lastSignature) {
      $('preset').value = c.preset;
      return;
    }
    lastSignature = signature;
    const presets = MaterialCatalog.presets,
      matching = presets.filter((p) => matches(p, query)),
      select = $('preset');
    select.replaceChildren(new Option('任意指定：モデルとパラメータを選ぶ', 'custom'));
    for (const name of [...new Set(matching.map((p) => p.group))]) {
      const group = document.createElement('optgroup');
      group.label = name;
      for (const p of matching.filter((p) => p.group === name))
        group.append(new Option(p.label, p.id));
      select.append(group);
    }
    if (c.preset !== 'custom' && !matching.some((p) => p.id === c.preset)) {
      const current = presets.find((p) => p.id === c.preset);
      if (current) {
        const group = document.createElement('optgroup');
        group.label = '現在の媒質（検索結果とは別）';
        group.append(new Option(current.label, current.id));
        select.append(group);
      }
    }
    select.value = c.preset;
    $('presetMatches').textContent = query
      ? matching.length
        ? matching.length + '件の候補。選択するまで媒質は変わりません。'
        : '一致する候補がありません。検索語を変えてください。'
      : '';
    $('presetMatches').hidden = !query;
    $('clearPresetSearch').hidden = !query;
  }
  function init(getConfig) {
    readConfig = getConfig;
    const search = document.createElement('div');
    search.className = 'preset-search';
    const label = document.createElement('label');
    label.textContent = '媒質のプリセットを検索';
    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'presetSearch';
    input.placeholder = '例：BK7、calcite、radial';
    input.autocomplete = 'off';
    label.append(input);
    const clear = document.createElement('button');
    clear.id = 'clearPresetSearch';
    clear.type = 'button';
    clear.textContent = '検索をクリア';
    clear.hidden = true;
    const count = document.createElement('p');
    count.id = 'presetMatches';
    count.className = 'compact-status';
    count.setAttribute('role', 'status');
    count.hidden = true;
    search.append(label, clear, count);
    $('preset').closest('label').before(search);
    input.addEventListener('input', () => sync(readConfig()));
    clear.onclick = () => {
      input.value = '';
      sync(readConfig());
      input.focus();
    };
    document.addEventListener('languagechange', () => sync(readConfig()));
    sync(readConfig());
  }
  root.MaterialPicker = { init, sync };
})(globalThis);
