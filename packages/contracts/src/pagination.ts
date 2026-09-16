import { z } from 'zod';

/** Cursor-based list query params (BE canonical). */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Cursor-based paginated list response (BE canonical). */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    next_cursor: z.string().optional(),
    total_count: z.number().int().nonnegative().optional(),
  });

export type PaginatedResponse<T> = {
  data: T[];
  next_cursor?: string;
  total_count?: number;
};
