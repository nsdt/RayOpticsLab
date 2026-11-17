/* Homogeneous media have exactly straight interior rays, including biaxial modes. */
(function (O) {
  let previous = O.advance;
  O.advance = function (s, h, c, mode) {
    if (['isotropic', 'uniaxial', 'biaxial'].includes(c.material)) {
      O.recordStep('closed');
      let v = O.velocity(s.slice(0, 3), s.slice(3), c, mode);
      return [...O.add(s.slice(0, 3), O.mul(v, h)), ...s.slice(3)];
    }
    return previous(s, h, c, mode);
  };
})(globalThis.Optics);
