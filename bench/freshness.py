"""Audit the actual request and provider-reported cache evidence separately."""
POLICIES={
 'context':{'parameter':'maxAgeMs','value':0,'location':'params'},
 'exa':{'parameter':'maxAgeHours','value':0,'location':'json'},
 'firecrawl':{'parameter':'maxAge','value':0,'location':'json'},
 'keenable':{'parameter':'live','value':'true','location':'params'},
}


def audit(provider,request,cache):
    policy=POLICIES.get(provider)
    if not policy:return {'requested':False,'evidence':'unreported'}
    location='json' if provider=='context' and request.get('method')=='POST' else policy['location']
    value=(request.get(location) or {}).get(policy['parameter'])
    requested=type(value) is type(policy['value']) and value==policy['value']
    evidence='unreported'
    if provider=='context':
        if cache.get('status')=='hit' or (isinstance(cache.get('age_ms'),(float,int)) and cache['age_ms']>0):evidence='cached_reported'
        elif cache.get('status')=='miss' and cache.get('age_ms')==0:evidence='fresh_reported'
    elif provider=='exa':
        sources=[s.get('source') for s in cache.get('statuses',[]) if isinstance(s,dict)]
        if any(s=='cached' for s in sources):evidence='cached_reported'
        elif sources and all(s=='crawled' for s in sources):evidence='fresh_reported'
    elif provider=='firecrawl':
        source=cache.get('source')
        if source=='cache':evidence='cached_reported'
        elif source=='scrape':evidence='fresh_reported'
    return {'requested':requested,'parameter':policy['parameter'],'value':value,'evidence':evidence}
