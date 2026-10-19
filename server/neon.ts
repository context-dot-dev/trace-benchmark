import type { Archive,SearchParams } from './types.ts';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and,eq,desc,asc,sql,count,inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { publications,results } from './schema.ts';
import { listing,searchable,publication } from './publication.js';

type Transaction=Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];
export class NeonSource {
  pool:Pool;
  db;
  constructor(url:string){this.pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:15000});this.db=drizzle(this.pool);}
  async publicFile(path:string){
    const {rows}=await this.pool.query('SELECT data FROM trace_collector.public_exports WHERE path=$1',[path]);
    if(!rows.length)throw Object.assign(new Error('Not found'),{status:404});
    return rows[0].data as string;
  }
  async summary(){
    const [row]=await this.db.select().from(publications).where(eq(publications.id,'current'));
    if(!row)throw Object.assign(new Error('No benchmark publication is available'),{status:503});
    return row.summary;
  }
  async read<T>(version:string|null,work:(tx:Transaction,version:string)=>Promise<T>){
    return this.db.transaction(async tx=>{
      const [row]=await tx.select().from(publications).where(eq(publications.id,'current'));
      if(!row||row.version!==version)throw Object.assign(new Error('Publication changed; refresh the summary'),{status:409});
      return work(tx,row.version);
    },{isolationLevel:'repeatable read',accessMode:'read only'});
  }
  async page(params:SearchParams,download=false){return this.read(params.version,async(tx,version)=>{
    const filters=[eq(results.cohort,params.cohort)];
    if(params.provider!=='all')filters.push(eq(results.provider,params.provider));
    if(params.q)filters.push(sql`strpos(${results.searchText},${params.q}) > 0`);
    const where=and(...filters);
    const [{total}]=await tx.select({total:count()}).from(results).where(where);
    const page=Math.min(params.page,Math.max(0,Math.ceil(total/8)-1));
    const query=tx.select({record:results.record}).from(results).where(where).orderBy(desc(results.startedMs),asc(results.id));
    const rows=await (download?query:query.limit(8).offset(page*8));
    return {version,page,total,records:rows.map(row=>download?row.record:listing(row.record))};
  });}
  async detail(id:string,version:string|null){return this.read(version,async tx=>{
    const [row]=await tx.select({record:results.record}).from(results).where(eq(results.id,id));
    if(!row)throw Object.assign(new Error('Result not found'),{status:404});
    return row.record;
  });}
  async publish(archive:Archive){
    const {summary,records}=publication(archive);
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(74012491)`);
      const [existing]=await tx.select().from(publications).where(eq(publications.id,'current'));
      if(existing?.version===summary.version)return;
      if(existing&&Date.parse(existing.summary.generated_at)>Date.parse(summary.generated_at))throw new Error('Refusing an older publication');
      const before=new Map((await tx.select({id:results.id,fingerprint:results.fingerprint}).from(results)).map(row=>[row.id,row.fingerprint]));
      const updates=records.map(record=>({id:record.id,fingerprint:createHash('sha256').update(JSON.stringify(record)).digest('hex'),cohort:record.cohort,provider:record.provider,startedMs:Date.parse(record.started_at||'')||0,searchText:searchable(record,summary),record})).filter(row=>before.get(row.id)!==row.fingerprint);
      for(let i=0;i<updates.length;i+=100){await tx.insert(results).values(updates.slice(i,i+100)).onConflictDoUpdate({target:results.id,set:{fingerprint:sql`excluded.fingerprint`,cohort:sql`excluded.cohort`,provider:sql`excluded.provider`,searchText:sql`excluded.search_text`,startedMs:sql`excluded.started_ms`,record:sql`excluded.record`}});}
      const retained=new Set(records.map(r=>r.id));const removed=[...before.keys()].filter(id=>!retained.has(id));
      for(let i=0;i<removed.length;i+=500)await tx.delete(results).where(inArray(results.id,removed.slice(i,i+500)));
      await tx.insert(publications).values({id:'current',version:summary.version,summary}).onConflictDoUpdate({target:publications.id,set:{version:summary.version,summary}});
    });
  }
  close(){return this.pool.end();}
}
