import { postKaizenAI } from '../api/kaizen';

import type { SkillAssessmentResult } from './skillAssessment';
import { storageHelpers } from './storage';


export interface LearningPlan {
  concept_sequence: string[];
  practice_queue: string[];
  review_focus: string[];
  reassessment_in_days: number;
}

export type LearningTaskKind = 'concept' | 'practice' | 'review';

export function learningTaskKey(kind: LearningTaskKind, title: string): string {
  return `${kind}::${title}`;
}

const key = (skillId: string) => `kaizen.learningplan.completed.${skillId}`;

/** Stable `kind::title` keys — survives plan rebuilds (matches parent VM). */
export function getCompletedLearningTaskKeys(skillId: string): string[] {
  try {
    const raw = storageHelpers.getString(key(skillId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setCompletedLearningTaskKeys(skillId: string, keys: string[]): void {
  storageHelpers.setString(key(skillId), JSON.stringify(keys));
}

/** @deprecated Use getCompletedLearningTaskKeys — kept for callers migrating titles only. */
export function getCompletedLearningTaskIds(skillId: string): string[] {
  return getCompletedLearningTaskKeys(skillId);
}

/** @deprecated Use setCompletedLearningTaskKeys. */
export function setCompletedLearningTaskIds(skillId: string, ids: string[]): void {
  setCompletedLearningTaskKeys(skillId, ids);
}

export function isLearningTaskComplete(
  skillId: string,
  kind: LearningTaskKind,
  title: string,
): boolean {
  const stable = learningTaskKey(kind, title);
  return getCompletedLearningTaskKeys(skillId).includes(stable);
}

export function toggleLearningTaskComplete(
  skillId: string,
  kind: LearningTaskKind,
  title: string,
): boolean {
  const stable = learningTaskKey(kind, title);
  const current = new Set(getCompletedLearningTaskKeys(skillId));
  if (current.has(stable)) {
    current.delete(stable);
    setCompletedLearningTaskKeys(skillId, [...current]);
    return false;
  }
  current.add(stable);
  setCompletedLearningTaskKeys(skillId, [...current]);
  return true;
}

export function buildOfflinePlan(result: SkillAssessmentResult): LearningPlan {
  const gaps = result.gapConceptIds.length ? result.gapConceptIds : ['core concepts', 'applied practice'];
  return {
    concept_sequence: [...gaps, ...result.strengthConceptIds],
    practice_queue: gaps.map(gap => `Practice ${gap}`),
    review_focus: result.strengthConceptIds.length ? result.strengthConceptIds : ['Explain your approach out loud'],
    reassessment_in_days: result.score0to100 >= 70 ? 21 : 14,
  };
}

export async function buildSkillLearningPlan(skill: string, result: SkillAssessmentResult): Promise<LearningPlan> {
  try {
    return await postKaizenAI('build-skill-learning-plan', {
      skill, placement_band: result.placedBand, mastery_0_to_100: result.score0to100,
      gaps: result.gapConceptIds, strengths: result.strengthConceptIds,
    }) as LearningPlan;
  } catch {
    return buildOfflinePlan(result);
  }
}
