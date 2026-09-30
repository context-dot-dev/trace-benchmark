import { useCallback, useEffect, useRef, useState } from 'react';

export function validateSummary(value) {
  if(!value||value.schema_version!==2||typeof value.version!=='string'||!Array.isArray(value.providers)||!Array.isArray(value.runs)||!value.cohorts?.independent?.rows||!value.cohorts?.needle?.rows)throw new Error('Invalid benchmark summary.');
  return value;
}

export function useBenchmark(initialData) {
  const [snapshot,setSnapshot]=useState({data:initialData||null,loading:!initialData,error:null});
  const dataRef=useRef(initialData||null);
  const requestRef=useRef(null);
  const refresh=useCallback(async()=>{
    if(requestRef.current)return;
    const controller=new AbortController();requestRef.current=controller;
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},10000);
    try{
      const response=await fetch('./api/summary',{cache:'no-cache',signal:controller.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}.`);
      const value=validateSummary(await response.json());
      if(dataRef.current&&Date.parse(value.generated_at)<Date.parse(dataRef.current.generated_at))throw new Error('The server returned an older summary.');
      if(value.version!==dataRef.current?.version)dataRef.current=value;
      setSnapshot(s=>s.data===dataRef.current&&!s.error&&!s.loading?s:{data:dataRef.current,loading:false,error:null});
    }catch(error){if(!controller.signal.aborted||timedOut)setSnapshot(s=>({...s,loading:false,error:timedOut?'Summary request timed out.':error.message}));}
    finally{clearTimeout(timeout);requestRef.current=null;}
  },[]);
  useEffect(()=>{if(!dataRef.current)refresh();return()=>requestRef.current?.abort();},[refresh]);
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);return()=>clearInterval(timer);},[refresh]);
  return {...snapshot,refresh};
}
