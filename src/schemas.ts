/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { storiesSchema } from './schemas/stories-schema'
import { linesSchema } from './schemas/lines-schema'
import { aiEndingLocksSchema, aiPendingClaimsSchema, aiStubCallsSchema } from './schemas/ai-ending-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  storiesSchema,
  linesSchema,
  aiEndingLocksSchema,
  aiPendingClaimsSchema,
  // Test builds only: __CORPSE_TEST_HOOKS__ is a build-time constant
  // (vite.config.ts `define`), false in every `vite build`. The `typeof`
  // guard matters: the CLI's pre-deploy schema lint bundles this file with
  // plain esbuild (no define), where a bare reference would throw.
  ...(typeof __CORPSE_TEST_HOOKS__ !== 'undefined' && __CORPSE_TEST_HOOKS__ ? [aiStubCallsSchema] : []),
]
