import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  aiAccessResponseSchema,
  applianceListItemSchema,
  appliancesListResponseSchema,
  homeFeatureListItemSchema,
  homeFeaturesListResponseSchema,
  householdDetailResponseSchema,
  householdListItemSchema,
  householdsListResponseSchema,
  householdMemberSchema,
  householdPhotoUrlSchema,
  notificationsHistoryResponseSchema,
  notificationsUnreadCountResponseSchema,
  paginatedResponseSchema,
  paginationQuerySchema,
  reportDetailResponseSchema,
  reportsListResponseSchema,
  subscriptionMeResponseSchema,
  tasksListResponseSchema,
  TRANSFER_PACKAGES,
  getTransferPackage,
  type PaginatedResponse,
} from '../src/index';

describe('@symply/contracts round-trip', () => {
  it('parses cursor pagination query defaults', () => {
    const parsed = paginationQuerySchema.parse({});
    expect(parsed).toEqual({ limit: 20 });
  });

  it('round-trips PaginatedResponse with next_cursor', () => {
    const itemSchema = z.object({ id: z.string(), name: z.string() });
    const schema = paginatedResponseSchema(itemSchema);

    const payload: PaginatedResponse<{ id: string; name: string }> = {
      data: [
        { id: 'h1', name: 'Home' },
        { id: 'h2', name: 'Cabin' },
      ],
      next_cursor: '2026-07-16T00:00:00.000Z',
      total_count: 42,
    };

    const parsed = schema.parse(payload);
    expect(parsed).toEqual(payload);
  });

  it('accepts household photo_url as null', () => {
    expect(householdPhotoUrlSchema.parse(null)).toBeNull();
    expect(householdPhotoUrlSchema.parse('https://cdn.example/photo.jpg')).toBe(
      'https://cdn.example/photo.jpg'
    );
  });

  it('rejects undefined photo_url (nullable, not optional)', () => {
    expect(() => householdPhotoUrlSchema.parse(undefined)).toThrow();
  });

  it('parses households list response', () => {
    const payload = {
      households: [
        {
          id: 'h1',
          name: 'Home',
          address_line1: null,
          address_line2: null,
          city: null,
          state_province: null,
          postal_code: null,
          country: null,
          photo_key: null,
          photo_url: null,
          purchase_price: null,
          purchase_date: null,
          // Required-nullable in householdListItemSchema; household-service.ts
          // always emits it (value or null), so the fixture must carry it too.
          unit_system: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          member_count: 1,
          my_role: 'owner' as const,
        },
      ],
    };
    expect(householdsListResponseSchema.parse(payload)).toEqual(payload);
    expect(householdListItemSchema.parse(payload.households[0]).photo_url).toBeNull();
  });

  it('parses tasks list response with cursor', () => {
    const payload = {
      tasks: [
        {
          id: 't1',
          system_category: null,
          title: 'Fix faucet',
          description: null,
          frequency: 'one_time' as const,
          custom_interval_days: null,
          next_due_date: null,
          last_completed_at: null,
          assigned_to: null,
          is_active: true,
          source: 'manual' as const,
          reminder_enabled: false,
          reminder_days_before: 1,
          reminder_time: '09:00',
          reminder_repeat: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      next_cursor: 'abc',
    };
    expect(tasksListResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses subscription me response', () => {
    const payload = {
      subscription: {
        id: 'sub_1',
        tier: 'free' as const,
        status: 'active' as const,
        current_period_start: '2026-01-01T00:00:00.000Z',
        current_period_end: '2027-01-01T00:00:00.000Z',
        cancel_at_period_end: false,
        entitlement_id: null,
        provider: null,
        billing_state: 'normal',
      },
      is_paid: false,
      can_use_ai: false,
      denial_reason: 'subscription_required',
      access_source: null,
    };
    expect(subscriptionMeResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses notifications history response', () => {
    const payload = {
      notifications: [
        {
          id: 'n1',
          user_id: 'u1',
          type: 'task_reminder',
          title: 'Task due',
          body: 'Fix faucet',
          data: null,
          sent_at: '2026-01-01T00:00:00.000Z',
          read_at: null,
          clicked_at: null,
          reference_type: 'task',
          reference_id: 't1',
        },
      ],
      nextCursor: 'n1',
    };
    expect(notificationsHistoryResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses reports list response', () => {
    const payload = {
      reports: [
        {
          id: 'r1',
          household_id: 'h1',
          filename: 'inspection.pdf',
          file_size: 1024,
          status: 'completed' as const,
          error_message: null,
          page_count: 12,
          inspection_date: '2026-01-15',
          inspector_name: 'Jane Doe',
          property_address: '123 Main St',
          uploaded_by: { id: 'u1', display_name: 'Owner' },
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      next_cursor: '2026-01-01T00:00:00.000Z',
    };
    expect(reportsListResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses report detail response', () => {
    const payload = {
      report: {
        id: 'r1',
        household_id: 'h1',
        filename: 'inspection.pdf',
        file_size: 1024,
        status: 'completed' as const,
        error_message: null,
        page_count: 12,
        inspection_date: '2026-01-15',
        inspector_name: 'Jane Doe',
        property_address: '123 Main St',
        uploaded_by: { id: 'u1', display_name: 'Owner' },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    };
    expect(reportDetailResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses notifications unread-count response', () => {
    expect(notificationsUnreadCountResponseSchema.parse({ count: 3 })).toEqual({
      count: 3,
    });
  });

  it('parses ai access response', () => {
    const payload = {
      can_use_ai: true,
      source: 'simplehouse' as const,
      provider: 'openai' as const,
      selected_model_id: 'gpt-4o',
      available_models: [
        {
          id: 'gpt-4o',
          display_name: 'GPT-4o',
          profile_label: 'Balanced',
          capabilities: ['chat'],
          is_default: true,
          flagship: false,
        },
      ],
      denial_reason: null,
      subscription: { is_paid: true },
      byok: {
        enabled: true,
        connections: [
          {
            provider: 'openai' as const,
            status: 'active',
            key_hint: '•••• 9Z2X',
            last_validated_at: null,
            capabilities: ['chat'],
            selected_model_id: 'gpt-4o',
          },
        ],
      },
    };
    expect(aiAccessResponseSchema.parse(payload)).toEqual(payload);
  });

  it('parses household detail response with members', () => {
    const payload = {
      household: {
        id: 'h1',
        name: 'Home',
        address_line1: null,
        address_line2: null,
        city: null,
        state_province: null,
        postal_code: null,
        country: null,
        photo_key: null,
        photo_url: null,
        purchase_price: null,
        purchase_date: null,
        unit_system: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        member_count: 1,
        my_role: 'owner' as const,
      },
      members: [
        {
          id: 'm1',
          user_id: 'u1',
          display_name: 'Owner',
          avatar_url: null,
          email: 'owner@example.com',
          role: 'owner' as const,
          joined_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    expect(householdDetailResponseSchema.parse(payload)).toEqual(payload);
    expect(householdMemberSchema.parse(payload.members[0]).email).toBe('owner@example.com');
  });

  it('parses appliances list response', () => {
    const payload = {
      appliances: [
        {
          id: 'a1',
          household_id: 'h1',
          name: 'Fridge',
          category: 'kitchen',
          type: 'refrigerator',
          total_maintenance_cost: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    expect(appliancesListResponseSchema.parse(payload)).toEqual(payload);
    expect(applianceListItemSchema.parse(payload.appliances[0]).name).toBe('Fridge');
  });

  it('parses home features list response', () => {
    const payload = {
      features: [
        {
          id: 'f1',
          household_id: 'h1',
          feature_type: 'hvac',
          feature_subtype: 'central',
          quantity: 1,
          location: 'Basement',
          brand: null,
          model: null,
          serial_number: null,
          install_date: null,
          warranty_expires: null,
          age_years: null,
          condition: 'good' as const,
          notes: null,
          source: 'manual' as const,
          source_report_id: null,
          extraction_confidence: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    expect(homeFeaturesListResponseSchema.parse(payload)).toEqual(payload);
    expect(homeFeatureListItemSchema.parse(payload.features[0]).feature_type).toBe('hvac');
  });

  it('exposes transfer package registry (ECO-2)', () => {
    expect(Object.keys(TRANSFER_PACKAGES)).toEqual([
      'profile.core.v1',
      'house.property.v1',
      'budget.summary.v1',
      'home_project_cost_summary.v1',
      'profile.core.health.v1',
      'health.summary.v1',
      'profile.core.language.v1',
      'language.summary.v1',
    ]);
    expect(getTransferPackage('budget.summary.v1')?.destinationBrandId).toBe('symply-house');
    expect(getTransferPackage('profile.core.health.v1')?.destinationBrandId).toBe('symply-health');
    expect(getTransferPackage('profile.core.language.v1')?.destinationBrandId).toBe(
      'symply-language'
    );
  });
});
