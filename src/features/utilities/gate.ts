/**
 * Utilities feature gate.
 *
 * Utilities (bills / property tax / BC Assessment) is a **House** feature and
 * is deliberately independent of the Budget product.
 *
 * History: the surface used to be mounted by the Budget navigator and gated by
 * `brand.features.budget`, which meant the House tab redirected to Home
 * (`budget: 'minimal'`) while the only brand that could reach it client-side —
 * Budget — was 404'd by the Worker, because the backend has always listed
 * `/households/:householdId/utilities` in `gateHomeApiPaths` (House-domain,
 * `homeApi` capability). Client and server disagreed in both directions.
 *
 * The gate now derives from a dedicated `utilities` brand capability so the
 * client matches the backend: House serves and mounts it, nobody else does.
 */
import { isUtilitiesCapableBrand } from '@brand/capabilities';

/**
 * True when the active brand ships the Utilities surface.
 *
 * Synchronous and brand-derived — safe to call during render and outside React,
 * mirroring the budget-mode helpers it replaces.
 */
export function isUtilitiesEnabled(): boolean {
  return isUtilitiesCapableBrand();
}
