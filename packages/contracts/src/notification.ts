import { z } from 'zod';

/** Notification history row for GET /notifications/history (hot path). */
export const notificationHistoryItemSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.string().nullable(),
  sent_at: z.string(),
  read_at: z.string().nullable(),
  clicked_at: z.string().nullable(),
  reference_type: z.string().nullable(),
  reference_id: z.string().nullable(),
});

export type NotificationHistoryItem = z.infer<typeof notificationHistoryItemSchema>;

/** GET /notifications/history response envelope (service returns camelCase cursor). */
export const notificationsHistoryResponseSchema = z.object({
  notifications: z.array(notificationHistoryItemSchema),
  nextCursor: z.string().optional(),
});

export type NotificationsHistoryResponse = z.infer<typeof notificationsHistoryResponseSchema>;

/** GET /notifications/unread-count response. */
export const notificationsUnreadCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type NotificationsUnreadCountResponse = z.infer<
  typeof notificationsUnreadCountResponseSchema
>;
