import 'dotenv/config';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { readFile,stat,realpath } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { ArtifactSource } from './artifact.ts';
import { NeonSource } from './neon.ts';
import { parameters } from './publication.js';

const site=resolve(process.env.TRACE_SITE||'site');
const dataDir=resolve(process.env.TRACE_DATA_DIR||resolve(site,'data'));
const gzipAsync=promisify(gzip);
const url=process.env.DATABASE_URL||process.env.DATABASE_URL_UNPOOLED;
const mode=process.env.TRACE_DASHBOARD_BACKEND||(url?'neon':'artifact');
if(!['neon','artifact'].includes(mode))throw new Error('Invalid TRACE_DASHBOARD_BACKEND');
if(mode==='neon'&&!url)throw new Error('Neon database credentials are required');
const source=mode==='neon'?new NeonSource(url!):new ArtifactSource(resolve(dataDir,'latest.json'));
const {render}=await import(pathToFileURL(resolve('server/render/entry-server.js')).href);
const template=await readFile(resolve(site,'index.html'),'utf8');
const htmlCache=new Map<string,Buffer>();
const wireCache=new Map<string,Buffer>();
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.zip':'application/zip','.md':'text/plain; charset=utf-8'};
function remember(map:Map<string,Buffer>,key:string,value:Buffer){if(map.size>=32)map.delete(map.keys().next().value!);map.set(key,value);return value;}

async function send(req:IncomingMessage,res:ServerResponse,body:Buffer,type:string,headers:Record<string,string>={}){
  const encodings=Object.fromEntries(String(req.headers['accept-encoding']||'').toLowerCase().split(',').map(item=>{const [name,...params]=item.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));return [name,q?Number(q.trim().slice(2)):1];}));
  const compress=(encodings.gzip??encodings['*']??0)>0&&/json|text|javascript|svg/.test(type);
  const hash=createHash('sha256').update(body).digest('hex');
  const etag='"'+hash+(compress?'-gzip':'')+'"';
  const common={'Content-Type':type,'ETag':etag,'Cache-Control':'no-cache','Vary':'Accept-Encoding',...headers};
  if(String(req.headers['if-none-match']||'').split(',').map(s=>s.trim()).includes(etag)){res.writeHead(304,common);res.end();return;}
  let wire=body;
  if(compress){wire=wireCache.get(hash)||remember(wireCache,hash,await gzipAsync(body,{level:5}));}
  res.writeHead(200,{...common,'Content-Length':wire.length,...(compress?{'Content-Encoding':'gzip'}:{})});
  res.end(req.method==='HEAD'?undefined:wire);
}

const server=createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const request=new URL(req.url||'/','http://localhost');
    if(request.pathname==='/trace-source.zip'||request.pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(404);res.end();return;}
    if(request.pathname==='/healthz'){const summary=await source.summary();return await send(req,res,Buffer.from(JSON.stringify({status:'ok',version:summary.version})),'application/json; charset=utf-8');}
    if(request.pathname==='/api/summary')return await send(req,res,Buffer.from(JSON.stringify(await source.summary())),'application/json; charset=utf-8');
    if(request.pathname==='/api/results'||request.pathname==='/api/download'){
      const download=request.pathname==='/api/download';
      const page=await source.page(parameters(request),download);
      return await send(req,res,Buffer.from(JSON.stringify(page)),'application/json; charset=utf-8',download?{'Content-Disposition':'attachment; filename="trace-results.json"'}:{});
    }
    if(request.pathname==='/api/result'){
      const record=await source.detail(request.searchParams.get('id')||'',request.searchParams.get('version'));
      return await send(req,res,Buffer.from(JSON.stringify(record)),'application/json; charset=utf-8');
    }
    if(request.pathname==='/'||request.pathname==='/index.html'){
      const summary=await source.summary();
      const htmlKey=summary.version+':'+Math.floor(Date.now()/60000);
      let html=htmlCache.get(htmlKey);
      if(!html){
        const initialData={...summary,rendered_at:new Date().toISOString()};
        const bootstrap=JSON.stringify(initialData).replace(/</g,'\\u003c');
        html=Buffer.from(template.replace('<div id="root"></div>','<div id="root">'+render(initialData)+'</div>').replace('</head>','<script id="trace-summary" type="application/json">'+bootstrap+'</script></head>'));
        htmlCache.clear();htmlCache.set(htmlKey,html);
      }
      return await send(req,res,html,'text/html; charset=utf-8');
    }
    const isData=request.pathname.startsWith('/data/');
    const root=isData?dataDir:site;
    const path=await realpath(resolve(root,'.'+decodeURIComponent(isData?request.pathname.slice(5):request.pathname)));
    if(!path.startsWith(root+sep)||!(await stat(path)).isFile())throw Object.assign(new Error('Not found'),{status:404});
    return await send(req,res,await readFile(path),types[extname(path)]||'application/octet-stream',/^\/assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(request.pathname)?{'Cache-Control':'public, max-age=31536000, immutable'}:{});
  }catch(error){
    const status=error instanceof Error&&'status' in error&&typeof error.status==='number'?error.status:error instanceof Error&&'code' in error&&error.code==='ENOENT'?404:500;
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:status===500?'Dashboard request failed':error instanceof Error?error.message:'Request failed'}));
    if(status===500)console.error('Dashboard request failed:',error instanceof Error?error.name:'Unknown error');
  }
});
const host=process.env.HOST||'127.0.0.1';
server.listen(Number(process.env.PORT||8794),host,()=>{const address=server.address();console.log('TRACE dashboard: http://'+host+':'+(address&&typeof address==='object'?address.port:address)+' ('+mode+')');});
