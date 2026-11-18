(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let api,
    ready = false;
  const numeric = [
    'spectralMin',
    'spectralMax',
    'spectralSamples',
    'spectralReference',
    'cauchyB',
    'cauchyBo',
    'cauchyBe',
    'cauchyBx',
    'cauchyBy',
    'cauchyBz',
    'cauchyOutside',
  ];
  const helpText =
    '各波長で同じカメラ画素から独立に追跡し、D65光源とCIE 1931等色関数で強度を積分します。波長間の振幅は加えません。白・グレーは反射率が波長に依存しない背景です。従来の色付きRGB背景は使いません。閉式解・求積・RKF45と偏光の近似は各波長で引き継ぎます。途中の画像は一部の波長のみの積算で、色が偏ります。';
  function number(id, label, min, max, step) {
    return (
      '<label>' +
      label +
      '<input id="' +
      id +
      '" type="number" min="' +
      min +
      '" max="' +
      max +
      '" step="' +
      step +
      '"></label>'
    );
  }
  function init(hooks) {
    api = hooks;
    ContextHelp.init();
    const group = document.createElement('details');
    group.id = 'spectralSettings';
    group.className = 'settings-group';
    group.open = true;
    group.innerHTML =
      '<summary>3. 光源と分散</summary><div class="group-body"><label>色の計算<select id="spectralMode"><option value="off">単色の物性値で計算（RGB背景）</option><option value="on">複数波長で分散を計算（D65光源）</option></select></label><div id="spectralControls"><label>媒質の分散式<select id="spectralModel"></select></label><p id="spectralSource" class="spectral-note"></p><div class="row">' +
      number('spectralMin', '短波長端 (nm)', 380, 770, 1) +
      number('spectralMax', '長波長端 (nm)', 390, 780, 1) +
      '</div><label>追跡する波長数<select id="spectralSamples">' +
      [8, 16, 32, 64, 128, 256]
        .map(
          (n) =>
            '<option value="' +
            n +
            '">' +
            n +
            ' 波長' +
            (n === 8 ? '（粗いプレビュー）' : '') +
            '</option>',
        )
        .join('') +
      '</select></label><label>スペクトル背景<select id="spectralBackground"><option value="checker">白・濃いグレーのチェック</option><option value="landmarks">U/D/L/Rの目印（反射スペクトルを指定）</option><option value="smooth">滑らかな白黒パターン（収束確認）</option><option value="white">一様な白（強度確認）</option></select></label><div id="cauchyFields"><p id="cauchyEquation" class="spectral-note">nⱼ(λ) = nⱼ(λref) + Bⱼ (1/λ² − 1/λref²)。λはμm。媒質パラメータ欄の屈折率を基準値として使います。</p><div id="cauchyIndices"></div></div><details><summary>基準波長・外部媒質の分散</summary>' +
      number('spectralReference', 'Cauchy近似の基準波長 (nm)', 380, 1100, 0.1) +
      number('cauchyOutside', '外部 B (μm²、0なら分散なし)', -0.2, 0.2, 0.0001) +
      '<p class="spectral-note">外部屈折率の設定値を基準波長での値とします。</p></details><p id="spectralModelNote" class="spectral-note"></p><p id="spectralError" role="status"></p><p id="spectralSamplingNote" class="spectral-note">波長数を増やして収束を確認してください。特に位相差が大きい場合、32波長で十分とは限りません。</p><a href="help.html#spectral" target="_blank">計算方法・データの出典</a></div></div>';
    document.querySelector('#raySettings').before(group);
    ContextHelp.help(group.querySelector('summary'), '光源と分散', () => helpText);
    const fieldNames = {
      cauchyB: 'B (μm²)',
      cauchyBo: 'Bₒ (μm²)',
      cauchyBe: 'Bₑ (μm²)',
      cauchyBx: 'Bₓ (μm²)',
      cauchyBy: 'Bᵧ (μm²)',
      cauchyBz: 'B𝓏 (μm²)',
    };
    $('cauchyIndices').innerHTML = Object.entries(fieldNames)
      .map(([id, name]) => number(id, name, -0.2, 0.2, 0.0001))
      .join('');
    for (const id of Object.keys(Spectral.defaults))
      $(id).onchange = () => {
        api.getConfig()[id] = numeric.includes(id) ? Number($(id).value) : $(id).value;
        api.changed();
      };
    // Separate experiment, so a demo does not hide changes to the main settings.
    ContextHelp.fromSource('spectralModel', 'spectralModelNote', 'cauchyEquation');
    ContextHelp.fromSource('spectralSamples', 'spectralSamplingNote');
    ContextHelp.fieldHelp(
      'spectralBackground',
      '白・濃いグレーは波長によらない背景反射率です。従来の色付き背景は、スペクトル描画では使用しません。',
    );
    ContextHelp.fieldHelp(
      'spectralReference',
      'Cauchy近似では、媒質・外部の屈折率設定値をこの基準波長での値として扱います。メーカー分散式の基準を変える設定ではありません。',
    );
    const link = document.createElement('button');
    link.id = 'spectralDemo';
    link.textContent = '分散：N-SF11の球・白黒チェック（32波長）';
    link.onclick = () => api.demo();
    $('examplePresets').append(link);
    ready = true;
  }
  function sync(c) {
    if (!ready) return;
    for (const [k, v] of Object.entries(Spectral.defaults)) c[k] ??= v;
    const select = $('spectralModel'),
      items = [
        ['auto', '媒質プリセットの分散データ'],
        ['cauchy', '任意のCauchy近似（仮定モデル）'],
        ['constant', '屈折率の分散なし（比較用）'],
        ...Object.entries(Spectral.datasets)
          .filter(([, v]) => v.type === Spectral.family(c))
          .map(([id, v]) => [id, v.label]),
      ];
    if (!items.some(([id]) => id === c.spectralModel))
      items.push([c.spectralModel, '現在の媒質に適合しない分散式']);
    select.replaceChildren(...items.map(([id, label]) => new Option(label, id)));
    for (const k of Object.keys(Spectral.defaults)) $(k).value = c[k];
    const on = Spectral.enabled(c),
      d = Spectral.datasets[Spectral.source(c)],
      custom = c.spectralModel === 'cauchy',
      bs = {
        n: 'cauchyB',
        no: 'cauchyBo',
        ne: 'cauchyBe',
        nx: 'cauchyBx',
        ny: 'cauchyBy',
        nz: 'cauchyBz',
      };
    $('spectralControls').hidden = !on;
    $('cauchyFields').hidden = !custom;
    for (const id of Object.values(bs))
      $(id).closest('label').hidden = !Spectral.keys(c).some((k) => bs[k] === id);
    $('spectralSource').replaceChildren();
    if (d && !custom && c.spectralModel !== 'constant') {
      const link = document.createElement('a');
      link.href = d.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = d.label + ' の出典';
      $('spectralSource').append(
        link,
        document.createTextNode(
          ' · 対応 ' + d.min + '–' + d.max + ' nm。上の単色屈折率に代えて、この分散式を使います。',
        ),
      );
      try {
        $('spectralSource').append(
          document.createElement('br'),
          document.createTextNode(
            [450, 550, 650]
              .filter((nm) => nm >= d.min)
              .map(
                (nm) =>
                  nm +
                  'nm: ' +
                  Object.entries(Spectral.coefficients(c, nm))
                    .map(([k, v]) => k + '=' + v.toFixed(5))
                    .join(', '),
              )
              .join(' / '),
          ),
        );
      } catch (e) {}
    } else
      $('spectralSource').textContent = custom
        ? '測定値ではなく、指定した係数による仮定の分散です。'
        : c.spectralModel === 'constant'
          ? '物性値を全波長で固定します。位相を含む方式では位相差のみ波長とともに変わります。'
          : 'このプリセットには分散データがありません。分散式を選んでください。';
    $('spectralModelNote').textContent =
      Optics.polarization.varying(c) || Optics.polarization.isotropicGradient(c)
        ? '不均一媒質：基準屈折率のみ波長依存とし、勾配・空間分布・軸の回転率を固定する仮定です。構成式で主屈折率を固定するモデルは「分散なし」のみ選べます。'
        : '吸収・非線形応答・別経路間の画像干渉・回折は含みません。画面表示ではsRGBの範囲外をクリップします。';
    if (Spectral.family(c) === 'signed')
      $('spectralModelNote').textContent +=
        ' 双曲型媒質のCauchy近似では、誘電率の符号を保ち、その大きさに波長依存性を与えます。実在する受動媒質の分散を再現する保証はありません。';
    $('spectralError').textContent = '';
    if (on)
      try {
        Spectral.validate(c);
      } catch (e) {
        $('spectralError').textContent = e.message;
      }
    $('background').disabled = on;
    $('wavelengthNm').disabled = on;
    for (const k of Spectral.keys(c))
      for (const id of [k, k + 'Value'])
        if ($(id))
          $(id).disabled =
            c.preset !== 'custom' || (on && !['cauchy', 'constant'].includes(c.spectralModel));
    const legend = document.querySelector('.quadrant-legend');
    if (legend) legend.hidden = on;
  }
  root.SpectralUI = { init, sync };
})(globalThis);
