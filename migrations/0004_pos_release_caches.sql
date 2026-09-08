CREATE TABLE IF NOT EXISTS "pos_release_caches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo_url" text NOT NULL,
  "releases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "verified_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "pos_release_caches_repo_url_unique" UNIQUE("repo_url")
);