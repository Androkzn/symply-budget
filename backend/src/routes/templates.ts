import { Hono } from 'hono';

import { maintenanceTemplates } from '../data/maintenance-templates';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types';

const templates = new Hono<{ Bindings: Env }>();

// All template routes require authentication
templates.use('/*', authMiddleware());

// Category labels for display
const CATEGORY_LABELS: Record<string, string> = {
  roof: 'Roof',
  foundation: 'Foundation',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  exterior: 'Exterior & Yard',
  interior: 'Interior',
  safety: 'Safety Devices',
  appliances: 'Appliances',
  drainage: 'Drainage',
  attic: 'Attic',
  basement: 'Basement',
  garage: 'Garage & Equipment',
  insulation: 'Insulation',
  windows_doors: 'Windows & Doors',
  structure: 'Structure',
  other: 'Other',
};

/**
 * GET /templates
 * List all maintenance task templates
 */
templates.get('/', async (c) => {
  const category = c.req.query('category');
  const gvaOnly = c.req.query('gva_only') === 'true';
  const search = c.req.query('search')?.toLowerCase();

  let filtered = [...maintenanceTemplates];

  // Filter by category
  if (category) {
    filtered = filtered.filter((t) => t.category === category);
  }

  // Filter by GVA-specific
  if (gvaOnly) {
    filtered = filtered.filter((t) => t.gva_specific);
  }

  // Filter by search
  if (search) {
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(search) ||
        t.description?.toLowerCase().includes(search)
    );
  }

  // Add IDs for frontend
  const templatesWithIds = filtered.map((t, index) => ({
    id: `template_${index}`,
    ...t,
    category_label: CATEGORY_LABELS[t.category] || t.category,
  }));

  return c.json({
    templates: templatesWithIds,
    total: templatesWithIds.length,
  });
});

/**
 * GET /templates/categories
 * List available template categories
 */
templates.get('/categories', async (c) => {
  // Get unique categories from templates
  const categories = [...new Set(maintenanceTemplates.map((t) => t.category))];

  const categoryList = categories.map((cat) => ({
    id: cat,
    label: CATEGORY_LABELS[cat] || cat,
    count: maintenanceTemplates.filter((t) => t.category === cat).length,
  }));

  // Sort by count descending
  categoryList.sort((a, b) => b.count - a.count);

  return c.json({ categories: categoryList });
});

/**
 * GET /templates/:id
 * Get a single template by ID
 */
templates.get('/:id', async (c) => {
  const templateId = c.req.param('id');
  const index = parseInt(templateId.replace('template_', ''), 10);

  if (isNaN(index) || index < 0 || index >= maintenanceTemplates.length) {
    return c.json({ error: 'Template not found' }, 404);
  }

  const template = maintenanceTemplates[index];

  return c.json({
    template: {
      id: templateId,
      ...template,
      category_label: CATEGORY_LABELS[template.category] || template.category,
    },
  });
});

export default templates;
