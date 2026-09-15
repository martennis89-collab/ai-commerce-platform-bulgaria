/**
 * Storefront revisions (Level 3 §4, M3).
 *
 * - Append-only: a revision's config is written once and never updated.
 * - One head per project: every commit names the parent it was based on and
 *   succeeds only if that parent is still the head (optimistic concurrency).
 *   A stale writer — a merchant with an old page, or an AI turn racing a
 *   restore — gets a conflict instead of silently overwriting newer work.
 * - Idempotent: a commit with an action key that already created a revision
 *   returns that revision (a replayed AI tool call never adds a second one).
 * - Monotonic: sequences are allocated under the project row lock.
 *
 * Every function takes the store environment id established by the server
 * and treats rows of other environments as not found.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, generateEntityId, MedusaError } from "@medusajs/framework/utils"
import { parseStorefrontConfig, STOREFRONT_SCHEMA_VERSION, StorefrontConfig } from "@platform/storefront-schema"

export type RevisionAuthor = { type: "system" | "merchant" | "ai"; user_id: string | null }

export type RevisionRow = {
  id: string
  project_id: string
  store_environment_id: string
  sequence: number
  parent_revision_id: string | null
  state: "draft" | "preview" | "published" | "superseded"
  schema_version: number
  config: StorefrontConfig
  author_type: RevisionAuthor["type"]
  author_user_id: string | null
  action_key: string | null
  designer_message_id: string | null
  restored_from_revision_id: string | null
  summary: string
  created_at: Date
}

/** The draft moved on since the caller read it. Maps to HTTP 409. */
export class RevisionConflictError extends MedusaError {
  constructor() {
    super(MedusaError.Types.CONFLICT, "The draft was changed in the meantime")
    this.name = "RevisionConflictError"
  }
}

const notFound = (what: string) => new MedusaError(MedusaError.Types.NOT_FOUND, `${what} not found`)

const knexOf = (container: MedusaContainer): any => container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

async function rows<T = any>(executor: any, sql: string, bindings: unknown[] = []): Promise<T[]> {
  return ((await executor.raw(sql, bindings))?.rows ?? []) as T[]
}

const REVISION_COLUMNS = `id, project_id, store_environment_id, sequence, parent_revision_id, state, schema_version, config,
  author_type, author_user_id, action_key, designer_message_id, restored_from_revision_id, summary, created_at`

async function insertRevision(
  trx: any,
  project: { id: string; store_environment_id: string; revision_sequence: number },
  input: {
    parentRevisionId: string | null
    config: StorefrontConfig
    author: RevisionAuthor
    summary: string
    actionKey?: string | null
    designerMessageId?: string | null
    restoredFromRevisionId?: string | null
  }
): Promise<RevisionRow> {
  const sequence = Number(project.revision_sequence) + 1
  const [revision] = await rows<RevisionRow>(
    trx,
    `INSERT INTO storefront_revision
       (id, project_id, store_environment_id, sequence, parent_revision_id, state, schema_version, config,
        author_type, author_user_id, action_key, designer_message_id, restored_from_revision_id, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, now(), now())
     RETURNING ${REVISION_COLUMNS}`,
    [
      generateEntityId(undefined, "srev"),
      project.id,
      project.store_environment_id,
      sequence,
      input.parentRevisionId,
      STOREFRONT_SCHEMA_VERSION,
      JSON.stringify(input.config),
      input.author.type,
      input.author.user_id,
      input.actionKey ?? null,
      input.designerMessageId ?? null,
      input.restoredFromRevisionId ?? null,
      input.summary.slice(0, 200),
    ]
  )
  await rows(
    trx,
    `UPDATE storefront_project
        SET head_revision_id = ?, revision_sequence = ?, config = ?::jsonb, updated_at = now()
      WHERE id = ?`,
    [revision.id, sequence, JSON.stringify(input.config), project.id]
  )
  return revision
}

async function lockProject(trx: any, projectId: string, storeEnvironmentId: string | null) {
  const [project] = await rows(
    trx,
    `SELECT id, store_environment_id, status, config, head_revision_id, revision_sequence
       FROM storefront_project WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
    [projectId]
  )
  if (!project || (storeEnvironmentId && project.store_environment_id !== storeEnvironmentId)) {
    throw notFound("storefront project")
  }
  return project
}

/** The active project of a store environment. */
export async function activeProjectFor(container: MedusaContainer, storeEnvironmentId: string) {
  const [project] = await rows(
    knexOf(container),
    `SELECT * FROM storefront_project WHERE store_environment_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [storeEnvironmentId]
  )
  if (!project) {
    throw notFound("storefront project")
  }
  return project
}

/**
 * The project's head revision. Projects created before M3 get revision 1 from
 * their existing (upgraded) config on first use.
 */
export async function ensureHeadRevision(
  container: MedusaContainer,
  projectId: string,
  storeEnvironmentId: string | null = null
): Promise<RevisionRow> {
  const knex = knexOf(container)
  return knex.transaction(async (trx: any) => {
    const project = await lockProject(trx, projectId, storeEnvironmentId)
    if (project.head_revision_id) {
      const [head] = await rows<RevisionRow>(trx, `SELECT ${REVISION_COLUMNS} FROM storefront_revision WHERE id = ?`, [
        project.head_revision_id,
      ])
      if (head) {
        return head
      }
    }
    return insertRevision(trx, project, {
      parentRevisionId: null,
      config: parseStorefrontConfig(project.config),
      author: { type: "system", user_id: null },
      summary: "Начална версия",
    })
  })
}

/** Appends a new head revision based on `parentRevisionId`. Throws RevisionConflictError when the head moved. */
export async function commitDraftRevision(
  container: MedusaContainer,
  input: {
    projectId: string
    storeEnvironmentId: string
    parentRevisionId: string
    config: unknown
    author: RevisionAuthor
    summary: string
    actionKey?: string | null
    designerMessageId?: string | null
    restoredFromRevisionId?: string | null
    /**
     * Runs while the project row lock is held, before the parent check. Designer AI commits use it to
     * re-check cancellation and their lease; restore/undo use it to cancel in-flight turns in the same
     * transaction, so the two always serialise on the lock.
     */
    guard?: (trx: any) => Promise<void>
    /**
     * Restore/undo only: the head may have moved past the expected parent solely through AI revisions of
     * designer turns that are cancel-requested (by `guard`, in this transaction). Those revisions are
     * superseded by the restore instead of rejecting it, so a restore always wins against a cancelled turn.
     */
    supersedeCancelledAiRevisions?: boolean
  }
): Promise<RevisionRow> {
  const config = parseStorefrontConfig(input.config)
  const knex = knexOf(container)
  return knex.transaction(async (trx: any) => {
    if (input.actionKey) {
      const [existing] = await rows<RevisionRow>(
        trx,
        `SELECT ${REVISION_COLUMNS} FROM storefront_revision WHERE action_key = ? AND deleted_at IS NULL`,
        [input.actionKey]
      )
      if (existing) {
        if (existing.store_environment_id !== input.storeEnvironmentId || existing.project_id !== input.projectId) {
          throw notFound("storefront revision")
        }
        return existing
      }
    }
    const project = await lockProject(trx, input.projectId, input.storeEnvironmentId)
    if (project.status !== "active") {
      throw notFound("storefront project")
    }
    await input.guard?.(trx)
    let parentRevisionId = input.parentRevisionId
    if (project.head_revision_id !== input.parentRevisionId) {
      if (!input.supersedeCancelledAiRevisions || !(await onlyCancelledAiRevisionsAfter(trx, project.id, input.parentRevisionId))) {
        throw new RevisionConflictError()
      }
      parentRevisionId = project.head_revision_id
    }
    return insertRevision(trx, project, {
      parentRevisionId,
      config,
      author: input.author,
      summary: input.summary,
      actionKey: input.actionKey,
      designerMessageId: input.designerMessageId,
      restoredFromRevisionId: input.restoredFromRevisionId,
    })
  })
}

/** True when every revision after `parentRevisionId` was written by a designer turn whose run is cancel-requested. */
async function onlyCancelledAiRevisionsAfter(trx: any, projectId: string, parentRevisionId: string) {
  const [parent] = await rows(
    trx,
    `SELECT sequence FROM storefront_revision WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [parentRevisionId, projectId]
  )
  if (!parent) {
    return false
  }
  const later = await rows(
    trx,
    `SELECT r.author_type, run.cancel_requested_at
       FROM storefront_revision r
       LEFT JOIN ai_designer_message m ON m.id = r.designer_message_id AND m.store_environment_id = r.store_environment_id
       LEFT JOIN ai_run run ON run.id = m.run_id AND run.store_environment_id = r.store_environment_id
      WHERE r.project_id = ? AND r.sequence > ? AND r.deleted_at IS NULL`,
    [projectId, parent.sequence]
  )
  return later.length > 0 && later.every((r) => r.author_type === "ai" && r.cancel_requested_at)
}

/** One revision of the caller's own project, or NOT_FOUND. */
export async function getOwnedRevision(
  container: MedusaContainer,
  storeEnvironmentId: string,
  revisionId: unknown
): Promise<RevisionRow> {
  if (typeof revisionId !== "string" || !/^srev_[0-9A-Z]{26}$/.test(revisionId)) {
    throw notFound("storefront revision")
  }
  const [revision] = await rows<RevisionRow>(
    knexOf(container),
    `SELECT ${REVISION_COLUMNS} FROM storefront_revision
      WHERE id = ? AND store_environment_id = ? AND deleted_at IS NULL`,
    [revisionId, storeEnvironmentId]
  )
  if (!revision) {
    throw notFound("storefront revision")
  }
  return revision
}

/** Revision summaries (newest first) without configs. */
export async function listRevisionSummaries(
  container: MedusaContainer,
  storeEnvironmentId: string,
  projectId: string,
  limit = 50
) {
  return rows(
    knexOf(container),
    `SELECT id, sequence, parent_revision_id, state, author_type, summary, restored_from_revision_id, created_at
       FROM storefront_revision
      WHERE project_id = ? AND store_environment_id = ? AND deleted_at IS NULL
      ORDER BY sequence DESC LIMIT ?`,
    [projectId, storeEnvironmentId, Math.max(1, Math.min(limit, 200))]
  )
}
