import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NeonSource } from './neon.ts';

export default async function handler(request:IncomingMessage,response:ServerResponse){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json');
  const secret=process.env.CRON_SECRET;
  const supplied=Buffer.from(request.headers.authorization||'');
  const expected=Buffer.from('Bearer '+(secret||''));
  if(!secret||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){
    response.statusCode=401;response.end(JSON.stringify({error:'Unauthorized'}));return;
  }
  if(process.env.TRACE_WORKER_ENABLED!=='1'){response.end(JSON.stringify({status:'disabled'}));return;}
  const source=new NeonSource(process.env.DATABASE_URL!);
  try{
    const archive=JSON.parse(await source.publicFile('latest.json'));
    await source.publish(archive);
    response.end(JSON.stringify({status:'published',generated_at:archive.generated_at}));
  }catch(error){
    console.error('TRACE publication failed:',error instanceof Error?error.name:'Unknown error');
    response.statusCode=500;response.end(JSON.stringify({error:'Publication failed'}));
  }finally{await source.close();}
}
