import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { NeonSource } from './neon.ts';
const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('Neon DATABASE_URL_UNPOOLED is required');
const source=new NeonSource(url);
try{
  await migrate(source.db,{migrationsFolder:'server/migrations'});
  await source.publish(JSON.parse(await readFile(process.argv[2]||'site/data/latest.json','utf8')));
  console.log('Published benchmark summary and paginated results to Neon.');
}finally{await source.close();}
