/* UI only: settings, tabbed experiments, and contextual help. Optical kernels
 * and comparison snapshots remain owned by their existing modules. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let ready = false,
    getConfig,
    onRenderVisible,
    active = 'render',
    lastConfig = '';
  const tabs = [
    ['render', '条件を指定して描画'],
    ['paper', '論文の数値実験'],
    ['gpu', 'CPU / GPU 比較'],
    ['trajectory', '軌道・材料の比較'],
    ['polarization', '偏光・分岐の比較'],
  ];
  function element(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  const { help, fieldHelp, fromSource, sources, caption, closeHelp } = ContextHelp;
  function show(id, focus = false) {
    if (!ready) return;
    closeHelp();
    active = tabs.some((t) => t[0] === id) ? id : 'render';
    for (const [key] of tabs) {
      const selected = key === active;
      $('panel-' + key).hidden = !selected;
      $('tab-' + key).setAttribute('aria-selected', String(selected));
      $('tab-' + key).tabIndex = selected ? 0 : -1;
    }
    document.querySelector('article').scrollTop = 0;
    document.body.classList.toggle('paper-active', active === 'paper');
    if (focus) $('tab-' + active).focus();
    if (innerWidth <= 850)
      requestAnimationFrame(() => $('tab-' + active).scrollIntoView({ block: 'nearest' }));
    if (active === 'render')
      requestAnimationFrame(() => {
        if (active === 'render') onRenderVisible?.();
      });
  }
  function demos(panel, title, ids, expanded = false) {
    const section = element('details', 'experiment-presets');
    section.open = expanded;
    section.append(element('summary', null, title));
    section.append(
      element(
        'p',
        'hint',
        'ボタンで左側の設定を読み込みます。角度を含む現在の設定が置き換わります。比較は下の実行ボタン、単独画像は「この設定を描画」で計算します。',
      ),
    );
    const list = element('div', 'preset-grid');
    for (const id of ids) {
      const b = $(id);
      if (!b) continue;
      b.textContent = b.textContent.replace(/^GPU(?:検証)?例：/, '').replace('旧比較：', '比較：');
      list.append(b);
      b.addEventListener('click', () => {
        closeHelp();
        const notice = $('notice-' + panel);
        notice.hidden = false;
        notice.textContent = I18n.sourceText($('exampleNotice'));
        sync(getConfig());
      });
    }
    section.append(list);
    $('panel-' + panel).append(section);
    return section;
  }
  function shortLabel(id, text) {
    const cap = caption(id);
    if (!cap) return;
    const b = cap.querySelector('.help-button');
    cap.replaceChildren(document.createTextNode(text));
    if (b) {
      b.setAttribute('aria-label', text + 'の説明');
      cap.append(b);
    }
  }
  function init(readConfig, repaint) {
    if (ready) return;
    getConfig = readConfig;
    onRenderVisible = repaint;
    ContextHelp.init();
    const aside = document.querySelector('aside');
    const guide = element(
      'p',
      'settings-guide',
      '形状と媒質を選び、視点や背景の条件を設定して画像を計算します。',
    );
    aside.prepend(guide);
    const jump = element('button', 'mobile-jump', '画像を確認する ↓');
    jump.type = 'button';
    jump.onclick = () => {
      show('render');
      $('panel-render').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    guide.append(jump);
    for (const id of [
      'materialSettings',
      'observationSettings',
      'spectralSettings',
      'raySettings',
      'computationSettings',
    ])
      aside.append($(id));
    $('raySettings').open = false;
    $('spectralSettings').open = false;
    const materialNote = element('p', 'compact-status');
    materialNote.id = 'materialClassNote';
    $('materialType').closest('label').after(materialNote);
    const article = document.querySelector('article'),
      original = [...article.childNodes],
      nav = element('nav', 'workspace-tabs');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '描画と実験');
    article.prepend(nav);
    for (const [id, label] of tabs) {
      const b = element('button', 'workspace-tab', label);
      b.id = 'tab-' + id;
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'panel-' + id);
      b.onclick = () => show(id);
      nav.append(b);
      const panel = element('section', 'workspace-panel');
      panel.id = 'panel-' + id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', b.id);
      panel.tabIndex = 0;
      panel.hidden = id !== 'render';
      article.append(panel);
    }
    nav.addEventListener('keydown', (e) => {
      const i = tabs.findIndex((t) => t[0] === active);
      let next;
      if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else return;
      e.preventDefault();
      show(tabs[next][0], true);
    });
    const sectionIds = ['gpuComparisonSection', 'comparisonSection', 'phaseComparisonSection'];
    for (const node of original) {
      if (node.nodeType === 1 && sectionIds.includes(node.id)) continue;
      $('panel-render').append(node);
    }
    for (const [id, title, description] of [
      [
        'gpu',
        'CPU / GPU の画像と計算量',
        '同じ材料・視点・追跡条件で、画像の差、計算時間、未追跡量を比較します。',
      ],
      [
        'trajectory',
        '軌道の計算法と材料勾配',
        'Common-scaleの勾配による見え方と、閉形式・数値求積・RKF45の一致を調べます。',
      ],
      [
        'polarization',
        '偏光輸送と分岐の近似',
        '形状、界面での相関、数値精度、光束幅・分離閾値の影響を画像と数値で比較します。',
      ],
    ]) {
      const p = $('panel-' + id);
      p.append(
        element('p', 'eyebrow', '計算結果を比較する'),
        element('h2', null, title),
        element('p', 'panel-intro', description),
      );
      const conditions = element('p', 'experiment-current');
      conditions.id = 'current-' + id;
      p.append(conditions);
      const notice = element('p', 'experiment-notice');
      notice.id = 'notice-' + id;
      notice.hidden = true;
      notice.setAttribute('role', 'status');
      p.append(notice);
    }
    demos(
      'gpu',
      '実験プリセット：材料・形状',
      [
        'spectralDemo',
        'gpuCalciteDemo',
        'gpuSphereDemo',
        'gpuTorusDemo',
        'gpuBiaxialDemo',
        'gpuGrinDemo',
        'gpuAnisotropicDemo',
      ],
      true,
    );
    demos('gpu', '実験プリセット：解析解・分岐・数値計算', [
      'gpuCommonDemo',
      'gpuShearDemo',
      'gpuModalDemo',
      'gpuPhaseDemo',
      'gpuNumericalDemo',
      'gpuRKDemo',
    ]);
    demos('trajectory', '比較条件を設定', ['commonComparisonDemo'], true);
    demos('trajectory', '単独画像で観察する材料例', [
      'grinDemo',
      'polarDemo',
      'biaxDemo',
      'commonDemo',
      'helicalDemo',
    ]);
    demos(
      'polarization',
      '比較条件を設定',
      [
        'finitePhaseDemo',
        'phaseComparisonDemo',
        'phaseCommonDemo',
        'phaseHelicalDemo',
        'phaseAxialDemo',
      ],
      true,
    );
    demos('polarization', '単独画像で観察する分配モデル', [
      'coherentDemo',
      'coherentSplitDemo',
      'modalDemo',
      'layerDemo',
      'axialBranchDemo',
      'branchDemo',
    ]);
    $('examplePresets').remove();
    for (const [id, section] of [
      ['gpu', 'gpuComparisonSection'],
      ['trajectory', 'comparisonSection'],
      ['polarization', 'phaseComparisonSection'],
    ]) {
      const p = $('panel-' + id),
        actions = element('div', 'experiment-render');
      const button = element('button', null, 'この設定を描画');
      button.type = 'button';
      button.onclick = () => {
        $('render').click();
      };
      actions.append(
        button,
        element(
          'span',
          'hint',
          '実験プリセットはアプリ用の条件です。結果と設定は比較記録として保存できます。',
        ),
      );
      p.append(actions, $(section));
    }
    const stale = element(
      'p',
      'phase-warning',
      '設定が変わっています。以下は比較開始時の条件による結果です。',
    );
    stale.id = 'comparisonStale';
    stale.hidden = true;
    $('comparisonConditions').before(stale);
    $('gpuComparisonSection').querySelector('h3').textContent = '比較の実行と結果';
    $('comparisonSection').querySelector('h3').textContent = '比較の実行と結果';
    $('phaseComparisonSection').querySelector('h3').textContent = '比較の実行と結果';
    document.querySelectorAll('a[href^="#"]').forEach((link) =>
      link.addEventListener('click', (e) => {
        const map = {
          '#gpuComparisonSection': 'gpu',
          '#comparisonSection': 'trajectory',
          '#phaseComparisonSection': 'polarization',
        };
        if (map[link.getAttribute('href')]) {
          e.preventDefault();
          show(map[link.getAttribute('href')]);
        }
      }),
    );
    // The first tab contains only the current image and its diagnostics.
    $('phaseCompareJump').classList.add('help-source');
    const summary = document.querySelector('.path-summary');
    const details = element('details', 'render-conditions');
    details.append(element('summary', null, '描画条件を確認'));
    summary.replaceWith(details);
    details.append(summary);
    $('panel-render').querySelector('.toolbar').after($('status'));
    $('status').classList.add('render-state');
    const diagnostics = element('details', 'render-diagnostics');
    diagnostics.id = 'renderDiagnostics';
    diagnostics.append(element('summary', null, '計算結果の詳細'));
    $('renderWarning').after(diagnostics);
    for (const id of ['traceStats', 'budgetPanel', 'methodStats', 'backend', 'gpuRuntime'])
      diagnostics.append($(id));
    const viewport = document.querySelector('.viewport');
    const coordinate = $('coordinateNote');
    const legend = document.querySelector('.quadrant-legend');
    const backgroundText = legend.nextElementSibling;
    backgroundText.classList.add('help-source');
    coordinate.classList.add('help-source');
    viewport.after(legend);
    help(legend, '背景と座標', () => coordinate.textContent + ' ' + backgroundText.textContent);
    const settingsActions = element('div', 'settings-actions');
    settingsActions.append(element('h3', null, '設定ファイル'));
    for (const id of ['json', 'import', 'load', 'reset']) settingsActions.append($(id));
    document.querySelector('aside').append(settingsActions);
    $('reset').textContent = '標準設定に戻す';
    $('render').textContent = 'レンダリング';
    // Replace the former image-method selector with the model-derived status.
    $('transport').closest('label').classList.add('help-source');
    $('transportGuide').classList.add('help-source');
    $('transportNote').classList.add('help-source');
    const transport = element('p', 'automatic-status');
    transport.id = 'automaticTransport';
    $('raySettings').querySelector('.group-body').prepend(transport);
    const transportText = element('span');
    transportText.id = 'automaticTransportText';
    transport.append(transportText);
    help(
      transport,
      '材料に応じた画像計算',
      sources('transportGuide', 'transportNote', 'modeDefinition'),
    );
    $('modeDefinition').classList.add('help-source');
    // Keep the automatic trajectory rule visible; manual overrides are for checks.
    const computation = $('computationSettings').querySelector('.group-body'),
      solverDetails = element('details', 'reference');
    solverDetails.id = 'solverOverrides';
    solverDetails.append(element('summary', null, '軌道計算の詳細・数値検証'));
    const solverLabel = $('solver').closest('label');
    solverLabel.before(solverDetails);
    solverDetails.append(solverLabel, $('odeControls'), $('layerSolverNote'));
    shortLabel('solver', '軌道の計算法（検証用）');
    const source = $('presetSource');
    source.classList.add('help-source');
    fromSource('preset', 'presetNote', 'presetSource');
    fromSource('material', 'note');
    $('note').closest('details').classList.add('help-source');
    const solution = $('solutionForm').parentElement;
    help(solution, '軌道の解と計算方法', sources('solutionNote'));
    $('solutionNote').classList.add('help-source');
    fromSource('transportView', 'contributionNote', 'biaxialNote', 'modeDefinition');
    fromSource('mode', 'entryNote');
    fromSource('cameraSide', 'cameraSideNote');
    fromSource('coherentInterface', 'coherentInterfaceNote');
    fromSource('commonMinOverlap', 'commonCarrierNote');
    fromSource('branchPlanes', 'planesHelp');
    fromSource('branchDepth', 'depthNote');
    fromSource('branchModel', 'branchModelNote', 'branchWeightNote', 'branchConditions');
    const branchHeading = $('branchSection').querySelector('h3');
    help(branchHeading, '媒質内部の光線', sources('branchNote', 'adiabaticNote'));
    $('branchNote').classList.add('help-source');
    $('adiabaticNote').classList.add('help-source');
    const inside = element('p', 'compact-status');
    inside.id = 'internalStatus';
    branchHeading.after(inside);
    $('branchConditions').closest('details').classList.add('help-source');
    $('orientationNote').classList.add('help-source');
    help($('orientationSection').querySelector('h3'), '軸の向き', sources('orientationNote'));
    const limits = $('transportLimits');
    limits.querySelectorAll('.row').forEach((e) => e.classList.add('single-column'));
    const helpText = {
      maxInterfaces:
        '一本の光の経路が、物体の表面に到達して反射・屈折を計算できる回数です。入口と出口もそれぞれ1回に数えます。例えば2回なら通常の一回通過までです。反射後の経路やトーラスへの再入射にも同じ上限が適用されます。上限に達した枝の重みは未追跡量に記録します。内部分岐の回数上限とは別です。',
      untracedTolerance:
        '画素ごとの入射光の重みを1とします。省略済みの重みと待機中の光線の重み（計算失敗・非伝播を含む）の合計がこの割合以下になると、計算を終了します。0%ではこの早期終了を使いません。他の上限に達すると、この目安を超えて終了することがあります。画像や光学モデル全体の誤差保証ではありません。',
      maxRayWork:
        '1画素の計算で、待機中の光線または光束を取り出して区間・界面を処理する操作の上限です。重みの大きい順に追跡します。上限で残った光は未追跡量に記録します。',
      minContribution:
        '入射光の重みを1としたとき、この値より小さい枝は追跡しません。各枝の閾値で、すべての省略量の合計上限ではありません。省いた重みを他の光へ再配分しません。',
      branchCount:
        '開始zと終了zの両端を除いて評価面を配置します。間隔は (終了z − 開始z) ÷ (面数＋1) です。面数は評価候補の数で、一本の経路が分岐する回数には別の上限があります。',
      branchPolicy:
        '位相差を省略する分配は、指定したz面で評価します。「z座標を指定」と「等間隔」のどちらか一方を使います。位相を含む方式では、z面の指定ではなく光束の重なりから分離を判断します。',
      shape:
        '形状と屈折率分布は独立です。球は半径1、立方体は各座標−1〜＋1。トーラスはy軸まわりで主半径0.72、管半径0.29。平行平板はz=−1〜＋1で側面がなく、対応する位相輸送の実験に使います。',
      materialType:
        '等方性／異方性と、均一／不均一を選びます。プリセットを選ぶと自動設定されます。等方性は光学特性が方向に依存せず、異方性は方向に依存します。均一は場所によらず、不均一は場所によって変わります。「任意指定」に切り替えると編集できます。',
      step: '軌道に沿って形状との交差や偏光の変化を確認する最大間隔です。閉形式の軌道自体を直線へ置き換える指定ではありません。ODEではRKF45がこの内側でも許容誤差に応じて刻みを調整します。',
      solver:
        '通常は「自動」のままで使います。利用条件を満たす閉形式解を優先し、積分表示は数値求積、それ以外はRKF45で解きます。SchurまたはRKF45を指定すると、閉形式と数値解の一致を検証できます。均質媒質はどの指定でも直線です。',
      wavelengthNm:
        '単色モードで偏光の位相差に使う真空波長です。複数波長の描画では「光源と分散」の各波長が使われ、この入力は無効になります。',
      lengthUnitUm:
        '座標1単位を実際の何μmとするか指定します。球の直径、立方体の一辺、平板の厚さは2単位です。位相差の計算に必要です。',
      beamRadiusUm:
        'z一定面内で、強度が中心の1/e²になる半径です。二つの解析軌道の距離から光束の重なりを近似します。回折による広がりは計算しません。',
      overlapCutoff:
        '場の重なりがこの値まで小さくなったとき、独立した光線に分けます。値が小さいほど遠く離れるまで相関を保ちます。光学モデルの近似パラメータです。',
      phaseTolerance:
        '偏光を数値積分するときの局所誤差の目安です。小さくすると計算が増えます。光線の軌道や画像全体の誤差とは別です。',
      phaseSlices:
        '偏光の数値積分を開始するときの分割数です。必要ならさらに細分化します。物理的に光線を分岐させる回数ではありません。',
      resolution:
        '画像の縦横の画素数です。大きくすると細部を観察できますが、光線数と計算時間が増えます。まず64 pxで条件を確認できます。',
      projection:
        '透視投影はカメラ位置から広がる光線を使い、平行投影は同じ方向の光線を使います。画角は透視投影だけに適用されます。',
      background:
        '単色モードで物体の奥に置く背景です。チェック模様は赤いx軸・緑のy軸と四象限の色を持ちます。複数波長の描画では「光源と分散」で選んだ白黒背景を使います。',
    };
    for (const [id, text] of Object.entries(helpText)) fieldHelp(id, text);
    // Adjacent explanatory paragraphs become contextual help. Dynamic warnings
    // and capability results remain visible rather than being hidden as prose.
    const realizationNote = $('materialRealizations').querySelector('p');
    help($('materialRealizations'), '別モデルの構成式', () => realizationNote.textContent);
    realizationNote.classList.add('help-source');
    const visibleNotes = new Set(['gpuSupportNote', 'coherentMetrics']);
    for (const p of document.querySelectorAll('aside p.hint')) {
      if (p.classList.contains('help-source') || visibleNotes.has(p.id)) continue;
      if (p.querySelector('a[href="#gpuComparisonSection"]')) {
        p.remove();
        continue;
      }
      if (p.querySelector('a[href^="./?v="]')) {
        p.remove();
        continue;
      }
      let previous = p.previousElementSibling;
      let host = previous?.matches('label')
        ? caption(previous.querySelector('input,select')?.id)
        : previous?.matches('h3,summary')
          ? previous
          : null;
      if (previous?.classList.contains('row'))
        host = caption(previous.querySelector('input,select')?.id);
      if (!host) host = p.closest('details')?.querySelector(':scope > summary');
      if (host) {
        help(host, '補足', () => p.textContent, true);
        p.classList.add('help-source');
      }
    }
    // Consolidate the static source assumption into a short status with help.
    const light = $('lightSourceNote'),
      lightBody = light.querySelector('p');
    lightBody.classList.add('help-source');
    light.querySelector('strong').textContent = '入射光：無偏光';
    help(
      light,
      '入射光の仮定',
      () => lightBody.textContent + ' 単色または複数波長の計算を「光源と分散」で選べます。',
    );
    const gpu = $('gpuSupportNote');
    gpu.classList.add('help-source');
    const gpuState = element('p', 'compact-status');
    gpuState.id = 'gpuAvailability';
    $('computeBackend').closest('label').after(gpuState);
    fieldHelp('computeBackend', sources('gpuSupportNote'));
    const observer = new MutationObserver(() => syncBackend());
    observer.observe(gpu, { childList: true, characterData: true, subtree: true });
    ready = true;
    show(location.hash.slice(1) || 'render');
    sync(getConfig());
  }
  function syncBackend() {
    if (!ready) return;
    const c = getConfig(),
      text = $('gpuSupportNote').textContent,
      s = GPUOpticsSupport.support(c);
    $('gpuAvailability').textContent =
      c.computeBackend === 'cpu'
        ? 'CPUで計算します。'
        : !s.ok
          ? 'この設定はCPUで計算します。'
          : /利用できません|取得できません|WebGPU確認：|unavailable|Could not obtain|WebGPU check:/.test(
                text,
              )
            ? 'WebGPUを利用できないためCPUで計算します。'
            : 'GPUで計算し、必要な画素はCPUで再計算します。初回は準備に時間がかかります。';
  }
  function sync(c) {
    if (!ready) return;
    closeHelp();
    const signature = JSON.stringify(c);
    if (signature !== lastConfig) {
      for (const [id] of tabs.filter((t) => !['render', 'paper'].includes(t[0])))
        $('notice-' + id).hidden = true;
      lastConfig = signature;
    }
    const model = MaterialCatalog.models[c.material];
    $('material').closest('label').hidden = model.type === 'isoUniform';
    $('params').previousElementSibling.hidden = !model.params.filter(
      (k) => !MaterialCatalog.orientationKeys.includes(k),
    ).length;
    $('customize').textContent = 'パラメータを変更する（任意指定へ）';
    $('materialClassNote').textContent = {
      isoUniform: '方向にも場所にも依存しない屈折率。',
      isoGradient: '方向には依存せず、場所によって屈折率が変化。',
      aniUniform: '方向に依存する光学特性。材料の性質は場所によらず一定。',
      aniGradient: '方向と場所によって光学特性が変化。',
    }[model.type];
    $('automaticTransportText').textContent =
      c.transport === 'polarized'
        ? '反射・屈折と明るさを自動計算'
        : '像の位置のみ（明るさの分配は対象外）';
    $('automaticTransport').classList.toggle('model-limitation', c.transport !== 'polarized');
    const supported = Optics.branching.supported(c) || Optics.polarization.coherent.selected(c),
      coherent = Optics.polarization.coherent.selected(c),
      layers = Optics.polarization.layered.enabled(c);
    $('internalStatus').textContent = !supported
      ? Optics.branching.homogeneous(c)
        ? '内部は直進。新たな分岐はありません。'
        : '内部の軌道を追跡。追加の分岐はありません。'
      : coherent
        ? '位相を保持して輸送し、光束の重なりで分離します。'
        : c.branchPolicy === 'off'
          ? '内部では光線の種類を維持します。'
          : layers
            ? '均質な層に置き換え、層境界で分配します。'
            : c.branchModel === 'modal'
              ? '指定した位置で偏光に応じて分配します。'
              : '指定した位置で各50%に分配します。';
    shortLabel('maxInterfaces', '表面に到達する回数の上限（／経路）');
    shortLabel(
      'branchDepth',
      layers
        ? '層境界での処理回数上限（／経路）'
        : coherent
          ? '光束の分離回数上限（／経路）'
          : '内部分岐の回数上限（／経路）',
    );
    // Add help to parameter fields rebuilt by app.sync().
    for (const input of document.querySelectorAll(
      '#params input[type=range],#orientation input[type=range],#camera input[type=range],#outside input[type=range]',
    )) {
      const key = input.id;
      fieldHelp(key, () =>
        ['tilt', 'azimuth', 'roll'].includes(key)
          ? $('orientationNote').textContent
          : key === 'outsideN'
            ? 'カメラ・物体・背景の外部を、指定した等方性で均一な屈折率の媒質として扱います。'
            : key === 'fov'
              ? '透視投影の画角です。平行投影では使用しません。'
              : key === 'yaw' || key === 'pitch' || key === 'backgroundZ'
                ? $('cameraSideNote').textContent
                : notesForParameter(key, c),
      );
    }
    for (const id of ['fov', 'fovValue']) $(id).disabled = c.projection !== 'perspective';
    const summary = I18n.sourceText($('sceneSummary')) + ' · ' + I18n.sourceText($('angleSummary'));
    for (const [id] of tabs.filter((t) => !['render', 'paper'].includes(t[0])))
      $('current-' + id).textContent = '左側の現在の設定：' + summary;
    if (c.solver !== 'auto' || $('odePrecision').value !== 'standard')
      $('solverOverrides').open = true;
    syncBackend();
  }
  function notesForParameter(key, c) {
    const model = MaterialCatalog.models[c.material];
    const descriptions = {
      n:
        c.material === 'isotropic'
          ? '均一な媒質の屈折率です。'
          : '屈折率分布の基準値です。分布は材料モデルの式で確認できます。',
      no:
        c.material === 'hyperbolic'
          ? '負の誘電率の絶対値の平方根です。通常の屈折率とは区別します。'
          : '常光線に対応する基準の主屈折率です。不均一媒質では材料モデルの分布に従って変化します。',
      ne: '異常光線に対応する基準の主屈折率です。異常光線の有効屈折率は進行方向にも依存します。',
      nx: '材料の第1主軸に対応する屈折率です。',
      ny: '材料の第2主軸に対応する屈折率です。',
      nz: '材料の第3主軸に対応する屈折率です。',
      gradient: '選択した材料モデルの屈折率・scale分布を調整する係数です。',
      twist: 'zに沿った光学軸の回転率です（rad／座標単位）。',
      shift: 'Coordinate-shearの座標変換の変位を調整します。',
    };
    return (
      (descriptions[key] || '材料モデルのパラメータです。') +
      '\n' +
      model.label +
      '\n' +
      $('note').textContent
    );
  }
  root.WorkspaceUI = { init, sync, show };
})(globalThis);
