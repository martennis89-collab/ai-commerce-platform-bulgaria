import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914172427 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "tenancy_resource_ownership" drop constraint if exists "tenancy_resource_ownership_resource_type_check";`);

    this.addSql(`alter table if exists "tenancy_resource_ownership" add constraint "tenancy_resource_ownership_resource_type_check" check("resource_type" in ('sales_channel', 'api_key', 'stock_location', 'shipping_profile', 'shipping_option', 'product', 'inventory_item', 'promotion', 'cart', 'order', 'media_file'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "tenancy_resource_ownership" drop constraint if exists "tenancy_resource_ownership_resource_type_check";`);

    this.addSql(`alter table if exists "tenancy_resource_ownership" add constraint "tenancy_resource_ownership_resource_type_check" check("resource_type" in ('sales_channel', 'api_key', 'stock_location', 'shipping_profile', 'shipping_option', 'product', 'inventory_item', 'promotion', 'cart', 'order'));`);
  }

}
