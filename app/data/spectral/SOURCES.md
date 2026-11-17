# Spectral data provenance

Retrieved/checked 2026-09-24. No external service is contacted during rendering.

## CIE

- [CIE 1931 2 degree observer](https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer), CIE 2019, DOI [10.25039/CIE.DS.xvudnb9b](https://doi.org/10.25039/CIE.DS.xvudnb9b), original CIE 018:2019 Table 6.
- [CIE D65](https://www.cie.co.at/datatable/cie-standard-illuminant-d65), CIE 2019, DOI [10.25039/CIE.DS.hjfjmt59](https://doi.org/10.25039/CIE.DS.hjfjmt59), ISO/CIE 11664-2:2022 Table B.1.
- Original CSV and metadata files are retained. Download prefix: https://files.cie.co.at/Publications-datasets/
- MD5 of CMF CSV: 17cca777db64b17170f06f67ce9d3ab7
- MD5 of D65 CSV: 03d4eb9b837c60671627c946fb534deb
- Both datasets are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The generated **cie-visible.js** is a 380–780 nm subset/reformat of these datasets, distributed under the same license with attribution. The original numeric values at 1 nm knots are unchanged. This data license statement is distinct from the application source code.

## SCHOTT

[Manufacturer optical glass page](https://www.schott.com/en-se/products/optical-glass-p1000267), “Optical glass overview glass types (ZEMAX format)”:
[download archive](https://media.schott.com/api/public/content/a79c07aa61da4c05a2c0bbab93d09a7f?v=3b65e351&download=true).

The retained archive contains “schott glasses preferred and special June-2025-B.AGF”.
Only the 32 glasses already in the application catalog are selected in schott-visible.js.
All are AGF formula 2 (Sellmeier 1):

n² = 1 + B1 λ²/(λ²−C1) + B2 λ²/(λ²−C2) + B3 λ²/(λ²−C3).

λ is in μm; CD columns are B1,C1,B2,C2,B3,C3. LD gives the wavelength domain.
The generator retains nd and the full CD record for checks. SCHOTT data are manufacturer data, not covered by the CIE license. The original data remain attributed to SCHOTT. Standard-air relative indices are used without conversion to vacuum. Absorption and temperature records are not applied.

## Crystals

Coefficients transcribed from the following manufacturer sources are in spectral.js.
For each row [a,b,d,e,f,g], n² = a + b/(λ²−d) − eλ² + fλ⁴ + gλ⁶, λ in μm. Missing f,g are zero.

- [Calcite — Crysmit](https://www.crysmit.com/Calcite): no [2.69705,.0192064,.01820,.0151624], ne [2.18438,.0087309,.01018,.0024411]. Manufacturer lists 350–2300 nm transparency; app uses 380–780 nm.
- [BBO — EKSMA](https://www.eksmaoptics.com/v/bbo-2203h/29736): no [2.7366122,.0185720,.0178746,.0143756], ne [2.3698703,.0128445,.0153064,.0029129]. App uses 380–780 nm.
- [LiNbO3 — EKSMA catalog 2017](https://eksmaoptics.com/out/media/EKSMA_Optics_Laser_Components_Catalog_2017.pdf): no [4.9048,.11768,.04750,.027169], ne [4.5820,.099169,.04443,.021950]. App uses 420–780 nm, respecting the listed lower transparency limit.
- [LBO — EKSMA](https://www.eksmaoptics.com/v/lbo-501/1436): nx [2.4542,.01125,.01135,.01388], ny [2.5390,.01277,.01189,.01849,4.3025e-5,-2.9131e-5], nz [2.5865,.01310,.01223,.01862,4.5778e-5,-3.2526e-5]. App uses 380–780 nm.
- [KTP — CASTECH](https://www.castech.com/product/KTP---Potassium-Titanyl-Phosphate-186.html): nx [3.0065,.03901,.04251,.01327], ny [3.0333,.04154,.04547,.01408], nz [3.3134,.05694,.05658,.01682]. App uses 380–780 nm. These are the CASTECH equations, not a claim to implement Kato–Takaoka 2002. They need not exactly match the legacy EKSMA fixed-index presets.

Manufacturer transparency ranges are not an uncertainty specification for these fits. The implementation does not estimate index-fit uncertainty or infer missing spectral absorption.

## Colour/implementation context

[PBRT, Spectral Distributions](https://pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Representing_Spectral_Distributions) and
[PBRT, Color](https://pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Color) explain spectral radiance and colour integration. This implementation uses deterministic midpoint transport with bin-integrated CIE weights, not PBRT's Monte Carlo wavelength sampler.

XYZ to linear sRGB uses the standard D65 matrix:
[3.2404542, -1.5371385, -0.4985314;
 -0.9692660, 1.8760108, 0.0415560;
 0.0556434, -0.2040259, 1.0572252].
Linear RGB is retained for comparisons; only display/PNG are clipped and sRGB encoded.

