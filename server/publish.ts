import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { NeonSource } from './neon.ts';
const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('Neon DATABASE_URL_UNPOOLED is required');
const source=new NeonSource(url);
try{
  await migrate(source.db,{migrationsFolder:'server/migrations'});
  const input=process.argv[2]||'site/data/latest.json';
  const raw=await readFile(input,'utf8');
  const archive=JSON.parse(raw);
  const files:Record<string,string>={};
  if(process.argv.includes('--sync-public-files')){
    const root=dirname(input);
    const manifests=(await readdir(join(root,'runs'))).filter(name=>/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name));
    files['latest.json']=raw;
    for(const name of ['run-sampling.json','replenishment.json',...manifests.map(name=>'runs/'+name)])files[name]=await readFile(join(root,name),'utf8');
    if(!isDeepStrictEqual(JSON.parse(files['run-sampling.json']),archive.sampling_history)||!isDeepStrictEqual(JSON.parse(files['replenishment.json']),archive.replenishment))throw new Error('Public export is still being written');
    for(const [id,sampling] of Object.entries(archive.sampling_history)){
      const manifest=files['runs/'+id+'.json'];
      if(!manifest||!isDeepStrictEqual(JSON.parse(manifest).sampling,sampling))throw new Error('Run manifests are still being written');
    }
    await source.pool.query('CREATE SCHEMA IF NOT EXISTS trace_collector');
    await source.pool.query('CREATE TABLE IF NOT EXISTS trace_collector.public_exports(path TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  }
  await source.publish(archive,files);
  console.log('Published benchmark summary and paginated results to Neon.');
}finally{await source.close();}
