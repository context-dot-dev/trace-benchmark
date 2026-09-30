"""Exercise source packaging, reproducibility and secret rejection as a CLI workflow."""
import hashlib,json,subprocess,sys,tempfile,zipfile,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(root/'scripts/package-release.py')],check=True,capture_output=True)
a=root/'site/trace-source.zip';first=hashlib.sha256(a.read_bytes()).hexdigest()
subprocess.run([sys.executable,str(root/'scripts/package-release.py')],check=True,capture_output=True)
checks={'reproducible_zip':first==hashlib.sha256(a.read_bytes()).hexdigest()}
with zipfile.ZipFile(a) as z:
 names=z.namelist();manifest=json.loads(z.read('trace/source-manifest.json'))
 checks['no_private_files']=not any(any(part in name.split('/') for part in ['.env','state','artifacts','node_modules','.venv']) for name in names)
 checks['all_source_hashes_match']=all(hashlib.sha256(z.read('trace/'+name)).hexdigest()==h for name,h in manifest.items())
 checks['license_and_lockfiles_present']=all('trace/'+name in names for name in ['LICENSE','NOTICE','requirements-lock.txt','package-lock.json'])
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp);(p/'scripts').mkdir();(p/'src').mkdir();(p/'site').mkdir()
 shutil.copy2(root/'scripts/package-release.py',p/'scripts/package-release.py')
 fake='fixture-key-for-distribution-check-only'
 (p/'.env').write_text('FIXTURE_API_KEY='+fake+'\n')
 (p/'src/canary.txt').write_text(fake)
 r=subprocess.run([sys.executable,str(p/'scripts/package-release.py')],capture_output=True,text=True)
 checks['secret_rejected']=r.returncode!=0 and 'Credential detected' in r.stderr
report={'passed':all(checks.values()),'checks':checks,'source_sha256':first}
out=root/'artifacts/release-verification/distribution.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
raise SystemExit(0 if report['passed'] else 1)
