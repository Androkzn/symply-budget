/**
 * The brief the assistant is given about a project or a material.
 *
 * This is the whole grounding mechanism for project chat: the Worker cannot read
 * a local-first project, so if these strings are wrong the AI answers about
 * kitchens in general while claiming to answer about this one. The cases below
 * are the ones where "looks fine" and "is right" come apart — real numbers
 * present, arithmetic pre-computed, truncation announced, and nothing at all
 * emitted when there is nothing to say.
 */
import type { HomeProjectHub } from '@api/home-projects';

import {
  buildMaterialChatContext,
  buildProjectChatContext,
} from '../projectChatContext';

function hub(overrides: Partial<HomeProjectHub> = {}): HomeProjectHub {
  return {
    project: {
      id: 'p1',
      household_id: 'hh1',
      title: 'Kitchen Reno',
      type: 'renovation',
      template_key: null,
      status: 'in_progress',
      summary: 'Full gut of the galley kitchen',
      goals: null,
      constraints: 'Keep the window where it is',
      target_budget_cents: 4_200_000,
      currency: 'USD',
      contingency_pct: 15,
      target_start_at: null,
      target_end_at: '2026-11-01',
      cover_attachment_id: null,
      created_by: 'u1',
      updated_by: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    },
    space_ids: [],
    rollups: {
      estimate_total: 3_840_000,
      actual_total: 1_200_000,
      contingency_cents: 576_000,
      target_budget_cents: 4_200_000,
      budget_health: 'ok',
    },
    selections: [],
    option_groups: [],
    budget_lines: [],
    phases: [],
    milestones: [],
    blockers: [],
    attachments: [],
    plan_links: [],
    geometry: null,
    ...overrides,
  } as HomeProjectHub;
}

function selection(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    project_id: 'p1',
    name: 'Herringbone Oak',
    category: 'flooring',
    status: 'shortlisted',
    qty: 1,
    unit: 'box',
    unit_price_cents: 4_880,
    vendor: 'Floor Depot',
    product_url: 'https://example.com/oak',
    notes: null,
    option_group_id: null,
    brand: 'Nordic',
    sku: 'NRD-77',
    image_url: null,
    coverage_per_unit: 8.16,
    coverage_unit: 'sqft',
    specs_json: '[{"label":"Wear layer","value":"0.6 mm"}]',
    color_hex: '#b98a52',
    list_price_cents: null,
    sale_price_cents: null,
    discount_pct: null,
    sale_ends_at: null,
    extraction_source: 'link_ai',
    extraction_confidence: 'high',
    version: 1,
    ...over,
  } as never;
}

describe('buildProjectChatContext', () => {
  it('leads with the project’s real money, formatted as the member sees it', () => {
    const text = buildProjectChatContext(hub())!;

    expect(text).toContain('Project: Kitchen Reno');
    expect(text).toContain('Target budget: $42,000');
    expect(text).toContain('Estimated so far: $38,400');
    expect(text).toContain('Actually spent: $12,000');
    expect(text).toContain('Budget health: ok');
    // Raw cents would invite the model to re-derive the figure and get it wrong.
    expect(text).not.toContain('4200000');
  });

  it('uses the project’s own currency, not the viewer’s preference', () => {
    const text = buildProjectChatContext(
      hub({
        project: { ...hub().project, currency: 'EUR' },
      })
    )!;
    expect(text).toContain('€42,000');
  });

  it('groups materials under the surface they compete for and marks the preferred one', () => {
    const text = buildProjectChatContext(
      hub({
        option_groups: [
          {
            id: 'g1',
            project_id: 'p1',
            name: 'Kitchen floor',
            category: 'finish',
            area_value: 220,
            area_unit: 'sqft',
            area_source: 'manual',
            waste_factor_pct: 10,
            preferred_selection_id: 's1',
            version: 1,
          },
        ],
        selections: [
          selection({ option_group_id: 'g1' }),
          selection({ id: 's2', name: 'Grey Slate', option_group_id: 'g1' }),
        ],
      })
    )!;

    expect(text).toContain('Kitchen floor (finish) — 220 sq ft to cover, +10% waste');
    expect(text).toContain('Herringbone Oak');
    expect(text).toContain('PREFERRED');
    expect(text).toContain('Grey Slate');
  });

  it('says how many materials it dropped rather than truncating silently', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      selection({ id: `s${i}`, name: `Option ${i}` })
    );
    const text = buildProjectChatContext(hub({ selections: many }))!;

    // A silently-cut list reads as the whole list, and the assistant would then
    // answer "that is all of them" and be wrong.
    expect(text).toMatch(/\d+ more materials not listed here/);
  });

  it('carries only OPEN blockers', () => {
    const text = buildProjectChatContext(
      hub({
        blockers: [
          {
            id: 'b1',
            project_id: 'p1',
            title: 'Permit pending',
            severity: 'high',
            status: 'open',
            notes: null,
          },
          {
            id: 'b2',
            project_id: 'p1',
            title: 'Old quote',
            severity: 'low',
            status: 'resolved',
            notes: null,
          },
        ] as never,
      })
    )!;

    expect(text).toContain('Permit pending');
    expect(text).not.toContain('Old quote');
  });

  it('returns null when there is no project, so no empty heading is sent', () => {
    expect(buildProjectChatContext(null)).toBeNull();
    expect(buildProjectChatContext(undefined)).toBeNull();
  });
});

describe('buildMaterialChatContext', () => {
  it('hands over the cost-per-area rather than the inputs to re-derive it', () => {
    const text = buildMaterialChatContext(hub({ selections: [selection()] }), 's1')!;

    expect(text).toContain('Material: Herringbone Oak');
    expect(text).toContain('Price: $49');
    expect(text).toContain('One unit covers: 8.16 sq ft');
    // $48.80 / 8.16 sq ft ≈ $6/sq ft.
    expect(text).toContain('Effective cost: $6 per sq ft');
    expect(text).toContain('Wear layer 0.6 mm');
  });

  it('names the surface it is competing for and whether it has won', () => {
    const text = buildMaterialChatContext(
      hub({
        option_groups: [
          {
            id: 'g1',
            project_id: 'p1',
            name: 'Kitchen floor',
            category: 'finish',
            area_value: 220,
            area_unit: 'sqft',
            area_source: 'manual',
            waste_factor_pct: 10,
            preferred_selection_id: 's2',
            version: 1,
          },
        ],
        selections: [
          selection({ option_group_id: 'g1' }),
          selection({ id: 's2', name: 'Grey Slate', option_group_id: 'g1' }),
        ],
      }),
      's1'
    )!;

    expect(text).toContain('Kitchen floor');
    expect(text).toContain('Another option is currently preferred');
    expect(text).toContain('Grey Slate');
  });

  it('includes enough of the project for a budget question to land', () => {
    const text = buildMaterialChatContext(hub({ selections: [selection()] }), 's1')!;
    expect(text).toContain('THE PROJECT IT BELONGS TO');
    expect(text).toContain('Kitchen Reno');
    expect(text).toContain('Target budget: $42,000');
  });

  it('returns null for a material that is no longer in the project', () => {
    expect(buildMaterialChatContext(hub(), 'gone')).toBeNull();
  });
});
