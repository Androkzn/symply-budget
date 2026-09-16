/**
 * v1.2 legacy Gemini-native tool declarations for the Smart Home /chat SSE flow.
 * Lives under `ai/` so `@google/generative-ai` SchemaType stays behind the adapter
 * boundary (CA-2 / Track A1). Consumed by `services/ai/gemini-service.ts` via
 * re-export from `services/ai/tools/index.ts`.
 */
import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';

export const geminiLegacyToolRegistry: FunctionDeclaration[] = [
  // Task Management
  {
    name: 'createMaintenanceTask',
    description: 'Create a new maintenance task for the household',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING, description: 'Task title' },
        description: { type: SchemaType.STRING, description: 'Task description' },
        category: {
          type: SchemaType.STRING,
          enum: ['hvac', 'plumbing', 'electrical', 'appliances', 'exterior', 'interior', 'seasonal', 'other'],
        },
        frequency: {
          type: SchemaType.STRING,
          enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'],
        },
        customIntervalDays: { type: SchemaType.NUMBER },
        nextDueDate: { type: SchemaType.STRING, description: 'ISO date' },
        reminderDaysBefore: { type: SchemaType.NUMBER },
      },
      required: ['title', 'frequency'],
    },
  },
  {
    name: 'getTasks',
    description: 'Get list of maintenance tasks',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        category: { type: SchemaType.STRING },
        isActive: { type: SchemaType.BOOLEAN },
        limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: 'completeTask',
    description: 'Mark a task as completed',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        taskId: { type: SchemaType.STRING },
        notes: { type: SchemaType.STRING },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'getTaskHistory',
    description: 'Get completion history for a task',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { taskId: { type: SchemaType.STRING } },
      required: ['taskId'],
    },
  },

  // Onboarding
  {
    name: 'getOnboardingStatus',
    description: 'Get onboarding progress',
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'addHousehold',
    description: 'Create a new household',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING },
        addressLine1: { type: SchemaType.STRING },
        city: { type: SchemaType.STRING },
        stateProvince: { type: SchemaType.STRING },
        postalCode: { type: SchemaType.STRING },
        country: { type: SchemaType.STRING, enum: ['CA', 'US'] },
      },
      required: ['name'],
    },
  },

  // Garbage Schedule
  {
    name: 'addGarbageSchedule',
    description: 'Set up garbage collection schedule',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        municipality: { type: SchemaType.STRING },
        schedules: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              type: {
                type: SchemaType.STRING,
                enum: ['garbage', 'recycling', 'organics', 'yardWaste', 'bulkItem'],
              },
              frequency: { type: SchemaType.STRING, enum: ['weekly', 'biweekly', 'monthly'] },
              dayOfWeek: { type: SchemaType.NUMBER },
            },
          },
        },
      },
      required: ['municipality', 'schedules'],
    },
  },
  {
    name: 'getNextGarbageCollections',
    description: 'Get upcoming garbage collection dates',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { days: { type: SchemaType.NUMBER } },
    },
  },

  // Notifications
  {
    name: 'updateNotificationPreferences',
    description: 'Update notification settings',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        taskReminders: { type: SchemaType.BOOLEAN },
        taskOverdue: { type: SchemaType.BOOLEAN },
        garbageCollection: { type: SchemaType.BOOLEAN },
        reportReady: { type: SchemaType.BOOLEAN },
      },
    },
  },
];

/** @deprecated Prefer importing from `ai/gemini-legacy-tool-registry` directly. */
export const toolRegistry = geminiLegacyToolRegistry;
