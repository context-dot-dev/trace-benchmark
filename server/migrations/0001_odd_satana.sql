DROP INDEX "trace_dashboard"."results_page_idx";--> statement-breakpoint
DROP INDEX "trace_dashboard"."results_provider_idx";--> statement-breakpoint
CREATE INDEX "results_page_idx" ON "trace_dashboard"."results" USING btree ("cohort","started_ms" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "results_provider_idx" ON "trace_dashboard"."results" USING btree ("cohort","provider","started_ms" DESC NULLS LAST,"id");