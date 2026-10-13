"""Optimize downloaded models in two separate headless Blender processes."""
from pathlib import Path
import concurrent.futures
import subprocess

root=Path(__file__).resolve().parents[2]
files=[p for p in (root/'tools/assets/raw').rglob('*.glb')
       if not (root/'tools/assets/reviews'/p.relative_to(root/'tools/assets/raw').with_suffix('')/'metrics.json').exists()]
def prepare(file):
    identifier=file.relative_to(root/'tools/assets/raw').with_suffix('').as_posix()
    log=root/'tools/assets'/('prepare-'+identifier.replace('/','-')+'.log')
    with log.open('w') as stream:
        result=subprocess.run([r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe',
            '--background','--python',str(root/'tools/assets/prepare_blender.py'),'--',identifier],
            stdout=stream,stderr=subprocess.STDOUT,cwd=root)
    print(identifier,'prepared' if result.returncode==0 else 'FAILED',flush=True)
    if result.returncode:raise RuntimeError('Blender failed: '+identifier)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    list(executor.map(prepare,files))
