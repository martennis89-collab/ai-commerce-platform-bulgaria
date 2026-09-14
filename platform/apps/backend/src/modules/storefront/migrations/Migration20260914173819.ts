import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914173819 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "storefront_deployment" drop constraint if exists "storefront_deployment_request_key_unique";`);
    this.addSql(`alter table if exists "storefront_deployment" add column if not exists "lease_owner" text null, add column if not exists "lease_token" text null, add column if not exists "lease_expires_at" timestamptz null, add column if not exists "attempts" integer not null default 0, add column if not exists "request_key" text null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_storefront_deployment_request_key_unique" ON "storefront_deployment" ("request_key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_storefront_deployment_request_key_unique";`);
    this.addSql(`alter table if exists "storefront_deployment" drop column if exists "lease_owner", drop column if exists "lease_token", drop column if exists "lease_expires_at", drop column if exists "attempts", drop column if exists "request_key";`);
  }

}
