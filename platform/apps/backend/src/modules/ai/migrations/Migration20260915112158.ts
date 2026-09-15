import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260915112158 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ai_designer_message" drop constraint if exists "ai_designer_message_session_id_sequence_unique";`);
    this.addSql(`create table if not exists "ai_designer_session" ("id" text not null, "store_environment_id" text not null, "project_id" text not null, "created_by" text not null, "status" text check ("status" in ('active', 'archived')) not null default 'active', "last_message_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_designer_session_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_session_deleted_at" ON "ai_designer_session" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_session_store_environment_id_status" ON "ai_designer_session" ("store_environment_id", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ai_designer_message" ("id" text not null, "store_environment_id" text not null, "sequence" integer not null, "role" text check ("role" in ('merchant', 'assistant')) not null, "content" text not null, "status" text check ("status" in ('queued', 'running', 'completed', 'failed', 'cancelled')) not null default 'completed', "selected_element" jsonb null, "base_revision_id" text null, "run_id" text null, "result" jsonb null, "error_code" text null, "session_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_designer_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_message_session_id" ON "ai_designer_message" ("session_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_message_deleted_at" ON "ai_designer_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_designer_message_session_id_sequence_unique" ON "ai_designer_message" ("session_id", "sequence") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_message_store_environment_id_role_created_at" ON "ai_designer_message" ("store_environment_id", "role", "created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_designer_message_run_id" ON "ai_designer_message" ("run_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ai_designer_message" add constraint "ai_designer_message_session_id_foreign" foreign key ("session_id") references "ai_designer_session" ("id") on update cascade;`);

    this.addSql(`alter table if exists "ai_run" drop constraint if exists "ai_run_kind_check";`);

    this.addSql(`alter table if exists "ai_task" drop constraint if exists "ai_task_task_key_check";`);

    this.addSql(`alter table if exists "ai_run" add constraint "ai_run_kind_check" check("kind" in ('initial_generation', 'designer_edit'));`);

    this.addSql(`alter table if exists "ai_task" add constraint "ai_task_task_key_check" check("task_key" in ('brand', 'catalogue', 'images', 'storefront', 'offers', 'designer'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "ai_designer_message" drop constraint if exists "ai_designer_message_session_id_foreign";`);

    this.addSql(`drop table if exists "ai_designer_session" cascade;`);

    this.addSql(`drop table if exists "ai_designer_message" cascade;`);

    this.addSql(`alter table if exists "ai_run" drop constraint if exists "ai_run_kind_check";`);

    this.addSql(`alter table if exists "ai_task" drop constraint if exists "ai_task_task_key_check";`);

    this.addSql(`alter table if exists "ai_run" add constraint "ai_run_kind_check" check("kind" in ('initial_generation'));`);

    this.addSql(`alter table if exists "ai_task" add constraint "ai_task_task_key_check" check("task_key" in ('brand', 'catalogue', 'images', 'storefront', 'offers'));`);
  }

}
