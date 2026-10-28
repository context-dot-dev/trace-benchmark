// Real CLI + PostgreSQL checks: missing exports, private-file leakage, partial
// publication, stale overwrite, and repeated uploads must not corrupt the report.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
const url=process.env.DATABASE_URL;
assert.ok(url && ['localhost','127.0.0.1'].includes(new URL(url).hostname),'Disposable local database required');
const pool=new pg.Pool({connectionString:url});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'scraping-publish-'));
const checks=[];
try {
 await fs.cp('artifacts/audit/live-data',root,{recursive:true});
 await fs.writeFile(path.join(root,'private.json'),'SECRET-FIXTURE');
 const publish=()=>execFileSync('node',['--import','tsx','server/publish.ts',path.join(root,'latest.json'),'--sync-public-files'],{env:{...process.env,DATABASE_URL_UNPOOLED:url},stdio:'pipe'});
 publish();
 const files=(await pool.query('select path,data from trace_collector.public_exports')).rows;
 assert.ok(files.length>3);assert.ok(!files.some(row=>row.path==='private.json'));checks.push('Only allowlisted public exports are stored');
 for(const row of files)assert.equal(row.data,await fs.readFile(path.join(root,row.path),'utf8'));checks.push('Every public file matches its source');
 const before=(await pool.query('select version from trace_dashboard.publications')).rows[0].version;
 publish();assert.equal((await pool.query('select version from trace_dashboard.publications')).rows[0].version,before);checks.push('Repeated publication is idempotent');
 const sampling=await fs.readFile(path.join(root,'run-sampling.json'),'utf8');
 await fs.writeFile(path.join(root,'run-sampling.json'),'{}');assert.throws(publish);await fs.writeFile(path.join(root,'run-sampling.json'),sampling);checks.push('A partial export is rejected before publication');
 const archive=JSON.parse(await fs.readFile(path.join(root,'latest.json'),'utf8'));
 archive.generated_at='2000-01-01T00:00:00Z';await fs.writeFile(path.join(root,'latest.json'),JSON.stringify(archive));
 assert.throws(publish);assert.equal((await pool.query("select data from trace_collector.public_exports where path='latest.json'")).rows[0].data,files.find(row=>row.path==='latest.json').data);checks.push('An older snapshot cannot overwrite public downloads');
 await fs.mkdir('artifacts/publication-sync',{recursive:true});await fs.writeFile('artifacts/publication-sync/verification.json',JSON.stringify({passed:true,checks,files:files.length},null,2));console.log(JSON.stringify({passed:true,checks}));
} finally {await pool.end();await fs.rm(root,{recursive:true,force:true});}
