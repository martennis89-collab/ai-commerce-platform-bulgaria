import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914223307 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ai_task" drop constraint if exists "ai_task_prompt_id_task_key_unique";`);
    this.addSql(`alter table if exists "ai_generation" drop constraint if exists "ai_generation_idempotency_key_unique";`);
    this.addSql(`alter table if exists "ai_generation" add column if not exists "idempotency_key" text null;`);
    // Backfill keys of generations created before this column existed (review N5).
    this.addSql(`update "ai_generation" set "idempotency_key" = "payload"->>'idempotency_key' where "idempotency_key" is null and "payload"->>'idempotency_key' is not null and "deleted_at" is null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_generation_idempotency_key_unique" ON "ai_generation" ("idempotency_key") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ai_prompt_queue" add column if not exists "lease_token" text null, add column if not exists "lease_expires_at" timestamptz null;`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_task_prompt_id_task_key_unique" ON "ai_task" ("prompt_id", "task_key") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_ai_generation_idempotency_key_unique";`);
    this.addSql(`alter table if exists "ai_generation" drop column if exists "idempotency_key";`);

    this.addSql(`alter table if exists "ai_prompt_queue" drop column if exists "lease_token", drop column if exists "lease_expires_at";`);

    this.addSql(`drop index if exists "IDX_ai_task_prompt_id_task_key_unique";`);
  }

}
