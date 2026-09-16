import { useState } from 'react';

import {
  useInvalidateKaizenInterviewQuestions,
  useKaizenInterviewQuestions,
} from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { selectActiveInterviewQuestions } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAuthStore } from '@stores/authStore';

export const CAREER_SETUP_GOALS = ['New role', 'Promotion', 'Interview readiness', 'Skill change'];
export const CAREER_SETUP_STEP_TITLES = ['Goals and roles', 'Resume', 'Skills', 'Questions', 'Finish'];

interface UseCareerSetupWizardOptions {
  /**
   * Called once the wizard's last step has saved successfully. The caller
   * decides what "done" means — the standalone screen returns to the career
   * hub; the onboarding screen finishes account onboarding instead.
   */
  onComplete: () => void | Promise<void>;
}

/**
 * The 5-step career-setup wizard's state machine (goals/roles → resume →
 * skills → questions → finish), shared by `CareerSetupScreen` (reached from
 * Settings / the old post-onboarding setup queue) and the account-onboarding
 * `KaizenCareerSetupScreen` — same steps, same validation gates, same store
 * calls; only the chrome around it and what happens on completion differ.
 */
export function useCareerSetupWizard({ onComplete }: UseCareerSetupWizardOptions) {
  const addSkill = useKaizenStore((state) => state.addSkill);
  const importQuestionsFromText = useKaizenStore((state) => state.importQuestionsFromText);
  const addInterviewQuestion = useKaizenStore((state) => state.addInterviewQuestion);
  const analyzeResume = useKaizenStore((state) => state.analyzeResume);
  const saveCareerSetup = useKaizenStore((state) => state.saveCareerSetup);
  const userId = useAuthStore((state) => state.user?.id);
  const profile = useKaizenStore((state) => state.profile);
  const { data: interviewQuestions = [] } = useKaizenInterviewQuestions();
  const invalidateQuestions = useInvalidateKaizenInterviewQuestions();

  const [step, setStep] = useState(0);
  const [roles, setRoles] = useState('');
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [resumeText, setResumeText] = useState('');
  const [resumeSourceName, setResumeSourceName] = useState<string | null>(null);
  const [resumeSummary, setResumeSummary] = useState<string | null>(
    profile?.resume_summary ?? null,
  );
  const [skill, setSkill] = useState('');
  const [questions, setQuestions] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const targetRoles = roles.split(',').map((role) => role.trim()).filter(Boolean);
  const activeQuestions = selectActiveInterviewQuestions(interviewQuestions);
  const technicalCount = activeQuestions.filter((q) => q.question_bank === 'technical').length;
  const behavioralCount = activeQuestions.filter((q) => q.question_bank === 'behavioral').length;

  const hasResume = resumeText.trim().length > 0 || Boolean(resumeSummary);
  const questionsSatisfied = technicalCount >= 1 && behavioralCount >= 1;
  const canContinue = step === 1 ? hasResume : step === 3 ? questionsSatisfied : true;

  const toggleGoal = (goal: string) =>
    setSelectedGoals((current) =>
      current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal],
    );

  const refreshQuestions = async () => {
    if (userId) {
      await invalidateQuestions(userId);
    }
  };

  const persistResume = async () => {
    let summary = resumeSummary;
    if (resumeText.trim()) {
      const response = await analyzeResume(resumeText.trim());
      summary = response.summary ?? resumeText.trim().slice(0, 280);
      setResumeSummary(summary);
    }
    await saveCareerSetup({
      targetRoles,
      goalTypes: selectedGoals,
      resumeSummary: summary ?? undefined,
      // A picked file keeps its name; a freshly pasted resume is labelled; when
      // neither changed this pass, leave the stored source name untouched.
      resumeSourceName: resumeSourceName ?? (resumeText.trim() ? 'Pasted resume' : undefined),
      step: 'resume',
    });
  };

  const onResumeImported = (result: {
    resumeText?: string;
    resumeSummary?: string;
    message?: string;
  }) => {
    if (result.resumeText) setResumeText(result.resumeText);
    if (result.resumeSummary) setResumeSummary(result.resumeSummary);
    setResumeSourceName(result.message?.includes('saved') ? 'Uploaded resume' : null);
  };

  const back = () => setStep((current) => Math.max(0, current - 1));

  const next = async () => {
    if (!canContinue) return;
    setBusy(true);
    try {
      if (step === 1) await persistResume();
      if (step === 2 && skill.trim()) {
        await addSkill(skill.trim());
        setSkill('');
      }
      if (step < CAREER_SETUP_STEP_TITLES.length - 1) {
        setStep((current) => current + 1);
        return;
      }
      setSaving(true);
      await saveCareerSetup({
        targetRoles,
        goalTypes: selectedGoals,
        resumeSummary: resumeSummary ?? undefined,
        resumeSourceName: resumeSourceName ?? undefined,
        step: 'complete',
      });
      await onComplete();
    } catch {
      // Keep the user on the current step when persistence fails.
    } finally {
      setSaving(false);
      setBusy(false);
    }
  };

  const importPastedQuestions = async () => {
    if (!questions.trim()) return;
    setBusy(true);
    try {
      await importQuestionsFromText(questions);
      setQuestions('');
      await refreshQuestions();
    } catch {
      // Keep pasted questions when import fails.
    } finally {
      setBusy(false);
    }
  };

  const addManual = async (bank: 'technical' | 'behavioral') => {
    if (!manualPrompt.trim()) return;
    setBusy(true);
    try {
      await addInterviewQuestion(manualPrompt.trim(), bank);
      setManualPrompt('');
      await refreshQuestions();
    } catch {
      // Keep the prompt when add fails.
    } finally {
      setBusy(false);
    }
  };

  return {
    step,
    back,
    next,
    canContinue,
    busy,
    saving,
    roles,
    setRoles,
    selectedGoals,
    toggleGoal,
    resumeText,
    setResumeText,
    hasResume,
    onResumeImported,
    skill,
    setSkill,
    questions,
    setQuestions,
    manualPrompt,
    setManualPrompt,
    technicalCount,
    behavioralCount,
    questionsSatisfied,
    importPastedQuestions,
    addManual,
  };
}
