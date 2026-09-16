/** Google Drive folder memory scopes — each Kaizen surface pins its own default folder. */
export const KAIZEN_DRIVE_SCOPES = {
  books: 'kaizen-books',
  resume: 'kaizen-resume',
  questions: 'kaizen-questions',
  general: 'kaizen-general',
} as const;

export type KaizenDriveRememberScope =
  (typeof KAIZEN_DRIVE_SCOPES)[keyof typeof KAIZEN_DRIVE_SCOPES];

export type KaizenUploadedFile = {
  uri: string;
  name: string;
  size?: number;
  mime?: string;
};
