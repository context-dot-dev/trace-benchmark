import {useEffect,useRef,useState} from 'react';
import {ProviderLogo} from './provider-logo';
import {pct} from './model';

const dollars=value=>`$${value.toFixed(2)}`;
const cost=p=>dollars(p.comparisonPriceLow)===dollars(p.comparisonPrice)?dollars(p.comparisonPrice):`${dollars(p.comparisonPriceLow)}–${dollars(p.comparisonPrice)}`;

export function ValueChart({prices}) {
  const container=useRef(null);
  const [width,setWidth]=useState(640);
  const [selected,setSelected]=useState(null);
  useEffect(()=>{
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,entry.contentRect.width)));
    if(container.current)observer.observe(container.current);
    return ()=>observer.disconnect();
  },[]);
  const points=prices.filter(p=>p.comparisonPrice!==null&&p.quality!==null);
  const active=points.find(p=>p.id===selected)||points[0];
  const height=370,left=44,right=width-24,top=28,bottom=312;
  const maxPrice=Math.max(...points.map(p=>p.comparisonPrice),.1);
  const magnitude=10**Math.floor(Math.log10(maxPrice));
  const xMax=Math.ceil(maxPrice*1.2/magnitude)*magnitude;
  const yMin=Math.max(0,Math.floor((Math.min(...points.map(p=>p.quality),1)-.1)*10)/10);
  const x=value=>left+value/xMax*(right-left);
  const y=value=>bottom-(value-yMin)/(1-yMin)*(bottom-top);
  let previous=top-48;
  const labels=[...points].sort((a,b)=>b.quality-a.quality).map(p=>{
    const labelY=Math.max(y(p.quality),previous+48);previous=labelY;
    return {...p,labelY};
  });
  const shift=Math.max(0,(labels.at(-1)?.labelY||0)-(bottom-24));
  return <figure className="value-chart" ref={container} aria-label="Scraper quality versus cost">
    <figcaption><span>Quality · Useful content (%) ↑</span><span>↖ Higher quality, lower cost</span></figcaption>
    {points.length ? <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-label="Quality versus cost scatter plot">
        {[0,1,2,3,4].map(i=>{
          const value=yMin+(1-yMin)*i/4;
          return <g key={i}><line className="value-grid" x1={left} x2={right} y1={y(value)} y2={y(value)}/><text className="value-axis" x={left-9} y={y(value)+4} textAnchor="end">{Number((value*100).toFixed(1))}%</text></g>;
        })}
        {[0,1,2,3,4].map(i=><g key={i}><line className="value-grid" x1={x(xMax*i/4)} x2={x(xMax*i/4)} y1={top} y2={bottom}/><text className="value-axis" x={x(xMax*i/4)} y={bottom+22} textAnchor="middle">${Number((xMax*i/4).toPrecision(3))}</text></g>)}
        <text className="value-axis-title" x={(left+right)/2} y={height-6} textAnchor="middle">Estimated cost per 1,000 attempts</text>
        {labels.map(p=>{
          const px=x(p.comparisonPrice),py=y(p.quality),ly=p.labelY-shift;
          const lx=Math.max(left+4,Math.min(px+16,right-180));
          return <g key={p.id} data-provider={p.id} className="value-point" tabIndex={0} role="button" aria-pressed={p.id===active?.id} aria-label={`${p.name}: ${pct(p.quality)} useful content, ${cost(p)} per 1,000 attempts, ${p.plan.name}`} onFocus={()=>setSelected(p.id)} onClick={()=>setSelected(p.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(p.id);}}}>
            <title>{`${p.name} · ${p.plan.name} · ${pct(p.quality)} · ${cost(p)} / 1k attempts`}</title>
            {p.comparisonPriceLow<p.comparisonPrice&&<line className="value-uncertainty" x1={x(p.comparisonPriceLow)} x2={px} y1={py} y2={py}/>}
            {p.qualityUpper>p.quality&&<line className="value-uncertainty" x1={px} x2={px} y1={y(p.qualityUpper)} y2={py}/>}
            <path className="value-leader" d={`M${px},${py} L${lx-4},${ly}`}/>
            <circle className="value-anchor" cx={px} cy={py} r={p.id===active?.id?4:3}/>
            <rect className="value-label-bg" x={lx-3} y={ly-13} width="184" height="42" rx="4"/>
            <image href={`./logos/${p.id}.${p.id==='exa'?'svg':'png'}`} x={lx} y={ly-9} width="18" height="18"/>
            <text className="value-label" x={lx+24} y={ly+4}>{p.name}</text>
            <text className="value-label-metrics" x={lx+24} y={ly+20}>{pct(p.quality)} · {cost(p)}</text>
          </g>;
        })}
      </svg>
      <div className="value-reading" aria-live="polite"><ProviderLogo id={active.id}/><div><strong>{active.name}</strong> · {pct(active.quality)} useful · {cost(active)} / 1k attempts<span>{active.plan.name} · {active.success.toLocaleString('en-US')} / {active.count.toLocaleString('en-US')} pages{active.unknown>0?` · ${active.unknown} pending review`:''}</span></div></div>
    </> : <p className="micro">No priced results for this page set yet.</p>}
    {prices.filter(p=>p.comparisonPrice===null&&p.quality!==null).map(p=><p className="micro" key={p.id}>{p.name} is not plotted: billing evidence or the selected tariff is incomplete.</p>)}
  <p className="micro">Points use the upper cost estimate. Horizontal lines show the modeled cost range; vertical lines show pending judgments.</p>
  </figure>;
}
