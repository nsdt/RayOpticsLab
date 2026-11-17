/* Full-resolution, linear-RGB difference views shared by all comparisons. */
(function (root) {
  'use strict';
  function measure(a, b, n) {
    if (!Number.isInteger(n) || n < 1 || a.length !== n * n * 3 || b.length !== a.length)
      throw Error('差画像の寸法が一致しません');
    const pixels = new Float64Array(n * n);
    let sum = 0,
      max = 0;
    for (let i = 0; i < pixels.length; i++)
      for (let j = 0; j < 3; j++) {
        const x = a[i * 3 + j],
          y = b[i * 3 + j];
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('差画像に非有限値があります');
        const d = Math.abs(x - y);
        sum += d * d;
        max = Math.max(max, d);
        pixels[i] = Math.max(pixels[i], d);
      }
    return { pixels, linearRgbRMSE: Math.sqrt(sum / a.length), linearRgbMax: max };
  }
  function rgba(values, gain) {
    if (!(gain > 0 && Number.isFinite(gain))) throw Error('差画像の表示倍率が不正です');
    const data = new Uint8ClampedArray(values.length * 4);
    for (let i = 0; i < values.length; i++) {
      const v = Math.round(255 * Math.min(1, values[i] * gain));
      data.set([v, v, v, 255], i * 4);
    }
    return data;
  }
  function createGroup(host, { reference, gain = 1000 }) {
    host.parentElement.querySelector(':scope > .difference-controls')?.remove();
    const controls = document.createElement('div');
    controls.className = 'difference-controls';
    const label = document.createElement('label');
    label.textContent = '差画像の表示倍率 ';
    const select = document.createElement('select');
    select.className = 'difference-gain';
    select.setAttribute('aria-label', '差画像の表示倍率');
    for (const value of [1, 10, 100, 1000, 10000]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = '×' + value;
      select.append(option);
    }
    select.value = String(gain);
    label.append(select);
    const note = document.createElement('p');
    note.className = 'hint difference-scale';
    controls.append(label, note);
    host.before(controls);
    const entries = [];
    function draw(entry) {
      const { view, values, record } = entry;
      view.caption.textContent =
        '全画素の差画像：' + view.label + ' − ' + reference + '（×' + gain + '）';
      view.canvas.width = record.width;
      view.canvas.height = record.height;
      view.canvas
        .getContext('2d')
        .putImageData(new ImageData(rgba(values, gain), record.width, record.height), 0, 0);
      record.displayGain = gain;
      record.whiteAtDifference = 1 / gain;
      record.imagePng = view.canvas.toDataURL('image/png');
    }
    function update() {
      note.textContent =
        '全画素・線形RGBの最大絶対差。基準：' +
        reference +
        '。黒＝0、白＝' +
        (1 / gain).toPrecision(3) +
        '以上。同じ比較内は共通倍率で表示します。';
      for (const entry of entries) draw(entry);
    }
    select.onchange = () => {
      gain = Number(select.value);
      update();
    };
    update();
    function view(source, label) {
      const figure = document.createElement('figure');
      figure.className = 'comparison-difference-view';
      figure.hidden = true;
      const caption = document.createElement('figcaption');
      caption.textContent = '全画素の差画像：' + label + ' − ' + reference;
      const canvas = document.createElement('canvas');
      canvas.className = 'comparison-diff';
      canvas.setAttribute('aria-label', label + 'と' + reference + 'の全画素の差画像');
      const message = document.createElement('p');
      message.className = 'hint';
      figure.append(caption, canvas, message);
      source.after(figure);
      return { figure, canvas, message, caption, label };
    }
    function set(view, a, b, n, valid = true) {
      view.figure.hidden = false;
      if (!valid) {
        view.canvas.hidden = true;
        view.message.textContent = '条件外の画素があるため、この条件の差画像は表示しません。';
        return { valid: false, reference, reason: '条件外の画素を含む' };
      }
      const m = measure(a, b, n),
        record = {
          valid: true,
          reference,
          quantity: 'max absolute linear RGB channel difference per pixel, before 8-bit encoding',
          width: n,
          height: n,
          linearRgbRMSE: m.linearRgbRMSE,
          linearRgbMax: m.linearRgbMax,
          perPixelMaxAbsoluteDifference: Array.from(m.pixels),
        };
      view.message.textContent =
        'RMSE ' +
        m.linearRgbRMSE.toExponential(3) +
        ' / 最大絶対差 ' +
        m.linearRgbMax.toExponential(3) +
        (a === b ? '（基準画像自身との差は0）' : '');
      view.canvas.hidden = false;
      const entry = { view, values: m.pixels, record };
      entries.push(entry);
      draw(entry);
      return record;
    }
    return { view, set };
  }
  root.ComparisonDifference = { measure, rgba, createGroup };
  if (typeof module !== 'undefined') module.exports = root.ComparisonDifference;
})(globalThis);
