import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260915112327 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "storefront_screenshot" drop constraint if exists "storefront_screenshot_file_id_unique";`);
    this.addSql(`alter table if exists "storefront_revision" drop constraint if exists "storefront_revision_project_id_sequence_unique";`);
    this.addSql(`alter table if exists "storefront_revision" drop constraint if exists "storefront_revision_action_key_unique";`);
    this.addSql(`create table if not exists "storefront_revision" ("id" text not null, "store_environment_id" text not null, "sequence" integer not null, "parent_revision_id" text null, "state" text check ("state" in ('draft', 'preview', 'published', 'superseded')) not null default 'draft', "schema_version" integer not null, "config" jsonb not null, "author_type" text check ("author_type" in ('system', 'merchant', 'ai')) not null, "author_user_id" text null, "action_key" text null, "designer_message_id" text null, "restored_from_revision_id" text null, "summary" text not null, "project_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_revision_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_revision_action_key_unique" ON "storefront_revision" ("action_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_revision_project_id" ON "storefront_revision" ("project_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_revision_deleted_at" ON "storefront_revision" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_revision_project_id_sequence_unique" ON "storefront_revision" ("project_id", "sequence") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_revision_store_environment_id_created_at" ON "storefront_revision" ("store_environment_id", "created_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "storefront_screenshot" ("id" text not null, "store_environment_id" text not null, "project_id" text not null, "deployment_id" text not null, "revision_id" text null, "viewport" text check ("viewport" in ('mobile', 'desktop')) not null, "width" integer not null, "height" integer not null, "file_id" text not null, "url" text not null, "size_bytes" integer not null, "requested_by" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_screenshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_screenshot_file_id_unique" ON "storefront_screenshot" ("file_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_screenshot_deleted_at" ON "storefront_screenshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_screenshot_store_environment_id_created_at" ON "storefront_screenshot" ("store_environment_id", "created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_screenshot_deployment_id" ON "storefront_screenshot" ("deployment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "storefront_revision" add constraint "storefront_revision_project_id_foreign" foreign key ("project_id") references "storefront_project" ("id") on update cascade;`);

    this.addSql(`alter table if exists "storefront_project" add column if not exists "head_revision_id" text null, add column if not exists "preview_revision_id" text null, add column if not exists "revision_sequence" integer not null default 0, add column if not exists "deployment_sequence" integer not null default 0;`);

    this.addSql(`alter table if exists "storefront_deployment" add column if not exists "sequence" integer null, add column if not exists "revision_id" text null, add column if not exists "requested_by" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_deployment_project_id_target_sequence" ON "storefront_deployment" ("project_id", "target", "sequence") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "storefront_revision" cascade;`);

    this.addSql(`drop table if exists "storefront_screenshot" cascade;`);

    this.addSql(`alter table if exists "storefront_project" drop column if exists "head_revision_id", drop column if exists "preview_revision_id", drop column if exists "revision_sequence", drop column if exists "deployment_sequence";`);

    this.addSql(`drop index if exists "IDX_storefront_deployment_project_id_target_sequence";`);
    this.addSql(`alter table if exists "storefront_deployment" drop column if exists "sequence", drop column if exists "revision_id", drop column if exists "requested_by";`);
  }

}
