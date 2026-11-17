/* Geometric target marks; explicit synthetic spectra for spectral rendering. */
(function (root) {
  'use strict';
  const neutralEncode = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const WHITE = [255, 255, 255],
    DARK = Array(3).fill(neutralEncode(0.05)),
    INK = Array(3).fill(neutralEncode(0.01));
  const landmarks = [
    { label: 'U', x: 0, y: 0.48, color: [0, 114, 178], shape: 'circle', spectrum: 'blue' },
    { label: 'D', x: 0, y: -0.48, color: [213, 94, 0], shape: 'diamond', spectrum: 'orange' },
    { label: 'L', x: -0.48, y: 0, color: [0, 140, 100], shape: 'square', spectrum: 'green' },
    { label: 'R', x: 0.48, y: 0, color: [133, 60, 153], shape: 'hexagon', spectrum: 'purple' },
  ];
  const directions = [
    { label: 'up-arrow', x: 0, y: 1.75, dx: 0, dy: 1 },
    { label: 'down-arrow', x: 0, y: -1.75, dx: 0, dy: -1 },
    { label: 'left-arrow', x: -1.75, y: 0, dx: -1, dy: 0 },
    { label: 'right-arrow', x: 1.75, y: 0, dx: 1, dy: 0 },
  ];
  const labels = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++)
      labels.push({
        label: '' + (row + 1) + (col + 1),
        x: [-1.75, -0.75, 0.75, 1.75][col],
        y: [1.75, 0.75, -0.75, -1.75][row],
      });
  const FONT = {
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  };
  const decode = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const encode = (v) =>
    255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  function reflectance(name, nm) {
    const g = (mu, sigma) => Math.exp(-0.5 * ((nm - mu) / sigma) ** 2);
    return name === 'blue'
      ? 0.03 + 0.7 * g(450, 35)
      : name === 'orange'
        ? 0.03 + 0.75 * g(605, 40)
        : name === 'green'
          ? 0.03 + 0.65 * g(535, 35)
          : 0.03 + 0.45 * g(440, 35) + 0.55 * g(650, 40);
  }
  let colorsReady = false;
  function prepareColors() {
    if (colorsReady || !root.Spectral) return;
    const plan = root.Spectral.plan({
      material: 'isotropic',
      n: 1.3,
      outsideN: 1,
      transport: 'polarized',
      spectralMode: 'off',
      spectralModel: 'constant',
      spectralSamples: 256,
    });
    for (const m of landmarks) {
      const xyz = [0, 0, 0];
      for (const s of plan)
        for (let j = 0; j < 3; j++) xyz[j] += reflectance(m.spectrum, s.nm) * s.xyz[j];
      m.color = root.Spectral.rgb(...xyz).map((v) => Math.max(0, Math.min(255, encode(v))));
    }
    colorsReady = true;
  }
  function glyph(text, x, y, pitch) {
    const width = (6 * text.length - 1) * pitch,
      ix = Math.floor((x + width / 2) / pitch),
      iy = Math.floor((3.5 * pitch - y) / pitch);
    if (ix < 0 || ix >= 6 * text.length - 1 || iy < 0 || iy > 6) return false;
    const col = ix % 6;
    return col < 5 && FONT[text[Math.floor(ix / 6)]][iy][col] === '1';
  }
  function shapeRadius(mark, x, y) {
    return mark.shape === 'circle'
      ? Math.hypot(x, y)
      : mark.shape === 'diamond'
        ? (Math.abs(x) + Math.abs(y)) / 0.99
        : mark.shape === 'hexagon'
          ? Math.max(Math.abs(y), 0.866025403784 * Math.abs(x) + 0.5 * Math.abs(y))
          : Math.max(Math.abs(x), Math.abs(y));
  }
  function region(x, y) {
    for (const m of landmarks) {
      const dx = x - m.x,
        dy = y - m.y;
      if (Math.abs(dx) > 0.29 || Math.abs(dy) > 0.29) continue;
      const r = shapeRadius(m, dx, dy),
        radius = m.shape === 'diamond' ? 0.255 : 0.195;
      if (r <= radius + 0.028)
        return r > radius ? 'white' : glyph(m.label, dx, dy, 0.032) ? 'white' : m.spectrum;
    }
    for (const m of directions) {
      const dx = x - m.x,
        dy = y - m.y;
      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) continue;
      const r = Math.hypot(dx, dy);
      if (r <= 0.225) {
        if (r >= 0.197) return 'ink';
        const longitudinal = dx * m.dx + dy * m.dy,
          transverse = Math.abs(dx * m.dy - dy * m.dx);
        return (longitudinal >= -0.11 && longitudinal <= 0.015 && transverse <= 0.035) ||
          (longitudinal >= -0.015 &&
            longitudinal <= 0.14 &&
            transverse <= (0.14 - longitudinal) * 0.72)
          ? 'ink'
          : 'white';
      }
    }
    for (const m of labels) {
      const dx = x - m.x,
        dy = y - m.y;
      if (Math.abs(dx) <= 0.205 && Math.abs(dy) <= 0.155)
        return Math.abs(dx) > 0.176 || Math.abs(dy) > 0.126
          ? 'ink'
          : glyph(m.label, dx, dy, 0.031)
            ? 'ink'
            : 'white';
    }
    const ax = Math.abs(x),
      ay = Math.abs(y);
    if (ax < 0.1 && ay < 0.1 && (ax < 0.052 || ay < 0.052))
      return ax < 0.025 || ay < 0.025 ? 'ink' : 'white';
    return (((Math.floor(x * 2) + Math.floor(y * 2)) % 2) + 2) % 2 ? 'white' : 'dark';
  }
  function sample(x, y, nm) {
    const name = region(x, y);
    if (name === 'white') return WHITE;
    if (name === 'dark') return DARK;
    if (name === 'ink') return INK;
    if (Number.isFinite(nm)) {
      const v = encode(reflectance(name, nm));
      return [v, v, v];
    }
    prepareColors();
    return landmarks.find((m) => m.spectrum === name).color;
  }
  function install(O) {
    const original = O.bg;
    O.bg = (o, d, c) => {
      if (c.paperTarget !== 'landmarks' || !['grid', 'spectralLandmarks'].includes(c.background))
        return original(o, d, c);
      const t = O.backgroundDistance(o, d, c);
      if (!Number.isFinite(t)) return original(o, d, c);
      return sample(
        o[0] + t * d[0],
        o[1] + t * d[1],
        c.spectralSample ? c.wavelengthNm : undefined,
      );
    };
    return original;
  }
  root.LandmarkTarget = {
    sample,
    region,
    reflectance,
    prepareColors,
    install,
    landmarks,
    directions,
    labels,
    definition: {
      checkerWidth: 0.5,
      checkerSRGB: [WHITE, DARK],
      planeZ: -3,
      landmarks,
      directions,
      labels,
      spectra: 'Gaussian synthetic reflectances, nm; white=1, dark=0.05, ink=0.01',
    },
  };
  if (typeof module !== 'undefined') module.exports = root.LandmarkTarget;
})(globalThis);
