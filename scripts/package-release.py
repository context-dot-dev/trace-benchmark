"""Build an allowlisted, credential-checked source archive for redistribution."""
from pathlib import Path
import hashlib
import json
import re
import zipfile
from dotenv import dotenv_values
root=Path(__file__).resolve().parents[1]
files=[]
for name in ['bench','src','scripts','tests','deploy']:
 files.extend(p for p in (root/name).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc')
for name in ['site/fonts','site/logos']:
 files.extend(p for p in (root/name).rglob('*') if p.is_file())
for name in ['README.md','LICENSE','NOTICE','.gitignore','.env.example','requirements.txt','requirements-lock.txt',
             'package.json','package-lock.json','components.json','tsconfig.json','vite.config.ts','index.html',
             'config/sources.json','config/benchmark.json','site/plan.md']:
 if (root/name).is_file():files.append(root/name)
secrets=[v.encode() for k,v in dotenv_values(root/'.env').items() if v and len(v)>8 and any(x in k for x in ['KEY','TOKEN','SECRET'])]
manifest={}
for p in files:
 data=p.read_bytes()
 if any(secret in data for secret in secrets):raise SystemExit('Credential detected in '+str(p.relative_to(root)))
 if re.search(rb'(?:ctxt_secret_|sk-proj-|classifier_agent_)[a-zA-Z0-9_-]{16,}',data):raise SystemExit('Credential pattern in '+str(p.relative_to(root)))
 manifest[str(p.relative_to(root))]=hashlib.sha256(data).hexdigest()
out=root/'artifacts/release/trace-source.zip'
out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in sorted(set(files)):
  info=zipfile.ZipInfo('trace/'+str(p.relative_to(root)),(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
  z.writestr(info,p.read_bytes())
 info=zipfile.ZipInfo('trace/source-manifest.json',(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
 z.writestr(info,json.dumps(manifest,indent=2))
print(json.dumps({'archive':str(out),'files':len(manifest),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}))
