import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { ReportService } from '../services/report-service';
import type { Env } from '../types';

const jobs = new Hono<{ Bindings: Env }>();

// All job routes require authentication
jobs.use('/*', authMiddleware());

/**
 * GET /jobs/:id
 * Get processing job status
 */
jobs.get('/:id', async (c) => {
  const userId = c.get('userId');
  const jobId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const job = await reportService.getJobStatus(jobId, userId);

  return c.json({ job });
});

export default jobs;
