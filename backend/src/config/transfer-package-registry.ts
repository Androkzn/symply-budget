/**
 * Soft Transfer package registry (Phase C directions locked in Data Bridge plan).
 * Canonical package defs live in @symply/contracts; this module adds brand-pair resolution.
 */
import {
  TRANSFER_PACKAGES,
  getTransferPackage,
  type TransferPackageDef,
  type TransferPackageId,
} from '@symply/contracts';

import { isHouseBudgetBidirectionalPair } from './brand-capabilities';

export type { TransferPackageId, TransferPackageDef };

export { TRANSFER_PACKAGES, getTransferPackage };

/**
 * Resolve a package for a concrete source→destination pair.
 * `profile.core.v1` is bidirectional House ↔ Budget (RELATIONSHIPS.md).
 */
export function resolveTransferDirection(
  packageId: string,
  sourceBrandId: string,
  destinationBrandId: string
): TransferPackageDef | undefined {
  const base = getTransferPackage(packageId);
  if (!base) return undefined;

  if (
    base.sourceBrandId === sourceBrandId &&
    base.destinationBrandId === destinationBrandId
  ) {
    return base;
  }

  if (packageId === 'profile.core.v1' && isHouseBudgetBidirectionalPair(sourceBrandId, destinationBrandId)) {
    return {
      ...base,
      sourceBrandId: sourceBrandId as TransferPackageDef['sourceBrandId'],
      destinationBrandId: destinationBrandId as TransferPackageDef['destinationBrandId'],
    };
  }

  return undefined;
}
