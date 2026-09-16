import { LifeSystem } from '../constants';
import type { KaizenActionEntry } from '../types';

/**
 * Port of Simple Health `KaizenSystemTaskCatalogService` — deterministic,
 * AI-free area + task templates. Career includes only the non-assessment set;
 * full career onboarding lives in the career setup wizard.
 */

export interface SystemTaskTemplate {
  id: string;
  title: string;
  outputDescription: string;
  inputDescription?: string;
  suggestedDailyCore: boolean;
  timeOfDay?: string;
  reminderAnchor?: string;
  linkedFeature?: string;
  rhythm?: string;
  watchQuickLog?: boolean;
}

export interface SystemTaskArea {
  id: string;
  title: string;
  tasks: SystemTaskTemplate[];
}

function t(
  id: string,
  title: string,
  input: string,
  output: string,
  opts: Partial<SystemTaskTemplate> = {},
): SystemTaskTemplate {
  return {
    id,
    title,
    inputDescription: input,
    outputDescription: output,
    suggestedDailyCore: opts.suggestedDailyCore ?? false,
    timeOfDay: opts.timeOfDay,
    reminderAnchor: opts.reminderAnchor,
    linkedFeature: opts.linkedFeature,
    rhythm: opts.rhythm ?? 'daily',
    watchQuickLog: opts.watchQuickLog,
  };
}

export const SYSTEM_TASK_CATALOG: Record<LifeSystem, SystemTaskArea[]> = {
  [LifeSystem.Health]: [
    {
      id: 'health.sleep',
      title: 'Sleep',
      tasks: [
        t('health.sleep.window', 'Hit your sleep window', 'Target bedtime + wake time', 'Lights out within the window', {
          timeOfDay: 'evening',
          suggestedDailyCore: true,
          watchQuickLog: true,
        }),
        t('health.sleep.winddown', 'Evening wind-down', 'Screens off, dim lights', '30 min of wind-down logged', {
          timeOfDay: 'evening',
        }),
      ],
    },
    {
      id: 'health.food',
      title: 'Food',
      tasks: [
        t('health.food.logMeals', 'Log your meals', 'What you ate', "Day's nutrition logged", {
          suggestedDailyCore: true,
          linkedFeature: 'nutritionLog',
          watchQuickLog: true,
        }),
        t('health.food.water', 'Drink your water', 'Glasses of water', 'Daily water goal logged', {
          suggestedDailyCore: true,
          linkedFeature: 'waterLog',
          watchQuickLog: true,
        }),
      ],
    },
    {
      id: 'health.movement',
      title: 'Movement',
      tasks: [
        t('health.movement.workout', 'Move your body', 'Workout or activity', 'Workout logged', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
          linkedFeature: 'workout',
          watchQuickLog: true,
        }),
        t('health.movement.stand', 'Break up sitting', 'Stand / walk breaks', 'Daily standing goal met', {
          linkedFeature: 'deskHeroGoal',
        }),
        t('health.movement.weighIn', 'Weigh in', 'Step on the scale', 'Weight logged', {
          timeOfDay: 'morning',
          linkedFeature: 'weightLog',
          watchQuickLog: true,
        }),
      ],
    },
    {
      id: 'health.stress',
      title: 'Stress',
      tasks: [
        t('health.stress.breath', 'Down-regulate', '2 min of slow breathing', 'One reset session logged', {
          timeOfDay: 'afternoon',
        }),
        t('health.stress.checkin', 'Body check-in', 'Notice tension / energy', 'One-line state note', {
          timeOfDay: 'midday',
        }),
      ],
    },
    {
      id: 'health.hygiene',
      title: 'Hygiene',
      tasks: [
        t('health.hygiene.teethMorning', 'Brush teeth (morning)', 'Toothbrush + toothpaste', 'Teeth brushed for 2 min', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
          watchQuickLog: true,
        }),
        t('health.hygiene.faceMorning', 'Wash face (morning)', 'Cleanser + water', 'Face washed, skin clean', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
        }),
        t('health.hygiene.shower', 'Shower / bath', 'Shower or bath', 'Body clean and refreshed', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
          watchQuickLog: true,
        }),
        t('health.hygiene.teethEvening', 'Brush teeth (evening)', 'Toothbrush + toothpaste + floss', 'Teeth brushed and flossed', {
          timeOfDay: 'evening',
          suggestedDailyCore: true,
          watchQuickLog: true,
        }),
        t('health.hygiene.faceEvening', 'Wash face (evening)', 'Cleanser + water', 'Makeup/dirt removed, face clean', {
          timeOfDay: 'evening',
        }),
        t('health.hygiene.skincare', 'Skincare routine', 'Moisturizer / serum / SPF', 'Skincare routine completed', {
          timeOfDay: 'morning',
        }),
        t('health.hygiene.deodorant', 'Deodorant / grooming', 'Deodorant, hair, nails', 'Grooming routine done', {
          timeOfDay: 'morning',
        }),
        t('health.hygiene.hairEvening', 'Hair care (evening)', 'Brush / comb / oil', 'Hair brushed and cared for', {
          timeOfDay: 'evening',
        }),
      ],
    },
  ],
  [LifeSystem.Mental]: [
    {
      id: 'mental.pages',
      title: 'Morning pages',
      tasks: [
        t('mental.pages.morning', 'Morning pages', 'A blank page', '3 pages / 10 min written', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
        }),
        t('mental.pages.brainDump', 'Brain dump', 'Everything on your mind', 'List captured to clear the head', {
          timeOfDay: 'evening',
        }),
      ],
    },
    {
      id: 'mental.meditation',
      title: 'Meditation',
      tasks: [
        t('mental.meditation.sit', 'Meditate', 'Quiet space + timer', 'One session logged', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
          watchQuickLog: true,
        }),
        t('mental.meditation.gratitude', 'Gratitude', 'Prompt: 3 good things', '3 items written'),
      ],
    },
    {
      id: 'mental.reflection',
      title: 'Reflection',
      tasks: [
        t('mental.reflection.evening', 'Evening reflection', 'How the day went', 'One reflection entry', {
          timeOfDay: 'evening',
        }),
        t('mental.reflection.win', "Name today's win", 'What went right', 'One win recorded', {
          timeOfDay: 'evening',
          watchQuickLog: true,
        }),
      ],
    },
  ],
  [LifeSystem.PersonalLife]: [
    {
      id: 'personal.relationships',
      title: 'Relationships',
      tasks: [
        t('personal.relationships.reachOut', 'Reach out to someone', 'Someone you value', 'One message / call made', {
          suggestedDailyCore: true,
        }),
        t('personal.relationships.quality', 'Quality time', 'Phone away', 'Focused time with someone logged', {
          timeOfDay: 'evening',
        }),
      ],
    },
    {
      id: 'personal.home',
      title: 'Home',
      tasks: [
        t('personal.home.reset', '10-minute home reset', 'One room / surface', 'Space tidied', {
          timeOfDay: 'evening',
        }),
        t('personal.home.oneChore', 'One chore', 'Pick from the list', 'One chore done'),
      ],
    },
    {
      id: 'personal.hobbies',
      title: 'Hobbies',
      tasks: [
        t('personal.hobbies.practice', 'Practice your hobby', 'Your craft / instrument', 'One practice session logged'),
        t('personal.hobbies.read', 'Read', 'Current book', 'Pages / minutes read', { timeOfDay: 'evening' }),
      ],
    },
    {
      id: 'personal.finances',
      title: 'Finances',
      tasks: [
        t('personal.finances.review', 'Daily money check', "Yesterday's spending", 'Reviewed; anything flagged', {
          timeOfDay: 'morning',
        }),
        t('personal.finances.noSpend', 'Intentional spend', 'Planned purchases only', "Day's discretionary spend logged"),
      ],
    },
  ],
  [LifeSystem.Administration]: [
    {
      id: 'admin.inbox',
      title: 'Inbox',
      tasks: [
        t('admin.inbox.zero', 'Process the inbox', 'Email / message inbox', 'Inbox triaged to zero or near-zero', {
          suggestedDailyCore: true,
        }),
        t('admin.inbox.capture', 'Capture open loops', 'Anything nagging you', 'Items captured into GTD inbox'),
      ],
    },
    {
      id: 'admin.bills',
      title: 'Bills',
      tasks: [
        t('admin.bills.due', 'Check bills due', 'Upcoming bills', 'Due items confirmed / paid', { rhythm: 'weekly' }),
        t('admin.bills.subscriptions', 'Audit a subscription', 'Recurring charges', 'One subscription kept or cancelled', {
          rhythm: 'monthly',
        }),
      ],
    },
    {
      id: 'admin.appointments',
      title: 'Appointments',
      tasks: [
        t('admin.appointments.schedule', 'Handle one appointment', 'Pending appointment', 'Booked / rescheduled / confirmed', {
          rhythm: 'weekly',
        }),
        t('admin.appointments.prep', "Prep for what's next", "Tomorrow's calendar", 'Next-day prep noted', {
          timeOfDay: 'evening',
        }),
      ],
    },
    {
      id: 'admin.paperwork',
      title: 'Paperwork',
      tasks: [
        t('admin.paperwork.oneDoc', 'Deal with one document', 'Pile of paperwork', 'One document filed / actioned', {
          rhythm: 'weekly',
        }),
        t('admin.paperwork.file', 'File & shred', 'Loose papers', 'Filed or shredded', { rhythm: 'monthly' }),
      ],
    },
  ],
  [LifeSystem.Career]: [
    {
      id: 'career.daily',
      title: 'Daily reps',
      tasks: [
        t('career.daily.skillRep', 'One skill rep', "A skill you're building", 'One deliberate practice rep logged', {
          suggestedDailyCore: true,
        }),
        t('career.daily.learn', 'Learn something', 'Article / chapter / video', 'One note captured', {
          timeOfDay: 'morning',
        }),
        t('career.daily.shipNote', 'Ship a small note', "Today's work", 'One progress note written', {
          timeOfDay: 'evening',
        }),
        t(
          'career.daily.readLiterature',
          'Read professional literature',
          'A book / paper in your field',
          'One chapter or section read',
          { timeOfDay: 'evening' },
        ),
      ],
    },
    {
      id: 'career.jobsearch',
      title: 'Job Search',
      tasks: [
        t(
          'career.jobsearch.scan',
          'Check new job vacancies',
          'LinkedIn / job board (15 min)',
          'New vacancies reviewed, promising ones saved',
          { timeOfDay: 'morning', suggestedDailyCore: true, watchQuickLog: true },
        ),
        t(
          'career.jobsearch.apply',
          'Apply to vacancies today',
          'Saved vacancy list + tailored CV',
          'At least 3 applications sent',
          { timeOfDay: 'morning', suggestedDailyCore: true, watchQuickLog: true },
        ),
        t(
          'career.jobsearch.followUp',
          'Follow up on applications',
          'Applications sent > 5 days ago with no response',
          'Follow-up message sent or status updated',
          { rhythm: 'weekly', timeOfDay: 'morning' },
        ),
        t(
          'career.jobsearch.network',
          'Network outreach',
          'One relevant professional contact',
          'One message or connection request sent',
          { rhythm: 'weekly' },
        ),
      ],
    },
  ],
  [LifeSystem.Learning]: [
    {
      id: 'learning.study',
      title: 'Deliberate study',
      tasks: [
        t('learning.study.session', 'Study for 25 minutes', 'Topic + timer', 'Focused study session', {
          timeOfDay: 'morning',
          suggestedDailyCore: true,
        }),
        t('learning.study.recall', 'Practice active recall', 'Flashcards or blank page', 'Recall rep completed', {
          suggestedDailyCore: true,
        }),
      ],
    },
    {
      id: 'learning.synthesis',
      title: 'Synthesis',
      tasks: [
        t('learning.synthesis.note', 'Capture one useful note', 'Idea worth keeping', 'Note saved to knowledge'),
        t('learning.synthesis.apply', 'Apply one idea', 'Something you learned', 'Real-world application recorded'),
      ],
    },
  ],
  [LifeSystem.Finance]: [
    {
      id: 'finance.awareness',
      title: 'Awareness',
      tasks: [
        t('finance.awareness.spend', 'Review recent spending', 'Transactions', 'Spending reviewed', {
          timeOfDay: 'evening',
          suggestedDailyCore: true,
        }),
        t('finance.awareness.save', 'Make one savings decision', 'Surplus or cut', 'Savings action recorded'),
      ],
    },
    {
      id: 'finance.planning',
      title: 'Planning',
      tasks: [
        t('finance.planning.budget', 'Check your budget', 'Categories', 'Budget adjusted or confirmed'),
        t('finance.planning.bill', 'Handle one financial admin task', 'Bill or account', 'Bill or account task completed'),
      ],
    },
  ],
};

export function materializeActions(
  userId: string,
  system: LifeSystem,
  selectedTemplateIds: string[],
  customTasks: Array<
    Pick<SystemTaskTemplate, 'title' | 'outputDescription' | 'suggestedDailyCore' | 'timeOfDay' | 'reminderAnchor'> & {
      inputDescription?: string;
    }
  > = [],
): KaizenActionEntry[] {
  const now = new Date().toISOString();
  const templates = SYSTEM_TASK_CATALOG[system]
    .flatMap(area => area.tasks)
    .filter(task => selectedTemplateIds.includes(task.id));

  const tasks: SystemTaskTemplate[] = [
    ...templates,
    ...customTasks
      .filter(task => task.outputDescription.trim().length > 0)
      .map((task, index) => ({
        ...task,
        id: `custom-${Date.now()}-${index}`,
      })),
  ];

  return tasks.map((task, index) => ({
    id: cryptoRandomId(),
    user_id: userId,
    title: task.title,
    system,
    rhythm: task.rhythm ?? 'daily',
    linked_feature: task.linkedFeature ? JSON.stringify(task.linkedFeature) : null,
    is_daily_core: task.suggestedDailyCore ? 1 : 0,
    sort_order: index,
    time_of_day: task.timeOfDay ?? 'anytime',
    stack_id: null,
    rotation_day: null,
    reminder_anchor: task.suggestedDailyCore
      ? task.reminderAnchor ?? 'wakeResponsive'
      : task.reminderAnchor ?? null,
    reminder_policy: task.suggestedDailyCore ? 'wakeResponsiveRequired' : null,
    watch_quick_log_enabled: task.watchQuickLog ? 1 : 0,
    voice_log_prompt: null,
    input_description: task.inputDescription ?? null,
    output_description: task.outputDescription,
    is_archived: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }));
}

function cryptoRandomId(): string {
  /* eslint-disable no-bitwise -- uuid v4 bit packing */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  /* eslint-enable no-bitwise */
}
