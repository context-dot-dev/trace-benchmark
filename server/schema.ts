import type { Observation } from './types.ts';
import type { publication } from './publication.js';
import { pgSchema, text, jsonb, bigint, index } from 'drizzle-orm/pg-core';
export const dashboard=pgSchema('trace_dashboard');
export const publications=dashboard.table('publications',{
  id:text('id').primaryKey(),version:text('version').notNull(),summary:jsonb('summary').$type<ReturnType<typeof publication>['summary']>().notNull(),
});
export const results=dashboard.table('results',{
  id:text('id').primaryKey(),fingerprint:text('fingerprint').notNull(),cohort:text('cohort').notNull(),
  provider:text('provider').notNull(),searchText:text('search_text').notNull(),
  startedMs:bigint('started_ms',{mode:'number'}).notNull(),record:jsonb('record').$type<Observation>().notNull(),
},table=>[index('results_page_idx').on(table.cohort,table.startedMs.desc(),table.id),index('results_provider_idx').on(table.cohort,table.provider,table.startedMs.desc(),table.id)]);
