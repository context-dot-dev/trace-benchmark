CREATE TABLE "scraping_bench"."audits" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"run_id" text NOT NULL,
	"provider" text NOT NULL,
	"rubric" text NOT NULL,
	"label" text NOT NULL,
	"reviewer" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraping_bench"."grades" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"run_id" text NOT NULL,
	"rubric" text NOT NULL,
	"success" boolean,
	"access" text,
	"content" text,
	"identity" text,
	"confidence" double precision,
	"error" text,
	"input_tokens" integer,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scraping_bench"."attempts" ADD COLUMN "final_url" text;--> statement-breakpoint
ALTER TABLE "scraping_bench"."grades" ADD CONSTRAINT "grades_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "scraping_bench"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_run_idx" ON "scraping_bench"."audits" USING btree ("run_id","rubric");--> statement-breakpoint
CREATE INDEX "grade_run_idx" ON "scraping_bench"."grades" USING btree ("run_id","rubric");