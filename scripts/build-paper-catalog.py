from pathlib import Path
import json,shutil,hashlib,re
repo=Path(__file__).resolve().parents[1]; app=repo/'app'; root=repo.parent/'AppliedOpticsVisualization';
if not root.is_dir(): raise SystemExit('Catalog regeneration requires the original AppliedOpticsVisualization archive beside this repository. Existing app/paper files are already self-contained.');
exp=root/'experiments_20260928_isotropic_columns'; old=root/'experiments_20260927_revision'
backup=repo/'dev/archive/catalog-backups';backup.mkdir(parents=True,exist_ok=True)
for name in ['index.html','app.js','worker.js','workspace-ui.js']:
 if not (backup/name).exists(): shutil.copy2(app/name,backup/name)
paper=app/'paper';(paper/'engine/data/spectral').mkdir(parents=True,exist_ok=True);(paper/'figures').mkdir(exist_ok=True)
files=['polynomial.js','landmark-target.js','asphere.js','literature-media.js','optics.js','rkf45.js','analytical.js','schur.js','approximate.js','homogeneous.js','grin.js','branching.js','polarization.js','spectral.js','data/spectral/cie-visible.js','data/spectral/schott-visible.js']
hashes={}
for name in files:
 src=exp/'engine'/name;dst=paper/'engine'/name
 shutil.copy2(src,dst);hashes[name]=hashlib.sha256(src.read_bytes()).hexdigest()
# Keep the paper instrumentation in its own worker realm, including direct-only accounting.
edits=json.loads((exp/'data/diagnostic-instrumentation.json').read_text(encoding='utf-8')) if (exp/'data/diagnostic-instrumentation.json').exists() else json.loads((old/'data/diagnostic-instrumentation.json').read_text(encoding='utf-8'))
p=paper/'engine/polarization.js';source=p.read_text(encoding='utf-8')
for e in edits:
 assert source.count(e['before'])==e['count']
 source=source.replace(e['before'],e['after'])
p.write_text(source,encoding='utf-8')
manifest=json.loads((exp/'configs/manifest.json').read_text(encoding='utf-8'));info=json.loads((exp/'configs/figure-info.json').read_text(encoding='utf-8'))
# Current manuscript cites the optical reciprocal model; the seismic antecedent is discussed beside the formula in Supplement 1.
info['reciprocal'][3]='NishidateAxial2026'
# Marchand precedes the later invariant formulation in the current isotropic references.
for model in ['iso-axial','iso-cylindrical','iso-spherical']:info[model][3]='Marchand1978,GomezCorrea2021'
order=['iso-uniform','uniaxial-uniform','iso-axial','iso-cylindrical','iso-spherical','axial-2013','reciprocal','quadratic','heliconical','radial-axis','shear','spherical-map','cylindrical-map','hyperbolic','eng-2013']
# Figure numbers are derived from the current TeX, including one atlas per medium.
figure_specs=[]
for doc,prefix in [('main',''),('supplement','S')]:
 text=(root/'manuscript'/(doc+'.tex')).read_text(encoding='utf8')
 blocks=re.findall(r'\\begin\{figure\*?\}.*?\\end\{figure\*?\}',text,re.S)
 for i,block in enumerate(blocks,1):
  path=re.search(r'\\includegraphics(?:\[[^]]*\])?\{([^}]+)\}',block).group(1)
  file=Path(path).with_suffix('.png').name
  shutil.copy2(root/'manuscript/figures'/file,paper/'figures'/file)
  figure_specs.append(dict(number=(prefix+str(i)) if prefix else i,document=doc,file='paper/figures/'+file,sha256=hashlib.sha256((paper/'figures'/file).read_bytes()).hexdigest()))
figfiles=[f['file'] for f in figure_specs]
figure_for={Path(f['file']).stem:f['number'] for f in figure_specs if f['document']=='supplement'}
fignums=[figure_for['atlas-'+group] for group in order]

groups=[];cases=[]
for group,fig in zip(order,fignums):
 items=[s for s in manifest if s['group']==group]
 if group in order[:5]:
  key='n' if group=='iso-uniform' else 'tilt' if group=='uniaxial-uniform' else 'gradient'
  items.sort(key=lambda s:s['config'].get(key,float(info[group][2])))
 groups.append(dict(id=group,figure=fig,title=info[group][0],reference=info[group][3]))
 for i,s in enumerate(items):
  data=exp/'data'/(s['id']+'-n'+str(s['resolution'])+'.json')
  meta=json.loads(data.read_text(encoding='utf-8'))
  label=s.get('captionLabel') or (info[group][1]+' = '+str(s.get('value',info[group][2])))
  cases.append(dict(id=s['id'],group=group,figure=fig,panel=chr(97+i),label=label,kind='mono',config=meta['config']))
# Additional exact-twist setting, independently rendered with the archived CPU protocol.
physical=root/'experiments_20261115_physical'
pi=json.loads((physical/'configs/heliconical-pi.json').read_text(encoding='utf8'))
pi.update(figure=figure_for['physical-heliconical-pi-atlas'],panel='a')
cases.append({k:pi[k] for k in ['id','group','figure','panel','label','kind','config']})
for g in groups:
 if g['id']=='heliconical':g['figure']=str(g['figure'])+', '+str(pi['figure'])
plans=json.loads((exp/'configs/spectral-plans.json').read_text(encoding='utf-8'))
sm=json.loads((exp/'configs/spectral-manifest.json').read_text(encoding='utf-8'))
for i,plan in enumerate(plans):
 group=plan['id']+'-dispersion';groups.append(dict(id=group,figure=', '.join(str(figure_for['atlas-'+group+'-'+kind]) for kind in ['constant','spectral']),title=info[plan['id']][0]+' — dispersion',reference=info[plan['id']][3]))
 for k,kind in enumerate(['constant','spectral']):
  c=next(s['config'] for s in sm if s['id']==plan['id']+'-achromatic-direct') if kind=='constant' else plan['config']
  cases.append(dict(id=group+'-'+kind,group=group,figure=figure_for['atlas-'+group+'-'+kind],panel='a',label='Wavelength-independent indices' if kind=='constant' else 'Cauchy dispersion',kind=kind,config=c))
# Main-text selections retain links to the full supplemental series.
overview={ident:chr(97+i) for i,ident in enumerate(order)}
main_figure={Path(f['file']).stem:f['number'] for f in figure_specs if f['document']=='main'}
locations={'radial-axis':[('physical-radial','a')], 'heliconical-v1':[('physical-heliconical','a')], 'heliconical-pi':[('physical-heliconical','b')], 'heliconical-v4':[('physical-heliconical','c')], 'reciprocal-v4':[('physical-reflections','a')], 'hyperbolic-v1':[('physical-interfaces','a')], 'eng-2013-v4':[('physical-interfaces','c')]}
for c in cases:
 c['mainLocations']=[]
 if c['id'] in overview:c['mainLocations'].append(dict(figure=main_figure['compact-overview'],panel=overview[c['id']]))
 for file,panel in locations.get(c['id'],[]):c['mainLocations'].append(dict(figure=main_figure[file],panel=panel))
 if c['kind']!='mono':c['mainLocations'].append(dict(figure=main_figure['fig08-dispersion'],panel=chr(97+(0 if c['group'].startswith('iso-') else 3)+(0 if c['kind']=='constant' else 1))))
catalog=dict(version=8,protocol='manuscript-20261116-coupling',imageProtocol='manuscript-20260928',manuscriptSHA256=hashlib.sha256((root/'manuscript/main.tex').read_bytes()).hexdigest(),supplementSHA256=hashlib.sha256((root/'manuscript/supplement.tex').read_bytes()).hexdigest(),source='experiments_20260928_isotropic_columns',groups=groups,cases=cases,figures=figure_specs)
(paper/'experiments.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(paper/'provenance.json').write_text(json.dumps(dict(source=catalog['source'],engineSHA256=hashes,polarizationInstrumentation=edits,configurationSHA256=hashlib.sha256((paper/'experiments.json').read_bytes()).hexdigest()),indent=2)+'\n',encoding='utf-8')
print('Catalog:',len(cases),'cases;',len(figfiles),'reference figures;',round(sum(p.stat().st_size for p in paper.rglob('*') if p.is_file())/1048576,1),'MB')


# Record final packaged bytes as well as the original pre-instrumentation hashes.
p=paper/'provenance.json'
a=json.loads(p.read_text(encoding='utf-8'))
a['packagedEngineSHA256']={name:hashlib.sha256((paper/'engine'/name).read_bytes()).hexdigest() for name in hashes}
if (paper/'protocol.js').exists(): a['protocolSHA256']=hashlib.sha256((paper/'protocol.js').read_bytes()).hexdigest()
p.write_text(json.dumps(a,indent=2)+'\n',encoding='utf-8')
shutil.copy2(app/'data/spectral/SOURCES.md',paper/'engine/data/spectral/SOURCES.md')

# Hash the final reproduction runtime and current manuscript, independently of the archived image protocol.
p=paper/'provenance.json'
a=json.loads(p.read_text(encoding='utf8'))
a['runtimeSHA256']={name:hashlib.sha256((paper/name).read_bytes()).hexdigest() for name in ['protocol.js','selection.js','worker.js']}
a['manuscriptSHA256']=catalog['manuscriptSHA256']
a['supplementSHA256']=catalog['supplementSHA256']
a['gpuSHA256']={name:hashlib.sha256((app/name).read_bytes()).hexdigest() for name in ['gpu-support.js','gpu-transport.js','gpu-optics.wgsl','gpu-numerical.wgsl','gpu-phase.wgsl']}
a['catalogProtocol']=catalog['protocol']
a['imageProtocol']=catalog['imageProtocol']
a['referenceFigureSHA256']={f['file']:f['sha256'] for f in catalog['figures']}
p.write_text(json.dumps(a,indent=2)+'\n',encoding='utf8')

# The optional analysis download contains the complete camera-trajectory atlas.
atlas=root/'experiments_20261115_trajectory_gallery'
if (atlas/'data/validation.json').exists():
 p=paper/'provenance.json';a=json.loads(p.read_text(encoding='utf8'))
 validation=json.loads((atlas/'data/validation.json').read_text(encoding='utf8'))
 a['trajectoryAtlas']={'source':atlas.name,'manifestSHA256':hashlib.sha256((atlas/'data/manifest.json').read_bytes()).hexdigest(),'validationSHA256':hashlib.sha256((atlas/'data/validation.json').read_bytes()).hexdigest(),'cases':validation['cases'],'samples':validation['samples'],'paths':validation['paths']}
 if (paper/'analysis-reproduction.zip').exists():a['analysisArchiveSHA256']=hashlib.sha256((paper/'analysis-reproduction.zip').read_bytes()).hexdigest()
 p.write_text(json.dumps(a,indent=2)+'\n',encoding='utf8')

# Provenance for the additional physical comparisons.
p=paper/'provenance.json';a=json.loads(p.read_text(encoding='utf8'))
a['additionalPhysicalComparisons']={'source':physical.name,'piImageSHA256':hashlib.sha256((physical/'data/heliconical-pi-n256.linear.f64').read_bytes()).hexdigest(),'piConfigurationSHA256':hashlib.sha256((physical/'configs/heliconical-pi.json').read_bytes()).hexdigest(),'reflectionDecompositionSHA256':hashlib.sha256((physical/'data/reflection-decomposition.json').read_bytes()).hexdigest()}
p.write_text(json.dumps(a,indent=2)+'\n',encoding='utf8')
