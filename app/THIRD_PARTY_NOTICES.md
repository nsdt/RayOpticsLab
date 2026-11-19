# Third-party data

Ray Optics Lab has no external JavaScript runtime dependencies. CIE datasets and
manufacturer dispersion coefficients are bundled for offline numerical use.

- `data/spectral/cie-visible.js` is a subset/reformat of the CIE 1931 2-degree
  observer and CIE D65 datasets, attributed to CIE and distributed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- `data/spectral/schott-visible.js` contains attributed SCHOTT manufacturer
  coefficients. The CIE license does not apply to these data.
- Crystal coefficients and their manufacturer sources are documented in
  [data/spectral/SOURCES.md](data/spectral/SOURCES.md).
- The same numerical tables are preserved in `paper/engine/data/spectral/`.

The original application source and associated documentation are distributed
under the [MIT License](LICENSE). Third-party datasets retain their respective
terms above and are not relicensed under MIT.
