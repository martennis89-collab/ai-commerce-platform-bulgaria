/**
 * Commerce resource types whose ownership is tracked explicitly.
 *
 * Anything tenant-sensitive that is not listed here (or derivable from a listed
 * type, see `TenantScope`) is inaccessible to every tenant: ownership is
 * fail-closed.
 */
export const OWNED_RESOURCE_TYPES = [
  "sales_channel",
  "api_key",
  "stock_location",
  "shipping_profile",
  "shipping_option",
  "product",
  "inventory_item",
  "promotion",
  "cart",
  "order",
  "media_file",
] as const

export type OwnedResourceType = (typeof OWNED_RESOURCE_TYPES)[number]
