import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogClose } from '@/components/ui/dialog';
import { ResultsTable } from './benchmark-tables';
import { Outcome, Json, SourceLink } from './controls';
import { finite, human, fmt, secs } from './model';

export default function ResultsBrowser({data,cohort,provider,setProvider,refresh}) {
  const [search,setSearch]=useState('');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const [retry,setRetry]=useState(0);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [inspection,setInspection]=useState(null);
  const inspectTrigger=useRef(null);
  const detailRequest=useRef(null);
  const categoryName=id=>data.categories.find(c=>c.id===id)?.label||human(id);
  const providerName=id=>data.providers.find(p=>p.id===id)?.name||human(id);
  const params=new URLSearchParams({cohort,provider,q:query,page:String(page),version:data.version});
  const endpoint='./api/results?'+params;
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(0);},200);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{setPage(0);},[cohort,provider,data.version]);
  useEffect(()=>{
    let disposed=false;const controller=new AbortController();setLoading(true);setError(null);
    const timeout=setTimeout(()=>controller.abort(),10000);
    fetch(endpoint,{signal:controller.signal}).then(async response=>{
      if(response.status===409){await refresh();throw new Error('Results changed. Refreshing the publication.');}
      if(!response.ok)throw new Error('Could not load this page of results.');
      return response.json();
    }).then(value=>{if(!controller.signal.aborted)setResult(value);})
      .catch(error=>{if(!disposed)setError(error.name==='AbortError'?'The results request timed out. Try again.':error.message);})
      .finally(()=>{clearTimeout(timeout);if(!disposed)setLoading(false);});
    return()=>{disposed=true;clearTimeout(timeout);controller.abort();};
  },[endpoint,retry,refresh]);
  useEffect(()=>()=>detailRequest.current?.abort(),[]);
  async function inspect(record,trigger){
    detailRequest.current?.abort();const controller=new AbortController();detailRequest.current=controller;
    inspectTrigger.current=trigger;setInspection({title:record.title,loading:true});
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},10000);
    try{
      const response=await fetch('./api/result?'+new URLSearchParams({id:record.id,version:data.version}),{signal:controller.signal});
      if(!response.ok)throw new Error(response.status===409?'This publication changed. Close this dialog and refresh results.':'Could not load this result.');
      const detail=await response.json();if(!controller.signal.aborted)setInspection({record:detail});
    }catch(error){if(!controller.signal.aborted||timedOut)setInspection({title:record.title,error:timedOut?'The evidence request timed out. Close and reopen this result to retry.':error.message});}
    finally{clearTimeout(timeout);}
  }
  function close(){detailRequest.current?.abort();setInspection(null);}
  function downloadRecord(){
    const url=URL.createObjectURL(new Blob([JSON.stringify(inspection.record,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='trace-observation.json';anchor.click();URL.revokeObjectURL(url);
  }
  const records=loading||error?[]:(result?.records||[]);
  const pages=Math.max(1,Math.ceil((result?.total||0)/8));
  const inspected=inspection?.record;
  return <>
    <p className="section-intro">Open a result to see what the scraper returned and why the model accepted or rejected it.</p>
    <ToggleGroup className="provider-switch" variant="segmented" value={[provider]} onValueChange={v=>v[0]&&setProvider(v[0])} aria-label="Provider"><ToggleGroupItem value="all">All providers</ToggleGroupItem>{data.providers.map(p=><ToggleGroupItem key={p.id} value={p.id}>{p.name}</ToggleGroupItem>)}</ToggleGroup>
    <Field className="search-field"><FieldLabel htmlFor="search">Find a page</FieldLabel><div className="search-input"><Search aria-hidden="true"/><Input id="search" type="search" placeholder="Search title, URL, or page type" value={search} onChange={e=>setSearch(e.target.value)}/></div></Field>
    <div className="results-toolbar"><p id="result-count" className="micro" role="status">{loading?'Loading results…':error?'Results unavailable.':`${result?.total||0} matching results`}</p><a className="micro" href={'./api/download?'+params} download="trace-results.json"><ArrowDownToLine size={14}/> Download results</a></div>
    {error&&<p role="alert">{error} <Button variant="outline" onClick={()=>setRetry(retry+1)}>Retry</Button></p>}
    <ResultsTable records={records} categoryName={categoryName} providerName={providerName} onInspect={inspect}/>
    {!loading&&!error&&!records.length&&<div><h3>No matching results</h3><p>Try another provider or search term.</p><Button variant="outline" onClick={()=>{setProvider('all');setSearch('');setQuery('');setPage(0);}}>Clear filters</Button></div>}
    <div className="pagination"><Button id="prev" variant="outline" disabled={loading||!!error||(result?.page||0)===0} onClick={()=>setPage(Math.max(0,(result?.page||0)-1))}><ArrowLeft/>Previous</Button><span>Page {(result?.page||0)+1} of {pages}</span><Button id="next" variant="outline" disabled={loading||!!error||(result?.page||0)>=pages-1} onClick={()=>setPage((result?.page||0)+1)}>Next<ArrowRight/></Button></div>
    <Dialog open={!!inspection} onOpenChange={open=>{if(!open)close();}}><DialogContent className="inspector" finalFocus={inspectTrigger}>
      <DialogHeader><DialogTitle>{inspected?.title||inspection?.title||'Result'}</DialogTitle><DialogDescription>Returned content and the model’s assessment.</DialogDescription></DialogHeader>
      {inspection?.loading&&<p role="status">Loading evidence…</p>}{inspection?.error&&<p role="alert">{inspection.error}</p>}
      {inspected&&<><div className="dialog-copy">Requested: <SourceLink url={inspected.url}/><br/>Final: <SourceLink url={inspected.final_url}/></div><div className="evidence-meta"><Outcome record={inspected}/><span>{finite(inspected.elapsed_ms)?secs(inspected.elapsed_ms/1000):'Timing unavailable'}</span><span>{fmt(inspected.text_chars)} extracted characters</span></div><div className="evidence-grid"><div><h3>Returned text</h3><pre className="text-preview">{inspected.text_preview||'No returned text preview was published.'}</pre><p className="micro">This preview may omit content. The text hash identifies the full saved response.</p></div><div><h3>Model assessment</h3><Json value={inspected.judgment}/><p className="micro">This assessment has not been independently verified.</p><h3 className="metadata-title">Request details</h3><Json value={Object.fromEntries(Object.entries(inspected).filter(([key])=>!['text_preview','judgment'].includes(key)))}/></div></div></>}
      <div className="dialog-actions">{inspected&&<Button variant="outline" onClick={downloadRecord}><ArrowDownToLine/>Download this result</Button>}<DialogClose render={<Button/>}>Done</DialogClose></div>
    </DialogContent></Dialog>
  </>;
}
