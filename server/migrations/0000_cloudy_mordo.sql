CREATE SCHEMA "trace_dashboard";
--> statement-breakpoint
CREATE TABLE "trace_dashboard"."publications" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_dashboard"."results" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"cohort" text NOT NULL,
	"provider" text NOT NULL,
	"search_text" text NOT NULL,
	"started_ms" bigint NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "results_page_idx" ON "trace_dashboard"."results" USING btree ("cohort","started_ms","id");--> statement-breakpoint
CREATE INDEX "results_provider_idx" ON "trace_dashboard"."results" USING btree ("cohort","provider","started_ms","id");