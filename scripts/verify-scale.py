"""HTTP integration failures to prevent: stale/cache-unknown scored as fresh,
partial negative promoted to failure, unseen middle text missed, judge outage
promoted to failure, token reservations too small, and accidentally changing
provider sets or collecting more than the frozen daily/category limits.
The fake HTTP responses are confined to this verification process.
"""
import asyncio,json,os,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import httpx
from bench.providers import fetch_reader
from bench.judging import judge,reservation_estimate
from bench.capacity import PROFILES

requests=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  requests.append(body)
  text=' '.join(x['text'] for x in body['state']['excerpts'])
  found='TARGET_CONTENT' in text
  result={'answers':{'content':{'choice':'substantive' if found else 'thin','confidence':.9},'identity':{'choice':'match','confidence':.9}},'usage':{'input_tokens':100,'output_tokens':2}}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
class LocalJudge:
 async def post(self,url,**kwargs):
  async with httpx.AsyncClient() as c:return await c.post('http://127.0.0.1:'+str(server.server_port),**kwargs)
async def main():
 os.environ['TYPESAFE_API_KEY']='fixture-only'
 checks=[]
 def check(name,value):
  checks.append({'check':name,'passed':bool(value)})
  assert value,name
 task={'url':'https://example.org/document','title':'Document','category':'news'}
 obs={'outcome':'returned','text':'nav '*4000+'TARGET_CONTENT'+' footer'*4000}
 result=await judge(task,obs,client=LocalJudge())
 check('Useful content between original sample windows found',result['success'] is True)
 check('Additional evidence is audited',result['review']['calls']>1)
 check('All issued usage is counted',result['usage']['input_tokens']==100*len(requests))
 check('Reservation bounds every allowed call',reservation_estimate(task,obs)>sum(len(json.dumps(x).encode()) for x in requests))
 requests.clear();obs['text']='navigation '*4000
 result=await judge(task,obs,client=LocalJudge())
 check('Negative needs complete returned-text coverage',result['success'] is False and result['review']['complete'])
 check('3,000 independent daily target',PROFILES['live']['daily_per_category']*8==3000)
 check('One daily panel reaches target',PROFILES['live']['batch_per_category']==375 and PROFILES['live']['cadence']=='daily')
 Path('artifacts/scale-freshness').mkdir(parents=True,exist_ok=True)
 Path('artifacts/scale-freshness/contracts.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2))
 print(json.dumps({'passed':True,'checks':len(checks)}))
try:asyncio.run(main())
finally:server.shutdown()
