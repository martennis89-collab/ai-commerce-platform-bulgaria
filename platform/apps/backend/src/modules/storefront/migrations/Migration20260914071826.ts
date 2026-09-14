import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914071826 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "storefront_project" drop constraint if exists "storefront_project_live_hostname_unique";`);
    this.addSql(`alter table if exists "storefront_project" drop constraint if exists "storefront_project_preview_hostname_unique";`);
    this.addSql(`alter table if exists "storefront_project" drop constraint if exists "storefront_project_handle_unique";`);
    this.addSql(`alter table if exists "storefront_project" drop constraint if exists "storefront_project_store_environment_id_unique";`);
    this.addSql(`create table if not exists "storefront_project" ("id" text not null, "store_environment_id" text not null, "handle" text not null, "template" text not null default 'storefront-core', "core_version" text not null, "deployment_provider" text not null, "repository_ref" text not null, "publishable_api_key_id" text not null, "preview_hostname" text not null, "live_hostname" text not null, "config" jsonb not null, "active_theme" text not null default 'default', "status" text check ("status" in ('active', 'archived')) not null default 'active', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_project_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_project_store_environment_id_unique" ON "storefront_project" ("store_environment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_project_handle_unique" ON "storefront_project" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_project_preview_hostname_unique" ON "storefront_project" ("preview_hostname") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_project_live_hostname_unique" ON "storefront_project" ("live_hostname") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_project_deleted_at" ON "storefront_project" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "storefront_deployment" ("id" text not null, "store_environment_id" text not null, "target" text check ("target" in ('preview', 'live')) not null, "status" text check ("status" in ('queued', 'building', 'ready', 'failed', 'superseded')) not null default 'queued', "provider" text not null, "core_version" text not null, "hostname" text not null, "manifest" jsonb null, "artifact_ref" text null, "url" text null, "error" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "project_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_deployment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_deployment_project_id" ON "storefront_deployment" ("project_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_deployment_deleted_at" ON "storefront_deployment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_deployment_store_environment_id_target_status" ON "storefront_deployment" ("store_environment_id", "target", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "storefront_deployment" add constraint "storefront_deployment_project_id_foreign" foreign key ("project_id") references "storefront_project" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "storefront_deployment" drop constraint if exists "storefront_deployment_project_id_foreign";`);

    this.addSql(`drop table if exists "storefront_project" cascade;`);

    this.addSql(`drop table if exists "storefront_deployment" cascade;`);
  }

}
