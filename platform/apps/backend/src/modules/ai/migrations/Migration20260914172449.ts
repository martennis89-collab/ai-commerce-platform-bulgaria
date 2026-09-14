import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914172449 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ai_prompt_queue" drop constraint if exists "ai_prompt_queue_run_id_sequence_unique";`);
    this.addSql(`alter table if exists "ai_media_asset" drop constraint if exists "ai_media_asset_file_id_unique";`);
    this.addSql(`alter table if exists "ai_business_profile" drop constraint if exists "ai_business_profile_store_environment_id_unique";`);
    this.addSql(`alter table if exists "ai_action" drop constraint if exists "ai_action_idempotency_key_unique";`);
    this.addSql(`create table if not exists "ai_action" ("id" text not null, "store_environment_id" text not null, "run_id" text null, "task_id" text null, "tool" text not null, "risk" integer not null, "idempotency_key" text not null, "status" text check ("status" in ('started', 'succeeded', 'failed')) not null default 'started', "input" jsonb not null, "input_hash" text not null, "result" jsonb null, "error" text null, "actor" jsonb not null, "started_at" timestamptz not null, "finished_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_action_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_action_idempotency_key_unique" ON "ai_action" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_action_deleted_at" ON "ai_action" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_business_profile" ("id" text not null, "store_environment_id" text not null, "description" text null, "facts" jsonb null, "brand" jsonb null, "language" text not null default 'bg-BG', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_business_profile_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_business_profile_store_environment_id_unique" ON "ai_business_profile" ("store_environment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_business_profile_deleted_at" ON "ai_business_profile" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_generation" ("id" text not null, "store_environment_id" text not null, "run_id" text not null, "task_id" text null, "kind" text check ("kind" in ('business_profile', 'brand', 'product_draft', 'image_attachment', 'storefront_config', 'offer_suggestion')) not null, "status" text check ("status" in ('proposed', 'applied', 'rejected', 'superseded')) not null default 'proposed', "payload" jsonb not null, "provenance" jsonb not null, "resource_type" text null, "resource_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_generation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_generation_deleted_at" ON "ai_generation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_media_asset" ("id" text not null, "store_environment_id" text not null, "file_id" text not null, "url" text not null, "mime_type" text not null, "size_bytes" integer not null, "sha256" text not null, "original_name" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_media_asset_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_media_asset_file_id_unique" ON "ai_media_asset" ("file_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_media_asset_deleted_at" ON "ai_media_asset" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_media_asset_store_environment_id" ON "ai_media_asset" ("store_environment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_run" ("id" text not null, "store_environment_id" text not null, "kind" text check ("kind" in ('initial_generation')) not null, "status" text check ("status" in ('queued', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled')) not null default 'queued', "requested_by" text not null, "input" jsonb not null, "limits" jsonb not null, "usage" jsonb null, "current_step" text null, "progress" integer not null default 0, "error" text null, "cancel_requested_at" timestamptz null, "pause_requested_at" timestamptz null, "started_at" timestamptz null, "finished_at" timestamptz null, "deadline_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_run_deleted_at" ON "ai_run" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_run_store_environment_id_status" ON "ai_run" ("store_environment_id", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_prompt_queue" ("id" text not null, "store_environment_id" text not null, "sequence" integer not null, "prompt" text not null, "status" text check ("status" in ('queued', 'processing', 'processed', 'rejected')) not null default 'queued', "result" jsonb null, "error" text null, "processed_at" timestamptz null, "run_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_prompt_queue_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_prompt_queue_run_id" ON "ai_prompt_queue" ("run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_prompt_queue_deleted_at" ON "ai_prompt_queue" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_prompt_queue_run_id_sequence_unique" ON "ai_prompt_queue" ("run_id", "sequence") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_task" ("id" text not null, "store_environment_id" text not null, "task_key" text check ("task_key" in ('brand', 'catalogue', 'images', 'storefront', 'offers')) not null, "status" text check ("status" in ('queued', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled')) not null default 'queued', "depends_on" jsonb not null, "attempt" integer not null default 0, "max_attempts" integer not null default 3, "instruction" text null, "prompt_id" text null, "superseded_by" text null, "current_step" text null, "progress" integer not null default 0, "lease_owner" text null, "lease_token" text null, "lease_expires_at" timestamptz null, "heartbeat_at" timestamptz null, "tool_calls" integer not null default 0, "result" jsonb null, "error" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "run_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_task_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_task_run_id" ON "ai_task" ("run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_task_deleted_at" ON "ai_task" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_task_status_lease_expires_at" ON "ai_task" ("status", "lease_expires_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_task_store_environment_id" ON "ai_task" ("store_environment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ai_prompt_queue" add constraint "ai_prompt_queue_run_id_foreign" foreign key ("run_id") references "ai_run" ("id") on update cascade;`);

    this.addSql(`alter table if exists "ai_task" add constraint "ai_task_run_id_foreign" foreign key ("run_id") references "ai_run" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "ai_prompt_queue" drop constraint if exists "ai_prompt_queue_run_id_foreign";`);

    this.addSql(`alter table if exists "ai_task" drop constraint if exists "ai_task_run_id_foreign";`);

    this.addSql(`drop table if exists "ai_action" cascade;`);

    this.addSql(`drop table if exists "ai_business_profile" cascade;`);

    this.addSql(`drop table if exists "ai_generation" cascade;`);

    this.addSql(`drop table if exists "ai_media_asset" cascade;`);

    this.addSql(`drop table if exists "ai_run" cascade;`);

    this.addSql(`drop table if exists "ai_prompt_queue" cascade;`);

    this.addSql(`drop table if exists "ai_task" cascade;`);
  }

}
