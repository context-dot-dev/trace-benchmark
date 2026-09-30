import type { SearchParams } from './types.ts';
import { readFile, stat } from 'node:fs/promises';
import { publication, listing, searchable } from './publication.js';

export class ArtifactSource {
  current!:ReturnType<typeof publication>;
  stamp='';
  checked=0;
  pending:Promise<void>|null=null;
  constructor(readonly filename:string) {}
  async refresh() {
    if(this.pending)return this.pending;
    if(this.current&&Date.now()-this.checked<1000)return;
    this.pending=(async()=>{
      const info=await stat(this.filename);
      const stamp=info.mtimeMs+':'+info.size;
      if(stamp!==this.stamp){
        const next=publication(JSON.parse(await readFile(this.filename,'utf8')));
        next.records.sort((a,b)=>(Date.parse(b.started_at||'')||0)-(Date.parse(a.started_at||'')||0)||a.id.localeCompare(b.id));
        this.current=next;this.stamp=stamp;
      }
      this.checked=Date.now();
    })();
    try{await this.pending;}finally{this.pending=null;}
  }
  async summary(){await this.refresh();return this.current.summary;}
  async page(params:SearchParams,download=false){
    await this.refresh();this.assertVersion(params.version);
    const all=this.current.records.filter(r=>r.cohort===params.cohort&&(params.provider==='all'||r.provider===params.provider)&&(!params.q||searchable(r,this.current.summary).includes(params.q)));
    const page=Math.min(params.page,Math.max(0,Math.ceil(all.length/8)-1));
    return {version:this.current.summary.version,page,total:all.length,records:download?all:all.slice(page*8,page*8+8).map(listing)};
  }
  async detail(id:string,version:string|null){
    await this.refresh();this.assertVersion(version);
    const record=this.current.records.find(r=>r.id===id);
    if(!record)throw Object.assign(new Error('Result not found'),{status:404});
    return record;
  }
  assertVersion(version:string|null){if(version!==this.current.summary.version)throw Object.assign(new Error('Publication changed; refresh the summary'),{status:409});}
}
