CREATE TABLE "scraping_bench"."probes" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"version" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"status" integer,
	"text_chars" integer DEFAULT 0 NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"probed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scraping_bench"."attempts" ADD COLUMN "probe" jsonb;--> statement-breakpoint
CREATE INDEX "probe_time_idx" ON "scraping_bench"."probes" USING btree ("probed_at");