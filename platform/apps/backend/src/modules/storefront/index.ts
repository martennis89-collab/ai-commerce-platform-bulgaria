import { Module } from "@medusajs/framework/utils"
import StorefrontModuleService from "./service"

export const STOREFRONT_MODULE = "storefront"

export default Module(STOREFRONT_MODULE, {
  service: StorefrontModuleService,
})
