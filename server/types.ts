export interface Observation {
  id:string;run_id:string;task_id:string;provider:string;cohort:string;category:string;
  protocol_version:string;success:boolean|null;started_at:string|null;
  title:string;url:string;final_url?:string|null;domain:string;source_id:string;organization?:string;
  outcome:string;elapsed_ms:number|null;cost_usd?:number|null;credits?:number|null;
  output_comparison?:{status:string;winners:string[];[key:string]:unknown}|null;
  browser_recall?:number|null;reference?:{status:string;[key:string]:unknown};run_exclusion?:unknown;
  [key:string]:unknown;
}
export interface Run {
  id:string;started_at:string;finished_at:string|null;status:string;cohort:string;
  selected_count:number;collection_profile?:{cadence?:string};manifest_url:string;exclusion?:unknown;protocol_version:string;
}
export interface Archive {
  schema_version:number;generated_at:string;protocol_version:string;
  records:Observation[];providers:{id:string;name:string;status?:string;status_detail?:string}[];categories:{id:string;label:string}[];runs:Run[];
  discovery?:{receipts:{status:string}[]};
  operations?:{last_tick?:{started_at:string;finished_at:string|null;errors:unknown[]};scheduler_status?:string;next_run_at?:string;collection_profile?:Record<string,unknown>;capacity_plan?:Record<string,unknown>};
  metrics?:{daily:{day:string;cohort:string;provider:string;success_rate:number|null;pages:number;sample_kind?:string}[]};
  supply:Record<string,{inventory:number;new_24h:number;domains:number}>;
}
export interface SearchParams {cohort:string;provider:string;q:string;page:number;version:string|null;}
