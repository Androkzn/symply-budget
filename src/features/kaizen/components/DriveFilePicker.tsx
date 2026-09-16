/**
 * Symply Kaizen — Google Drive file picker.
 *
 * Wraps the platform {@link CloudFilePicker} with per-surface folder memory
 * ({@link rememberScope}) so books, resume, questions, etc. each reopen in their
 * own pinned Drive folder — same behavior as Symply House upload surfaces.
 */
import { CloudFilePicker } from '@components/cloud-storage';

import {
  KAIZEN_DRIVE_SCOPES,
  type KaizenDriveRememberScope,
  type KaizenUploadedFile,
} from '../upload/rememberScopes';

/** @deprecated Prefer {@link KaizenUploadedFile} — kept for donor Career screens. */
export interface DownloadedGoogleDriveFile extends KaizenUploadedFile {
  mimeType: string;
}

interface DriveFilePickerProps {
  visible: boolean;
  onClose: () => void;
  onFileSelected: (file: DownloadedGoogleDriveFile) => void;
  /** Drive folder memory namespace — defaults to resume imports. */
  rememberScope?: KaizenDriveRememberScope;
  mimeTypeFilter?: string | string[];
  allowAllFileTypes?: boolean;
}

export function DriveFilePicker({
  visible,
  onClose,
  onFileSelected,
  rememberScope = KAIZEN_DRIVE_SCOPES.resume,
  mimeTypeFilter,
  allowAllFileTypes = true,
}: DriveFilePickerProps) {
  return (
    <CloudFilePicker
      visible={visible}
      provider="google-drive"
      rememberScope={rememberScope}
      allowAllFileTypes={allowAllFileTypes}
      mimeTypeFilter={allowAllFileTypes ? undefined : mimeTypeFilter}
      onClose={onClose}
      onFileSelected={file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        let mimeType = 'application/octet-stream';
        if (ext === 'pdf') mimeType = 'application/pdf';
        else if (ext === 'txt') mimeType = 'text/plain';
        else if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
        onFileSelected({
          uri: file.uri,
          name: file.name,
          size: file.size,
          mime: mimeType,
          mimeType,
        });
      }}
    />
  );
}
