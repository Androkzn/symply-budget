import { LifeSystem } from '../../constants';
import { materializeActions, SYSTEM_TASK_CATALOG } from '../taskCatalog';

describe('Kaizen system task catalog', () => {
  it('contains areas for health, career, and mental systems', () => {
    expect(SYSTEM_TASK_CATALOG[LifeSystem.Health].length).toBeGreaterThan(0);
    expect(SYSTEM_TASK_CATALOG[LifeSystem.Career].length).toBeGreaterThan(0);
    expect(SYSTEM_TASK_CATALOG[LifeSystem.Mental].length).toBeGreaterThan(0);
  });

  it('materializes selected templates with output descriptions and daily-core policy', () => {
    const actions = materializeActions('user-1', LifeSystem.Health, [
      'health.sleep.window',
      'health.food.logMeals',
    ]);

    expect(actions).toHaveLength(2);
    expect(actions.map(action => action.title)).toEqual(['Hit your sleep window', 'Log your meals']);
    expect(actions[0]).toMatchObject({
      output_description: 'Lights out within the window',
      is_daily_core: 1,
      reminder_anchor: 'wakeResponsive',
      sort_order: 0,
    });
    expect(actions[1].linked_feature).toBe(JSON.stringify('nutritionLog'));
  });

  it('keeps non-core templates outside the wake-responsive policy', () => {
    const [action] = materializeActions('user-1', LifeSystem.Health, ['health.sleep.winddown']);

    expect(action).toMatchObject({ is_daily_core: 0, reminder_anchor: null });
  });

  it('ignores unknown template ids and filters custom tasks without output', () => {
    const actions = materializeActions(
      'user-1',
      LifeSystem.Health,
      ['unknown.task', 'health.sleep.window'],
      [
        { title: 'Busywork', outputDescription: '   ', suggestedDailyCore: false },
        { title: 'Water plants', outputDescription: 'Plants watered', suggestedDailyCore: true },
      ],
    );

    expect(actions).toHaveLength(2);
    expect(actions.map(action => action.title)).toEqual(['Hit your sleep window', 'Water plants']);
    expect(actions[1]).toMatchObject({
      output_description: 'Plants watered',
      is_daily_core: 1,
      reminder_anchor: 'wakeResponsive',
      sort_order: 1,
    });
  });

  it('creates fresh ids each time it materializes a template', () => {
    const [first] = materializeActions('user-1', LifeSystem.Health, ['health.sleep.window']);
    const [second] = materializeActions('user-1', LifeSystem.Health, ['health.sleep.window']);

    expect(first.title).toBe(second.title);
    expect(first.id).not.toBe(second.id);
  });
});
