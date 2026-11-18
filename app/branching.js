/* Prescribed illustrative mode conversion, not a physical mode-coupling solver. */
(function (O) {
  // Prescribed internal conversion is offered only for an actually varying two-mode medium.
  function homogeneous(c) {
    if (['isotropic', 'uniaxial', 'biaxial'].includes(c.material)) return true;
    if (
      [
        'common',
        'quadratic',
        'axial2013Uniaxial',
        'sphericalSquared',
        'radialSquared',
        'axialSquared',
        'radial',
        'axial',
      ].includes(c.material)
    )
      return Math.abs(c.gradient) < 1e-12;
    if (c.material === 'heliconical')
      return (
        Math.abs(c.twist * Math.sin((c.tilt * Math.PI) / 180)) < 1e-12 ||
        Math.abs(c.no - c.ne) < 1e-10 * Math.max(c.no, c.ne)
      );
    return false;
  }
  function supported(c) {
    if (homogeneous(c)) return false;
    if (c.material === 'axial2013Uniaxial') return true;
    return (
      ['common', 'quadratic', 'heliconical'].includes(c.material) &&
      Math.abs(c.no - c.ne) >= 1e-10 * Math.max(c.no, c.ne)
    );
  }
  const defaults = {
    branchModel: 'equal',
    branchPolicy: 'off',
    branchDepth: 2,
    branchPlanes: '-0.5, 0, 0.5',
    branchStart: -0.8,
    branchEnd: 0.8,
    branchCount: 5,
  };
  function settings(c) {
    const s = { ...defaults, ...c };
    if (!['equal', 'layers', 'modal', 'coherent'].includes(s.branchModel))
      throw Error('媒質内での強度の分配方法が不正です');
    if (!['off', 'planes', 'distributed', 'overlap'].includes(s.branchPolicy))
      throw Error('分岐位置の形式が不正です');
    if (s.branchPolicy === 'off' || !supported(s)) return { ...s, planes: [] };
    if (s.branchModel === 'coherent') return { ...s, planes: [] };
    if (s.branchPolicy === 'overlap') throw Error('光束の重なりは位相を含むモデルで使用します');
    const maxDepth = s.branchModel === 'layers' ? 12 : 6;
    if (!Number.isInteger(s.branchDepth) || s.branchDepth < 0 || s.branchDepth > maxDepth)
      throw Error('内部の最大回数は0〜' + maxDepth + 'の整数です');
    if (s.branchDepth === 0) return { ...s, planes: [] };
    let planes = [];
    if (s.branchPolicy === 'planes') {
      if (typeof s.branchPlanes !== 'string') throw Error('分岐位置はカンマ区切りです');
      planes = s.branchPlanes
        .trim()
        .split(/[,、\s]+/)
        .map(Number);
      if (
        !s.branchPlanes.trim() ||
        planes.length > 32 ||
        planes.some((v) => !Number.isFinite(v) || Math.abs(v) > 100)
      )
        throw Error('有限な分岐zを1〜32個指定してください');
    } else {
      if (!Number.isInteger(s.branchCount) || s.branchCount < 1 || s.branchCount > 32)
        throw Error('分岐面数は1〜32の整数です');
      if (
        !Number.isFinite(s.branchStart) ||
        !Number.isFinite(s.branchEnd) ||
        s.branchStart >= s.branchEnd
      )
        throw Error('分岐区間は開始z < 終了zで指定してください');
      planes = Array.from(
        { length: s.branchCount },
        (_, i) => s.branchStart + ((s.branchEnd - s.branchStart) * (i + 1)) / (s.branchCount + 1),
      );
    }
    return { ...s, planes: [...new Set(planes)].sort((a, b) => a - b) };
  }
  function traceTree(o, d, c, mode) {
    const cfg = settings(c);
    if (!supported(c) || cfg.branchPolicy === 'off' || cfg.branchDepth === 0) {
      return { ...O.trace(o, d, c, mode), branches: 0, leaves: 1, weightSum: 1, maxDepth: 0 };
    }
    const stack = [{ o, d, mode, weight: 1, depth: 0, visited: new Set(), segments: 0 }],
      leaves = [],
      events = [];
    let color = [0, 0, 0],
      drift = 0,
      branches = 0,
      maxDepth = 0,
      status = 'ok',
      weightSum = 0;
    function finish(node, result, kind) {
      maxDepth = Math.max(maxDepth, node.depth);
      color = O.add(color, O.mul(result, node.weight));
      weightSum += node.weight;
      leaves.push({ weight: node.weight, depth: node.depth, mode: node.mode, status: kind });
      if (kind !== 'ok') status = kind;
    }
    while (stack.length) {
      let node = stack.pop();
      maxDepth = Math.max(maxDepth, node.depth);
      try {
        let s = node.s,
          segments = node.segments,
          done = false;
        while (!done) {
          if (!s) {
            if (segments++ >= 6) {
              finish(node, [225, 151, 35], 'limit');
              break;
            }
            let entry = O.hit(node.o, node.d, c.shape);
            if (!entry) {
              finish(node, O.bg(node.o, node.d, c), 'ok');
              break;
            }
            let p = O.boundary(
              entry,
              O.mul(node.d, O.outsideIndex(c)),
              O.normal(entry, c.shape),
              c,
              node.mode,
              true,
            );
            if (!p) {
              finish(node, [110, 44, 116], 'no-mode');
              break;
            }
            let x = O.add(entry, O.mul(O.unit(O.velocity(entry, p, c, node.mode)), 1e-5));
            s = [...x, ...p];
          }
          let exited = false;
          for (let k = 0; k < c.maxSteps; k++) {
            let v = O.velocity(s.slice(0, 3), s.slice(3), c, node.mode),
              dt = c.step / Math.max(O.norm(v), 0.05),
              next = O.advance(s, dt, c, node.mode);
            if (!next.every(Number.isFinite)) throw Error('非有限軌道');
            let exit = null,
              exitT = Infinity;
            if (O.sdf(next.slice(0, 3), c.shape) >= 0) {
              exit = O.refineExit(s, dt, c, node.mode);
              exitT = exit.t;
            }
            let branchT = Infinity,
              which = -1;
            if (node.depth < cfg.branchDepth)
              for (let i = 0; i < cfg.planes.length; i++) {
                if (node.visited.has(i)) continue;
                let z = cfg.planes[i],
                  a = s[2] - z,
                  b = next[2] - z;
                if (Math.abs(a) < 1e-9 || (a * b <= 0 && Math.abs(b - a) > 1e-12)) {
                  let lo = 0,
                    hi = dt;
                  if (Math.abs(a) < 1e-9) hi = 0;
                  else
                    for (let j = 0; j < 28; j++) {
                      let t = (lo + hi) / 2,
                        f = O.advance(s, t, c, node.mode)[2] - z;
                      if (a * f <= 0) hi = t;
                      else lo = t;
                    }
                  let t = (lo + hi) / 2;
                  if (t < branchT) {
                    branchT = t;
                    which = i;
                  }
                }
              }
            if (
              branchT < exitT &&
              which >= 0 &&
              O.sdf(O.advance(s, branchT, c, node.mode).slice(0, 3), c.shape) < -1e-8
            ) {
              let at = O.advance(s, branchT, c, node.mode);
              at[2] = cfg.planes[which];
              let visited = new Set(node.visited);
              visited.add(which);
              branches++;
              if (c.branchDebug)
                events.push({
                  position: at.slice(0, 3),
                  depth: node.depth + 1,
                  parentWeight: node.weight,
                });
              for (let childMode of [0, 1]) {
                let child = {
                  ...node,
                  mode: childMode,
                  weight: node.weight * 0.5,
                  depth: node.depth + 1,
                  visited: new Set(visited),
                  segments,
                };
                let p = O.boundary(
                  at.slice(0, 3),
                  at.slice(3),
                  [0, 0, 1],
                  c,
                  childMode,
                  O.velocity(at.slice(0, 3), at.slice(3), c, node.mode)[2] < 0,
                );
                if (!p) {
                  finish(child, [110, 44, 116], 'no-mode');
                  continue;
                }
                child.s = [...at.slice(0, 3), ...p];
                stack.push(child);
              }
              done = true;
              break;
            }
            drift = Math.max(
              drift,
              Math.abs(2 * O.H(next.slice(0, 3), next.slice(3), c, node.mode) - 1),
            );
            if (exitT !== Infinity) {
              let at = exit.state,
                x = at.slice(0, 3),
                p = at.slice(3),
                N = O.normal(x, c.shape),
                out = O.exitDirection(p, N, c);
              if (!out) {
                finish(node, [47, 57, 83], 'tir');
                done = true;
                break;
              }
              node.d = out;
              node.o = O.add(x, O.mul(node.d, 2e-4));
              s = null;
              exited = true;
              break;
            }
            s = next;
          }
          if (done) break;
          if (!exited) {
            finish(node, [225, 151, 35], 'limit');
            break;
          }
        }
      } catch (e) {
        finish(node, [210, 50, 100], 'error');
      }
    }
    return {
      color,
      status,
      drift,
      branches,
      leaves: leaves.length,
      maxDepth,
      weightSum,
      ...(c.branchDebug ? { leafRecords: leaves, events } : {}),
    };
  }
  O.branching = { supported, homogeneous, defaults, settings, trace: traceTree };
  Object.assign(O.defaults, defaults);
})(globalThis.Optics);
