import { dropboxService } from '@services/cloud-storage/dropbox';
import { googleDriveService } from '@services/cloud-storage/google-drive';
import type { CloudFolder, CloudStorageService } from '@services/cloud-storage/types';

/**
 * The provider half of "where does a backup archive go".
 *
 * Everything here is stateless and app-agnostic: naming a provider, asking
 * whether this build has credentials for it, re-running its OAuth, browsing its
 * folder tree. Budget wrote it first inside
 * `features/budget/local/backup/backupDestinations.ts`; House needs the exact
 * same calls, and a second copy of them would be two OAuth paths to keep in
 * step. What is NOT here is anything an app remembers — the folder pointer, the
 * retention choice, the archive names — because those are per app and keeping
 * them apart is what stops one app's schedule writing into the other's folder.
 */

export type BackupCloudProvider = 'google-drive' | 'dropbox';

export function cloudServiceFor(provider: BackupCloudProvider): CloudStorageService {
  return provider === 'dropbox' ? dropboxService : googleDriveService;
}

/** Human name used in messages and settings rows. */
export function cloudProviderLabel(provider: BackupCloudProvider): string {
  return provider === 'dropbox' ? 'Dropbox' : 'Google Drive';
}

/**
 * False when the provider has no OAuth credentials in this build. Dropbox ships
 * unconfigured until a brand supplies `integrations.dropbox.appKey`, so the UI
 * must hide it rather than offer a destination that can only fail.
 */
export function isCloudProviderConfigured(provider: BackupCloudProvider): boolean {
  const service = cloudServiceFor(provider);
  return service.isConfigured ? service.isConfigured() : true;
}

/**
 * Re-run the provider's OAuth so an expired or missing token can be replaced.
 *
 * A failed listing is almost always a dead token, and retrying the READ with
 * the same credentials just reproduces the error — which reads to the member as
 * a button that does nothing. Reconnecting is the action that can actually
 * change the outcome.
 */
export async function reconnectCloudProvider(provider: BackupCloudProvider): Promise<void> {
  await cloudServiceFor(provider).authenticate();
}

/** Who is signed in, for the settings row. Null when nobody is. */
export type CloudAccount = { email: string | null; name: string | null };

export async function getCloudAccount(
  provider: BackupCloudProvider,
): Promise<CloudAccount | null> {
  const service = cloudServiceFor(provider);
  try {
    if (!(await service.isAuthenticated())) return null;
    const state = await service.getAuthState();
    if (!state) return null;
    return { email: state.userEmail ?? null, name: state.userName ?? null };
  } catch {
    return null;
  }
}

/** Sign out of the provider. Callers must forget their own folder pointer too. */
export async function logoutCloudProvider(provider: BackupCloudProvider): Promise<void> {
  try {
    await cloudServiceFor(provider).logout();
  } catch (error) {
    // A failed revoke still means the member wants out; clearing the local
    // grant is what actually signs this app out.
    console.warn('[backup] provider logout failed', provider, error);
  }
}

/** False when this provider has no browsable folder tree, so the UI hides the row. */
export function cloudProviderSupportsFolderPicking(provider: BackupCloudProvider): boolean {
  const service = cloudServiceFor(provider);
  return Boolean(service.listFolders && service.createFolder);
}

/**
 * Why the browser cannot open yet: `signed-out`, or `narrow-grant` for a grant
 * issued under the old scopes, which reads folders fine but cannot create a
 * file inside one the member picks. Both are answered by the same reconnect —
 * asked for BEFORE the browse, because discovering it at upload time means the
 * member picked a folder and then watched the backup fail in it.
 */
export type CloudFolderAccess = 'ready' | 'signed-out' | 'narrow-grant';

export async function cloudFolderAccess(
  provider: BackupCloudProvider,
): Promise<CloudFolderAccess> {
  const service = cloudServiceFor(provider);
  if (!(await service.isAuthenticated())) return 'signed-out';
  if (!service.canBrowseFolders) return 'ready';
  return (await service.canBrowseFolders()) ? 'ready' : 'narrow-grant';
}

/** Sub-folders of `parentId`, or of the account root when omitted. */
export async function listCloudFolders(
  provider: BackupCloudProvider,
  parentId?: string,
): Promise<CloudFolder[]> {
  const service = cloudServiceFor(provider);
  if (!service.listFolders) return [];
  return service.listFolders(parentId);
}

export async function createCloudFolder(
  provider: BackupCloudProvider,
  name: string,
  parentId?: string | null,
): Promise<CloudFolder> {
  const service = cloudServiceFor(provider);
  if (!service.createFolder) {
    throw new Error(`${cloudProviderLabel(provider)} cannot create folders in this build.`);
  }
  return service.createFolder(name, parentId ?? null);
}

/**
 * `default` — the folder the app made for itself.
 * `picked`  — a folder the member chose out of their own Drive.
 *
 * The distinction only exists because of what happens when the folder is gone:
 * a default one is ours to recreate by name, a picked one is not. Recreating a
 * picked folder would put archives at the account root under a name the member
 * never chose there.
 */
export type RememberedFolderSource = 'default' | 'picked';

export type RememberedCloudFolder = {
  id: string;
  name: string;
  /**
   * Trail from the account root to this folder, for display only — Drive
   * addresses folders by id and would charge one request per ancestor to
   * rebuild it, so the picker records the route the member actually walked.
   */
  path?: string[];
  /** Absent on pointers stored before picking existed; those are all defaults. */
  source?: RememberedFolderSource;
};

/** Treats a pointer with no recorded source as the default it must have been. */
export function rememberedFolderSource(
  folder: Pick<RememberedCloudFolder, 'source'>,
): RememberedFolderSource {
  return folder.source === 'picked' ? 'picked' : 'default';
}

/** `My Drive › Documents › Finance` — the picked path, or just the name. */
export function describeCloudFolder(folder: RememberedCloudFolder): string {
  return folder.path?.length ? folder.path.join(' › ') : folder.name;
}
