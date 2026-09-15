/**
 * Merchant photo uploads (D2: merchant-uploaded photos only). Validated type,
 * size and file signature; stored under a StoreEnvironment-prefixed key; the
 * file is claimed as a tenancy `media_file` and recorded as a MediaAsset.
 */
import { createHash, randomUUID } from "crypto"
import { z } from "zod"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { AI_MODULE } from "../modules/ai"
import type AiModuleService from "../modules/ai/service"
import { ExecutionContext, requirePermission } from "../tenancy/context"
import { aiLimits } from "./config"

const SIGNATURES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": {
    ext: "png",
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/webp": {
    ext: "webp",
    matches: (b) => b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
}

export const MediaUploadSchema = z.strictObject({
  filename: z.string().min(1).max(200),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  content_base64: z.string().min(8),
})

const invalid = (detail: string) => new MedusaError(MedusaError.Types.INVALID_DATA, detail)

export async function uploadMerchantMedia(ctx: ExecutionContext, rawBody: unknown) {
  requirePermission(ctx, "media:write")
  const parsed = MediaUploadSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw invalid("Invalid media upload")
  }
  const { filename, mime_type, content_base64 } = parsed.data
  const content = content_base64.replace(/\s/g, "")
  const buffer = Buffer.from(content, "base64")
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== content.replace(/=+$/, "")) {
    throw invalid("Upload content must be valid base64")
  }
  if (buffer.length > aiLimits().maxUploadBytes) {
    throw invalid("Upload is too large")
  }
  const signature = SIGNATURES[mime_type]
  if (!signature.matches(buffer)) {
    throw invalid("File content does not match its image type")
  }

  const container = ctx.scope.container
  const env = ctx.scope.storeEnvironmentId
  const fileModule: any = container.resolve(Modules.FILE)
  const file = await fileModule.createFiles({
    filename: `${env}/${randomUUID()}.${signature.ext}`,
    mimeType: mime_type,
    content: buffer.toString("base64"),
    access: "public",
  })
  await ctx.scope.claim("media_file", [file.id])
  const aiService: AiModuleService = container.resolve(AI_MODULE)
  const asset: any = await aiService.createMediaAssets({
    store_environment_id: env,
    file_id: file.id,
    url: file.url,
    mime_type,
    size_bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    original_name: filename.slice(0, 200),
  } as any)
  return { id: asset.id, url: asset.url, mime_type: asset.mime_type, size_bytes: asset.size_bytes }
}

export async function listMerchantMedia(ctx: ExecutionContext) {
  requirePermission(ctx, "ai:read")
  const aiService: AiModuleService = ctx.scope.container.resolve(AI_MODULE)
  const assets = (await aiService.listMediaAssets(
    { store_environment_id: ctx.scope.storeEnvironmentId },
    { take: 200, order: { created_at: "DESC" } }
  )) as any[]
  return assets.map((a) => ({ id: a.id, url: a.url, mime_type: a.mime_type, size_bytes: a.size_bytes }))
}
