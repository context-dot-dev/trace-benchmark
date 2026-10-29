CREATE SCHEMA "scraping_bench";
--> statement-breakpoint
CREATE TABLE "scraping_bench"."attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"day" text NOT NULL,
	"page_id" text NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"state" text NOT NULL,
	"claim" text,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"elapsed_ms" integer,
	"http_status" integer,
	"error" text,
	"success" boolean,
	"content" text,
	"identity" text,
	"confidence" double precision,
	"chars" integer,
	"hash" text,
	"evidence" "bytea",
	"evidence_bytes" integer DEFAULT 0 NOT NULL,
	"judge_calls" integer DEFAULT 0 NOT NULL,
	"credits" double precision,
	"cost_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."budgets" (
	"day" text NOT NULL,
	"bucket" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "budgets_day_bucket_pk" PRIMARY KEY("day","bucket")
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"organization" text NOT NULL,
	"source_id" text NOT NULL,
	"discovered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."runs" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"protocol" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."seen" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."sources" (
	"id" text PRIMARY KEY NOT NULL,
	"next_poll" timestamp with time zone NOT NULL,
	"last_poll" timestamp with time zone,
	"count" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."worker" (
	"id" text PRIMARY KEY NOT NULL,
	"claim" text,
	"lease_until" timestamp with time zone,
	"last_tick" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "scraping_bench"."attempts" ADD CONSTRAINT "attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "scraping_bench"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_queue_idx" ON "scraping_bench"."attempts" USING btree ("state","day");--> statement-breakpoint
CREATE INDEX "attempt_day_idx" ON "scraping_bench"."attempts" USING btree ("day","provider");--> statement-breakpoint
CREATE INDEX "candidate_category_idx" ON "scraping_bench"."candidates" USING btree ("category","discovered_at");