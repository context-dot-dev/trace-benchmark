export interface Observation {
  id:string;run_id:string;task_id:string;provider:string;cohort:string;category:string;
  protocol_version:string;success:boolean|null;started_at:string|null;
  title:string;url:string;final_url?:string|null;domain:string;source_id:string;organization?:string;
  outcome:string;elapsed_ms:number|null;cost_usd?:number|null;credits?:number|null;
  output_comparison?:{status:string;winners:string[];[key:string]:unknown}|null;
  browser_recall?:number|null;reference?:{status:string;[key:string]:unknown};run_exclusion?:unknown;
  [key:string]:unknown;
}
export interface Panel {version:string;starts_at:string;expires_at:string;replaces:string|null;}
export interface RoleSample {selected:number;target:number;shortfall:number;categories:Record<string,{selected:number;target:number;shortfall:number}>;}
export interface Run {
  id:string;started_at:string;finished_at:string|null;status:string;cohort:string;
  sample_scores?:Record<string,Record<string,{success_rate:number|null;success_upper_bound:number|null;categories_present:number}>>;
  sampling?:{roles?:Record<string,RoleSample>;control_panel?:Panel;sample_design?:string;first_time_urls:number;repeated_urls:number;publication_age:Record<string,number>;categories:Record<string,{selected:number;first_time:number;repeated:number;target:number|null;shortfall:number|null}>;target:number|null;shortfall:number|null;kind:string;parent_run_id:string|null};
  selected_count:number;collection_profile?:{cadence?:string};manifest_url:string;exclusion?:unknown;protocol_version:string;
}
export interface Archive {
  schema_version:number;generated_at:string;protocol_version:string;
  records:Observation[];providers:{id:string;name:string;status?:string;status_detail?:string}[];categories:{id:string;label:string}[];runs:Run[];
  discovery?:{receipts:{status:string}[]};
  operations?:{last_tick?:{started_at:string;finished_at:string|null;errors:unknown[]};scheduler_status?:string;next_run_at?:string;collection_profile?:Record<string,unknown>;capacity_plan?:Record<string,unknown>};
  metrics?:{sample_daily?:{day:string;cohort:string;provider:string;run_id:string;sample_role:string;control_panel_version:string;success_rate:number|null;pages:number;categories_present:number}[];daily:{day:string;cohort:string;provider:string;success_rate:number|null;pages:number;sample_kind?:string}[]};
  replenishment?:{days:{day:string;new_urls:number;baseline_urls:number;categories:Record<string,number>;polls:number;failed_polls:number}[];definition:string};
  supply:Record<string,{inventory:number;new_24h:number;domains:number}>;
}
export interface SearchParams {cohort:string;provider:string;q:string;page:number;version:string|null;}
