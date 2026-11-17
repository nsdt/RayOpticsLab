"""Package the verified static build and launchers. Python standard library only."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'dist/site'
manifest_path = SITE / 'site-manifest.json'
if not manifest_path.is_file():
    raise SystemExit('Run npm run build before packaging.')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for name, expected in manifest['sha256'].items():
    file = (SITE / name).resolve()
    if not file.is_relative_to(SITE.resolve()) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Static build verification failed: {name}')
output = ROOT / 'dist/RayOpticsLab-local.zip'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in [*manifest['sha256'], 'site-manifest.json']:
        archive.write(SITE / name, 'RayOpticsLab/app/' + name)
    for name in ['launch.py', 'start-windows.bat', 'start-linux.sh', 'start-macos.command',
                 'README.md', 'README_JA.md', 'docs/REPRODUCING.md', 'docs/REPRODUCING_JA.md',
                 'docs/SPECTRAL.md', 'docs/DEVELOPING.md', 'docs/RELEASING.md', 'CITATION.cff']:
        archive.write(ROOT / name, 'RayOpticsLab/' + name)
print(output)
print(f'{output.stat().st_size:,} bytes; no tests, development archives or npm dependencies')
