import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260913234552 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "tenancy_store_environment_member" drop constraint if exists "tenancy_store_environment_member_user_id_unique";`);
    this.addSql(`alter table if exists "tenancy_resource_ownership" drop constraint if exists "tenancy_resource_ownership_resource_type_resource_id_unique";`);
    this.addSql(`alter table if exists "tenancy_shopper" drop constraint if exists "tenancy_shopper_store_environment_id_email_unique";`);
    this.addSql(`alter table if exists "tenancy_store_environment" drop constraint if exists "tenancy_store_environment_hostname_unique";`);
    this.addSql(`alter table if exists "tenancy_store_environment" drop constraint if exists "tenancy_store_environment_handle_unique";`);
    this.addSql(`alter table if exists "tenancy_platform_operator" drop constraint if exists "tenancy_platform_operator_user_id_unique";`);
    this.addSql(`create table if not exists "tenancy_organization" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_organization_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_organization_deleted_at" ON "tenancy_organization" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tenancy_platform_operator" ("id" text not null, "user_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_platform_operator_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_platform_operator_user_id_unique" ON "tenancy_platform_operator" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_platform_operator_deleted_at" ON "tenancy_platform_operator" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tenancy_store_environment" ("id" text not null, "handle" text not null, "name" text not null, "hostname" text not null, "status" text check ("status" in ('active', 'suspended')) not null default 'active', "currency_code" text not null default 'eur', "locale" text not null default 'bg-BG', "organization_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_store_environment_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_handle_unique" ON "tenancy_store_environment" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_hostname_unique" ON "tenancy_store_environment" ("hostname") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_organization_id" ON "tenancy_store_environment" ("organization_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_deleted_at" ON "tenancy_store_environment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tenancy_shopper" ("id" text not null, "email" text not null, "medusa_customer_id" text null, "store_environment_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_shopper_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_shopper_store_environment_id" ON "tenancy_shopper" ("store_environment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_shopper_deleted_at" ON "tenancy_shopper" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_shopper_store_environment_id_email_unique" ON "tenancy_shopper" ("store_environment_id", "email") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tenancy_resource_ownership" ("id" text not null, "resource_type" text check ("resource_type" in ('sales_channel', 'api_key', 'stock_location', 'shipping_profile', 'shipping_option', 'product', 'inventory_item', 'promotion', 'cart', 'order')) not null, "resource_id" text not null, "store_environment_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_resource_ownership_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_resource_ownership_store_environment_id" ON "tenancy_resource_ownership" ("store_environment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_resource_ownership_deleted_at" ON "tenancy_resource_ownership" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_resource_ownership_resource_type_resource_id_unique" ON "tenancy_resource_ownership" ("resource_type", "resource_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_resource_ownership_store_environment_id_resource_type" ON "tenancy_resource_ownership" ("store_environment_id", "resource_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "tenancy_store_environment_member" ("id" text not null, "user_id" text not null, "role" text check ("role" in ('owner', 'staff')) not null default 'owner', "store_environment_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tenancy_store_environment_member_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_member_user_id_unique" ON "tenancy_store_environment_member" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_member_store_environment_id" ON "tenancy_store_environment_member" ("store_environment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tenancy_store_environment_member_deleted_at" ON "tenancy_store_environment_member" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "tenancy_store_environment" add constraint "tenancy_store_environment_organization_id_foreign" foreign key ("organization_id") references "tenancy_organization" ("id") on update cascade;`);

    this.addSql(`alter table if exists "tenancy_shopper" add constraint "tenancy_shopper_store_environment_id_foreign" foreign key ("store_environment_id") references "tenancy_store_environment" ("id") on update cascade;`);

    this.addSql(`alter table if exists "tenancy_resource_ownership" add constraint "tenancy_resource_ownership_store_environment_id_foreign" foreign key ("store_environment_id") references "tenancy_store_environment" ("id") on update cascade;`);

    this.addSql(`alter table if exists "tenancy_store_environment_member" add constraint "tenancy_store_environment_member_store_environment_id_foreign" foreign key ("store_environment_id") references "tenancy_store_environment" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "tenancy_store_environment" drop constraint if exists "tenancy_store_environment_organization_id_foreign";`);

    this.addSql(`alter table if exists "tenancy_shopper" drop constraint if exists "tenancy_shopper_store_environment_id_foreign";`);

    this.addSql(`alter table if exists "tenancy_resource_ownership" drop constraint if exists "tenancy_resource_ownership_store_environment_id_foreign";`);

    this.addSql(`alter table if exists "tenancy_store_environment_member" drop constraint if exists "tenancy_store_environment_member_store_environment_id_foreign";`);

    this.addSql(`drop table if exists "tenancy_organization" cascade;`);

    this.addSql(`drop table if exists "tenancy_platform_operator" cascade;`);

    this.addSql(`drop table if exists "tenancy_store_environment" cascade;`);

    this.addSql(`drop table if exists "tenancy_shopper" cascade;`);

    this.addSql(`drop table if exists "tenancy_resource_ownership" cascade;`);

    this.addSql(`drop table if exists "tenancy_store_environment_member" cascade;`);
  }

}
