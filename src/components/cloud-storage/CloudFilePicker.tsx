// Cloud File Picker Component
// Modal for browsing and selecting files from Google Drive or Dropbox

import { LinearGradient } from 'expo-linear-gradient';
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, FlatList, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProcessingOverlay } from '@components/common/ProcessingOverlay';
import { GoogleIcon, GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useNativeModalPresentation } from '@navigation/presentation';
import {
  googleDriveService,
  dropboxService,
  CloudReauthRequiredError,
  type CloudProvider,
  type CloudFile,
  type CloudStorageService,
} from '@services/cloud-storage';
import { storageHelpers } from '@services/storage';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

/** Brand blue for the Dropbox glyph (Google Drive uses the multi-color G). */
const DROPBOX_BLUE = '#0061FF';

/**
 * The hard ceiling every upload route enforces (`maxSize` in
 * backend/src/routes/utilities.ts and budget.ts). Checked here so an oversized
 * file is refused before it is downloaded from the provider, instead of being
 * pulled down in full and then rejected as a generic extraction failure.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Honest, actionable copy for a file the backend would reject outright. */
export function oversizeFileMessage(
  bytes: number,
  name?: string,
  limitBytes: number = MAX_UPLOAD_BYTES
): string {
  const mb = Math.round(bytes / (1024 * 1024));
  const limitMb = Math.round(limitBytes / (1024 * 1024));
  const subject = name ? `“${name}” is ${mb} MB` : `That file is ${mb} MB`;
  return `${subject}. The limit is ${limitMb} MB — try exporting fewer pages.`;
}

interface CloudFilePickerProps {
  visible: boolean;
  provider: CloudProvider;
  /** Single mime type or list of allowed file types (folders are always navigable). */
  mimeTypeFilter?: string | string[];
  onClose: () => void;
  onFileSelected: (file: { uri: string; name: string; size: number }) => void;
  /**
   * When true, the user can tick several files and attach them in one go.
   * Tapping a file toggles its selection instead of downloading immediately,
   * and a footer button downloads everything selected. Selection persists
   * across folder navigation. Defaults to false (single-tap-to-attach).
   */
  multiSelect?: boolean;
  /**
   * Called with every downloaded file once the user taps "Attach" in
   * multi-select mode. Required when {@link multiSelect} is true; ignored
   * otherwise.
   */
  onFilesSelected?: (files: Array<{ uri: string; name: string; size: number }>) => void;
  /**
   * When true, the user can pin the current folder so the picker re-opens
   * directly inside it next time. Defaults to true.
   */
  enableRememberFolder?: boolean;
  /**
   * When true, the folder a file is attached from is saved automatically for
   * this {@link rememberScope} — no manual "Remember this folder" tap. Meant
   * for surfaces where files always come from the same place (e.g. utility
   * bills), so reopening lands straight in that folder. Other surfaces keep
   * the manual pin so the user can browse and choose a different folder each
   * time. Defaults to false.
   */
  autoRemember?: boolean;
  /**
   * Namespaces the remembered folder so different surfaces (e.g. reports vs.
   * utilities) can each pin their own default. Defaults to 'default'.
   */
  rememberScope?: string;
  /**
   * When true, every file type is selectable and listed (folders remain
   * navigable). Ignores {@link mimeTypeFilter}.
   */
  allowAllFileTypes?: boolean;
  /**
   * Largest file the caller's upload route will accept, in bytes. Defaults to
   * {@link MAX_UPLOAD_BYTES}, the fleet-wide 32 MB ceiling — surfaces with a
   * tighter cap can lower it so the refusal happens before the download.
   */
  maxFileBytes?: number;
}

interface FolderPath {
  id: string;
  name: string;
}

/**
 * Turns any service error into user-safe copy. Provider APIs return verbose
 * JSON (e.g. Google's `ACCESS_TOKEN_SCOPE_INSUFFICIENT` blob) that must never
 * reach the UI — see the "no raw error leaks" rule. Anything that isn't an
 * explicit re-auth signal collapses to one generic line.
 */
function resolveCloudErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof CloudReauthRequiredError) {
    return err.message;
  }
  return fallback;
}

function normalizeMimeFilters(filter?: string | string[]): string[] {
  if (!filter) return ['application/pdf'];
  return Array.isArray(filter) ? filter : [filter];
}

/**
 * Exact match, plus `type/*` wildcards. Without the wildcard arm a filter of
 * `image/*` matched nothing at all — the comparison was string equality, and no
 * provider ever reports a literal `image/*` mime type.
 */
function matchesMimeFilter(mime: string, filters: string[]): boolean {
  const candidate = mime.toLowerCase();
  return filters.some((filter) => {
    const allowed = filter.toLowerCase();
    if (allowed.endsWith('/*')) return candidate.startsWith(allowed.slice(0, -1));
    return allowed === candidate;
  });
}

function mimeFilterLabel(filters: string[]): string {
  const hasPdf = filters.includes('application/pdf');
  const hasImage = filters.some((f) => f.startsWith('image/'));
  if (hasPdf && hasImage) return 'PDF or image';
  if (hasImage) return 'image';
  return 'PDF';
}

/** The MMKV key a scope's pinned folder is stored under. */
function rememberFolderKey(provider: CloudProvider, scope: string): string {
  return `cloud_picker_folder:${provider}:${scope}`;
}

/**
 * Scopes that have been renamed, as `current → previous`.
 *
 * The pinned folder is a user preference we cannot re-derive, so a rename has
 * to carry the stored value across rather than silently abandoning it.
 * `bc-assessments` became `property-assessments` once property assessment
 * stopped being a BC-only surface.
 */
const RENAMED_REMEMBER_SCOPES: Readonly<Record<string, string>> = {
  'property-assessments': 'bc-assessments',
};

/**
 * Legacy scope spellings callers may still pass, mapped to the scope in use
 * today, so an un-migrated call site keeps reading the same pinned folder.
 */
const REMEMBER_SCOPE_ALIASES: Readonly<Record<string, string>> = {
  'bc-assessments': 'property-assessments',
};

/**
 * One-time copy of a renamed scope's pinned folder onto its new key. No-op for
 * scopes that were never renamed, and never overwrites a folder the new key
 * already holds.
 */
async function migrateRenamedRememberScope(
  provider: CloudProvider,
  scope: string
): Promise<void> {
  const legacyScope = RENAMED_REMEMBER_SCOPES[scope];
  if (!legacyScope) return;
  try {
    const legacyKey = rememberFolderKey(provider, legacyScope);
    const legacy = await storageHelpers.getObject<FolderPath[]>(legacyKey);
    if (!legacy || legacy.length === 0) return;
    const currentKey = rememberFolderKey(provider, scope);
    const current = await storageHelpers.getObject<FolderPath[]>(currentKey);
    if (!current) {
      await storageHelpers.setObject(currentKey, legacy);
    }
    await storageHelpers.delete(legacyKey);
  } catch (err) {
    console.error('Failed to migrate remembered folder:', err);
  }
}

export function CloudFilePicker({
  visible,
  provider,
  mimeTypeFilter = 'application/pdf',
  onClose,
  onFileSelected,
  multiSelect = false,
  onFilesSelected,
  enableRememberFolder = true,
  autoRemember = false,
  rememberScope = 'default',
  allowAllFileTypes = false,
  maxFileBytes = MAX_UPLOAD_BYTES,
}: CloudFilePickerProps) {
  const allowedMimeTypes = normalizeMimeFilters(mimeTypeFilter);
  const selectableLabel = allowAllFileTypes ? 'file' : mimeFilterLabel(allowedMimeTypes);
  const isMimeAllowed = (mime: string) =>
    allowAllFileTypes || matchesMimeFilter(mime, allowedMimeTypes);
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const modalPresentation = useNativeModalPresentation('pageSheet');

  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  // In multi-select mode, the files the user has ticked, keyed by id so
  // selection survives folder navigation. Insertion order = attach order.
  const [selectedFiles, setSelectedFiles] = useState<Record<string, CloudFile>>({});
  // "Downloading 2 of 5" progress while attaching a multi-select batch.
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<FolderPath[]>([]);
  const [userInfo, setUserInfo] = useState<{ email?: string; name?: string } | null>(null);
  const [rememberedPath, setRememberedPath] = useState<FolderPath[] | null>(null);
  const [openedFromRemembered, setOpenedFromRemembered] = useState(false);

  const service: CloudStorageService = provider === 'google-drive'
    ? googleDriveService
    : dropboxService;

  const providerName = provider === 'google-drive' ? 'Google Drive' : 'Dropbox';

  /** The provider's brand mark, sized for the badge, header, and button. */
  const renderProviderMark = (size: number) =>
    provider === 'google-drive' ? (
      <GoogleIcon size={size} />
    ) : (
      <Icon name="logo-dropbox" size={size} color={DROPBOX_BLUE} />
    );

  // A renamed scope keeps working under its old spelling — the alias resolves to
  // the scope in use today, so both callers land on the same pinned folder.
  const effectiveRememberScope = REMEMBER_SCOPE_ALIASES[rememberScope] ?? rememberScope;
  const rememberKey = rememberFolderKey(provider, effectiveRememberScope);


  // Whether the folder currently being viewed is the pinned one.
  const isCurrentFolderRemembered =
    !!rememberedPath &&
    rememberedPath.length === folderPath.length &&
    rememberedPath.every((c, i) => c.id === folderPath[i]?.id);

  const handleToggleRemember = async () => {
    if (isCurrentFolderRemembered) {
      await storageHelpers.delete(rememberKey);
      setRememberedPath(null);
      setOpenedFromRemembered(false);
      return;
    }
    await storageHelpers.setObject(rememberKey, folderPath);
    setRememberedPath(folderPath);
  };

  // In auto-remember mode, silently persist the folder a file was attached from
  // so this surface re-opens there next time. Skipped at the root (nothing
  // meaningful to remember) and when the folder is already the saved one.
  const rememberCurrentFolderIfAuto = async () => {
    if (!autoRemember || !enableRememberFolder || folderPath.length === 0) return;
    if (isCurrentFolderRemembered) return;
    try {
      await storageHelpers.setObject(rememberKey, folderPath);
      setRememberedPath(folderPath);
    } catch (err) {
      console.error('Failed to remember folder:', err);
    }
  };

  // Auto-remember "Change": forget the saved folder and drop back to the root
  // so the user can browse to a different one (re-saved on the next attach).
  const handleForgetAndReset = async () => {
    await storageHelpers.delete(rememberKey);
    setRememberedPath(null);
    setOpenedFromRemembered(false);
    setFolderPath([]);
    loadFiles();
  };

  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const authState = await service.authenticate();
      setIsAuthenticated(true);
      setUserInfo({
        email: authState.userEmail,
        name: authState.userName,
      });
      loadFiles();
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '';

      // User backed out of the Google/Dropbox consent sheet — not an error.
      if (rawMessage.includes('cancelled')) {
        return;
      }

      if (rawMessage.includes('requires setup')) {
        setError(`${providerName} isn’t set up yet.`);
        Alert.alert(
          'Setup Required',
          `${providerName} integration needs to be configured. Please contact the app developer.`,
          [{ text: 'OK', onPress: onClose }]
        );
        return;
      }

      // CloudReauthRequiredError carries safe copy; everything else collapses to
      // a generic line so no provider payload reaches the UI.
      setError(
        resolveCloudErrorMessage(err, `Couldn’t connect to ${providerName}. Please try again.`)
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Sign Out',
      `Are you sure you want to sign out of ${providerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await service.logout();
            setIsAuthenticated(false);
            setUserInfo(null);
            setFiles([]);
            setFolderPath([]);
          },
        },
      ]
    );
  };

  const loadFiles = useCallback(async (folderId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const fileList = await service.listFiles(folderId, undefined);
      
      // Sort: folders first, then by name
      const sorted = fileList.sort((a, b) => {
        const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder' || a.mimeType === 'folder';
        const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder' || b.mimeType === 'folder';
        
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        return a.name.localeCompare(b.name);
      });

      setFiles(sorted);
    } catch (err) {
      // A stale/insufficient grant (e.g. token predates the Drive scope) is
      // cleared by the service — drop back to the Connect screen so the user
      // can re-consent, instead of showing a dead "Retry" over a raw error.
      if (err instanceof CloudReauthRequiredError) {
        setIsAuthenticated(false);
        setUserInfo(null);
        setFiles([]);
      }
      setError(resolveCloudErrorMessage(err, `Couldn't load your ${providerName} files. Please try again.`));
    } finally {
      setIsLoading(false);
    }
  }, [service, providerName]);

  // Each opened provider session restores its own remembered folder.
  useEffect(() => {
  const checkAuth = async () => {
    try {
      const authenticated = await service.isAuthenticated();
      setIsAuthenticated(authenticated);

      if (authenticated) {
        const authState = await service.getAuthState();
        if (authState) {
          setUserInfo({
            email: authState.userEmail,
            name: authState.userName,
          });
        }

        // Restore a previously pinned folder, if any — carrying one across from
        // a pre-rename key first, so a rename never loses the user's folder.
        let saved: FolderPath[] | null = null;
        if (enableRememberFolder) {
          await migrateRenamedRememberScope(provider, effectiveRememberScope);
          saved = await storageHelpers.getObject<FolderPath[]>(rememberKey);
        }
        setRememberedPath(saved);

        if (saved && saved.length > 0) {
          setFolderPath(saved);
          setOpenedFromRemembered(true);
          loadFiles(saved[saved.length - 1].id);
        } else {
          setFolderPath([]);
          loadFiles();
        }
      }
    } catch (err) {
      console.error('Error checking auth:', err);
      setIsAuthenticated(false);
    }
  };

    if (visible) {
      setSelectedFiles({});
      void checkAuth();
    } else {
      setOpenedFromRemembered(false);
    }
  }, [visible, provider, service, effectiveRememberScope, rememberKey, enableRememberFolder, loadFiles]);

  const selectedCount = Object.keys(selectedFiles).length;

  const toggleSelectFile = (file: CloudFile) => {
    setSelectedFiles((prev) => {
      const next = { ...prev };
      if (next[file.id]) {
        delete next[file.id];
      } else {
        next[file.id] = file;
      }
      return next;
    });
  };

  // Tickable files in the current folder — non-folders that pass the mime filter.
  const selectableFiles = multiSelect
    ? files.filter((f) => {
        const isFolder =
          f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType === 'folder';
        return !isFolder && isMimeAllowed(f.mimeType);
      })
    : [];
  const allSelectableSelected =
    selectableFiles.length > 0 && selectableFiles.every((f) => selectedFiles[f.id]);

  // "Select all" ticks every selectable file in this folder; once they're all
  // ticked the same control becomes "Remove all" and clears them (selections in
  // other folders are left untouched).
  const handleToggleSelectAll = () => {
    setSelectedFiles((prev) => {
      const next = { ...prev };
      if (allSelectableSelected) {
        selectableFiles.forEach((f) => delete next[f.id]);
      } else {
        selectableFiles.forEach((f) => {
          next[f.id] = f;
        });
      }
      return next;
    });
  };

  const handleFilePress = async (file: CloudFile) => {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder' || file.mimeType === 'folder';

    if (isFolder) {
      // Navigate into folder
      setFolderPath(prev => [...prev, { id: file.id, name: file.name }]);
      loadFiles(file.id);
      return;
    }

    if (!allowAllFileTypes && mimeTypeFilter && !isMimeAllowed(file.mimeType)) {
      Alert.alert('Invalid File', `Please select a ${selectableLabel} file.`);
      return;
    }

    // Refuse an oversized file here rather than downloading it in full and
    // letting the upload come back as a generic "couldn't read that" failure.
    if (typeof file.size === 'number' && file.size > maxFileBytes) {
      Alert.alert('File Too Large', oversizeFileMessage(file.size, file.name, maxFileBytes));
      return;
    }

    // Multi-select: tapping toggles the tick; downloads happen on "Attach".
    if (multiSelect) {
      toggleSelectFile(file);
      return;
    }

    // Single-select: download immediately and hand the file back.
    setIsDownloading(true);
    try {
      const downloadedFile = await service.downloadFile(file.id);
      await rememberCurrentFolderIfAuto();
      onFileSelected(downloadedFile);
      onClose();
    } catch (err) {
      if (err instanceof CloudReauthRequiredError) {
        setIsAuthenticated(false);
        setUserInfo(null);
        setError(err.message);
        return;
      }
      Alert.alert('Download Failed', `Couldn't download that file. Please try again.`);
    } finally {
      setIsDownloading(false);
    }
  };

  // Download every ticked file in order, then hand the batch back to the caller.
  const handleAttachSelected = async () => {
    const items = Object.values(selectedFiles);
    if (items.length === 0) return;

    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: items.length });
    try {
      const downloaded: Array<{ uri: string; name: string; size: number }> = [];
      for (let i = 0; i < items.length; i++) {
        setDownloadProgress({ current: i + 1, total: items.length });
        const file = await service.downloadFile(items[i].id);
        downloaded.push(file);
      }
      await rememberCurrentFolderIfAuto();
      onFilesSelected?.(downloaded);
      onClose();
    } catch (err) {
      if (err instanceof CloudReauthRequiredError) {
        setIsAuthenticated(false);
        setUserInfo(null);
        setError(err.message);
        return;
      }
      Alert.alert('Download Failed', `Couldn't download your files. Please try again.`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleNavigateBack = () => {
    if (folderPath.length === 0) return;

    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);

    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : undefined;
    loadFiles(parentId);
  };

  const handleNavigateToRoot = () => {
    setFolderPath([]);
    loadFiles();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (file: CloudFile): IoniconName => {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder' || file.mimeType === 'folder';
    if (isFolder) return 'folder';
    if (file.mimeType === 'application/pdf') return 'document-text';
    if (file.mimeType.startsWith('image/')) return 'image';
    if (file.mimeType.startsWith('video/')) return 'videocam';
    return 'document';
  };

  const renderFile = ({ item }: { item: CloudFile }) => {
    const isFolder = item.mimeType === 'application/vnd.google-apps.folder' || item.mimeType === 'folder';
    const isPdf = item.mimeType === 'application/pdf';
    const isImage = item.mimeType.startsWith('image/');
    const isSelectable =
      isFolder ||
      allowAllFileTypes ||
      (mimeTypeFilter ? isMimeAllowed(item.mimeType) : true);
    // Only non-folder files can be ticked in multi-select mode.
    const showCheckbox = multiSelect && !isFolder && isSelectable;
    const isChecked = !!selectedFiles[item.id];

    return (
      <TouchableOpacity
        style={[
          styles.fileItem,
          {
            backgroundColor: isChecked ? colors.primary + '14' : colors.backgroundSecondary,
            opacity: isSelectable ? 1 : 0.5,
          },
        ]}
        testID={`cloud-picker-item-${item.id}`}
        onPress={() => handleFilePress(item)}
        disabled={!isSelectable || isDownloading}
        activeOpacity={0.7}
      >
        {showCheckbox && (
          <Icon
            name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={isChecked ? colors.primary : colors.textTertiary}
            style={styles.checkbox}
          />
        )}
        <View style={styles.fileIcon}>
          <Icon
            name={getFileIcon(item)}
            size={24}
            color={isFolder ? colors.primary : colors.textSecondary}
          />
        </View>
        <View style={styles.fileInfo}>
          <Typography
            variant="caption"
            weight="medium"
            numberOfLines={3}
            color={colors.textPrimary}
          >
            {item.name}
          </Typography>
          {!isFolder && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatFileSize(item.size)}
            </Typography>
          )}
        </View>
        {isFolder && (
          <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
        )}
        {isPdf && (
          <View style={[styles.pdfBadge, { backgroundColor: colors.primary + '26' }]}>
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              PDF
            </Typography>
          </View>
        )}
        {isImage && (
          <View style={[styles.pdfBadge, { backgroundColor: colors.primary + '26' }]}>
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              IMG
            </Typography>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        disabled={isDownloading}
        // Addressable dismissal. Every surface that opens this picker (Health
        // Scan, Budget receipt/savings/mortgage import) needs to prove the modal
        // closes again, and matching the bare word "Cancel" collides with the
        // Cancel on whatever screen is underneath.
        testID="cloud-picker-cancel"
      >
        <Typography variant="body" color={colors.primary}>Cancel</Typography>
      </TouchableOpacity>
      
      <View style={styles.headerTitle}>
        {renderProviderMark(18)}
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
          {providerName}
        </Typography>
      </View>

      {isAuthenticated && (
        <TouchableOpacity 
          style={styles.logoutButton}
          onPress={handleLogout}
          disabled={isDownloading}
        >
          <Typography variant="caption1" color={colors.textSecondary}>Sign Out</Typography>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderBreadcrumb = () => {
    if (folderPath.length === 0) return null;

    return (
      <View style={[styles.breadcrumb, { backgroundColor: colors.groupedListBackground }]}>
        <TouchableOpacity onPress={handleNavigateToRoot} disabled={isDownloading}>
          <Typography variant="caption1" color={colors.primary}>
            Home
          </Typography>
        </TouchableOpacity>
        {folderPath.map((folder, index) => (
          <React.Fragment key={folder.id}>
            <Typography variant="caption1" color={colors.textTertiary}> / </Typography>
            <TouchableOpacity
              onPress={() => {
                if (index < folderPath.length - 1) {
                  const newPath = folderPath.slice(0, index + 1);
                  setFolderPath(newPath);
                  loadFiles(folder.id);
                }
              }}
              disabled={index === folderPath.length - 1 || isDownloading}
            >
              <Typography 
                variant="caption1" 
                color={index === folderPath.length - 1 ? colors.textPrimary : colors.primary}
                weight={index === folderPath.length - 1 ? 'semibold' : 'regular'}
                numberOfLines={1}
              >
                {folder.name}
              </Typography>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>
    );
  };

  const renderRememberBar = () => {
    if (!enableRememberFolder) return null;

    // Auto-remember mode (e.g. utility bills): the folder is saved for us on
    // attach, so surface it as a hint rather than a manual pin. Once a folder
    // is the saved one, offer "Change" to pick a different one next time.
    if (autoRemember) {
      if (folderPath.length === 0) return null;
      return (
        <View style={styles.rememberBar}>
          <View style={styles.rememberHint}>
            <Icon name="pin" size={14} color={colors.textSecondary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {isCurrentFolderRemembered
                ? 'Saved · opens here next time'
                : 'This folder will be saved for next time'}
            </Typography>
          </View>
          {isCurrentFolderRemembered && (
            <TouchableOpacity
              testID="cloud-picker-remember-change"
              style={[styles.rememberButton, { backgroundColor: colors.groupedListBackground }]}
              onPress={handleForgetAndReset}
              disabled={isDownloading}
            >
              <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                Change
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    const canPin = folderPath.length > 0 || isCurrentFolderRemembered;
    if (!canPin && !openedFromRemembered) return null;

    return (
      <View style={styles.rememberBar}>
        {openedFromRemembered && (
          <View style={styles.rememberHint}>
            <Icon name="pin" size={14} color={colors.textSecondary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              Opened your saved folder
            </Typography>
          </View>
        )}
        {canPin && (
          <TouchableOpacity
            testID="cloud-picker-remember-toggle"
            style={[
              styles.rememberButton,
              {
                backgroundColor: isCurrentFolderRemembered
                  ? colors.primary + '20'
                  : colors.groupedListBackground,
              },
            ]}
            onPress={handleToggleRemember}
            disabled={isDownloading}
          >
            <Icon
              name="pin"
              size={14}
              color={isCurrentFolderRemembered ? colors.primary : colors.textPrimary}
            />
            <Typography
              variant="caption1"
              weight="semibold"
              color={isCurrentFolderRemembered ? colors.primary : colors.textPrimary}
            >
              {isCurrentFolderRemembered ? 'Saved · Tap to forget' : 'Remember this folder'}
            </Typography>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderSelectAllBar = () => {
    if (!multiSelect || selectableFiles.length === 0) return null;

    return (
      <View style={styles.selectAllBar}>
        <Typography variant="caption1" color={colors.textSecondary}>
          {selectedCount > 0
            ? `${selectedCount} selected`
            : `${selectableFiles.length} ${selectableLabel} ${selectableFiles.length === 1 ? 'file' : 'files'}`}
        </Typography>
        <TouchableOpacity
          style={[styles.selectAllButton, { backgroundColor: colors.groupedListBackground }]}
          onPress={handleToggleSelectAll}
          disabled={isDownloading}
        >
          <Icon
            name={allSelectableSelected ? 'close-circle-outline' : 'checkmark-done-outline'}
            size={16}
            color={colors.primary}
          />
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            {allSelectableSelected ? 'Remove all' : 'Select all'}
          </Typography>
        </TouchableOpacity>
      </View>
    );
  };

  const authFeatures = [
    { icon: 'folder-outline' as const, text: 'Browse all your folders' },
    { icon: 'flash-outline' as const, text: 'Attach files without downloads' },
    { icon: 'lock-closed-outline' as const, text: 'Read-only access, always private' },
  ];

  const renderAuthScreen = () => (
    <ScrollView
      contentContainerStyle={styles.authContainer}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={[colors.backgroundSecondary, colors.groupedListBackground]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.authBadge, { borderColor: colors.borderColor }]}
      >
        {renderProviderMark(52)}
      </LinearGradient>

      <Typography variant="title2" weight="bold" align="center" color={colors.textPrimary}>
        Connect to {providerName}
      </Typography>
      <Typography
        variant="body"
        color={colors.textSecondary}
        align="center"
        style={styles.authText}
      >
        Sign in to browse your files and attach them here in seconds.
      </Typography>

      <View
        style={[
          styles.featureCard,
          { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
        ]}
      >
        {authFeatures.map((feature, index) => (
          <View
            key={feature.icon}
            style={[
              styles.featureRow,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderColor },
            ]}
          >
            <View style={[styles.featureIcon, { backgroundColor: theme.pastel.teal + '1A' }]}>
              <Icon name={feature.icon} size={18} color={theme.pastel.teal} />
            </View>
            <Typography
              variant="subheadline"
              color={colors.textPrimary}
              style={styles.featureText}
            >
              {feature.text}
            </Typography>
          </View>
        ))}
      </View>

      {error && (
        <View style={[styles.errorContainer, { backgroundColor: colors.error + '15' }]}>
          <Icon name="alert-circle" size={16} color={colors.error} />
          <Typography variant="caption1" color={colors.error} style={styles.errorText}>
            {error}
          </Typography>
        </View>
      )}

      <GradientButton
        title={isAuthenticating ? 'Connecting…' : `Sign in with ${providerName}`}
        variant="blue"
        fullWidth
        disabled={isAuthenticating}
        onPress={handleAuthenticate}
        style={styles.authButton}
        testID="cloud-picker-signin"
        icon={
          isAuthenticating ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <View style={[styles.authButtonChip, { backgroundColor: colors.white }]}>
              {renderProviderMark(18)}
            </View>
          )
        }
      />

      <Typography
        variant="caption2"
        color={colors.textTertiary}
        align="center"
        style={styles.authFinePrint}
      >
        Your credentials stay with {providerName}. Disconnect anytime.
      </Typography>
    </ScrollView>
  );

  const renderContent = () => {
    if (!isAuthenticated) {
      return renderAuthScreen();
    }

    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography 
            variant="body" 
            color={colors.textSecondary}
            style={styles.loadingText}
          >
            Loading files...
          </Typography>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.errorScreen}>
          <Icon name="warning" size={20} color={colors.error} />
          <Typography variant="body" color={colors.error} align="center">
            {error}
          </Typography>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => loadFiles(folderPath.length > 0 ? folderPath[folderPath.length - 1].id : undefined)}
          >
            <Typography variant="body" weight="semibold" color={colors.white}>
              Retry
            </Typography>
          </TouchableOpacity>
        </View>
      );
    }

    const visibleFiles = files.filter((f) => {
      const isFolder =
        f.mimeType === 'application/vnd.google-apps.folder' || f.mimeType === 'folder';
      return isFolder || isMimeAllowed(f.mimeType);
    });

    if (visibleFiles.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="file-tray-outline" size={24} color={colors.textSecondary} />
          <Typography variant="body" color={colors.textSecondary} align="center">
            No {selectableLabel} files found in this folder
          </Typography>
          {folderPath.length > 0 && (
            <TouchableOpacity
              style={[styles.backButton, { borderColor: colors.borderColor }]}
              onPress={handleNavigateBack}
            >
              <Typography variant="body" color={colors.primary}>
                Go Back
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return (
      <>
        {renderBreadcrumb()}
        {renderRememberBar()}
        {userInfo?.email && (
          <View style={[styles.userInfo, { backgroundColor: colors.groupedListBackground }]}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Signed in as {userInfo.email}
            </Typography>
          </View>
        )}
        {renderSelectAllBar()}
        <FlatList
          data={visibleFiles}
          keyExtractor={(item) => item.id}
          renderItem={renderFile}
          contentContainerStyle={styles.fileList}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={modalPresentation}
      onRequestClose={onClose}
    >
      <View
        style={[styles.container, { backgroundColor: colors.backgroundMain, paddingTop: insets.top }]}
        testID="cloud-picker-modal"
      >
        {renderHeader()}
        {renderContent()}

        {/* Multi-select attach bar */}
        {multiSelect && isAuthenticated && selectedCount > 0 && !isDownloading && (
          <View
            style={[
              styles.selectionBar,
              {
                backgroundColor: colors.backgroundSecondary,
                borderTopColor: colors.borderColor,
                paddingBottom: insets.bottom || Spacing.base,
              },
            ]}
          >
            <GradientButton
              title={`Attach ${selectedCount} ${selectedCount === 1 ? 'file' : 'files'}`}
              variant="blue"
              fullWidth
              onPress={handleAttachSelected}
              testID="cloud-picker-attach"
            />
          </View>
        )}

        {/* Download overlay — embedded, since it's already inside this picker's Modal. */}
        <ProcessingOverlay
          visible={isDownloading}
          embedded
          message={
            downloadProgress
              ? `Downloading ${downloadProgress.current} of ${downloadProgress.total}…`
              : 'Downloading file...'
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  closeButton: {
    minWidth: 60,
  },
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  logoutButton: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  userInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rememberBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  rememberHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 1,
  },
  rememberButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.lg,
    marginLeft: 'auto',
  },
  selectAllBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  fileList: {
    padding: 16,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
  },
  checkbox: {
    marginRight: 4,
  },
  selectionBar: {
    paddingHorizontal: 16,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fileIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  pdfBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  separator: {
    height: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
  },
  authContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  authBadge: {
    width: 96,
    height: 96,
    borderRadius: CornerRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  authText: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
    maxWidth: 300,
  },
  featureCard: {
    alignSelf: 'stretch',
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.base,
    marginBottom: Spacing.xl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  authButton: {
    alignSelf: 'stretch',
  },
  authButtonChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authFinePrint: {
    marginTop: Spacing.md,
    maxWidth: 280,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.base,
  },
  errorText: {
    flex: 1,
  },
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
});
