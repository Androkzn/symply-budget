import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type {
  ProjectWithDetails,
  ProjectMilestone,
  ProjectPayment,
  ProjectProgressPhoto,
  ProjectStatus,
} from '@api/projects';

interface ProjectState {
  projects: ProjectWithDetails[];
  activeProjects: ProjectWithDetails[];
  selectedProject: ProjectWithDetails | null;
  filterStatus: ProjectStatus | null;
  isLoading: boolean;
  error: string | null;
}

interface ProjectActions {
  setProjects: (projects: ProjectWithDetails[]) => void;
  setActiveProjects: (projects: ProjectWithDetails[]) => void;
  addProject: (project: ProjectWithDetails) => void;
  updateProject: (projectId: string, updates: Partial<ProjectWithDetails>) => void;
  removeProject: (projectId: string) => void;
  setSelectedProject: (project: ProjectWithDetails | null) => void;
  setFilterStatus: (status: ProjectStatus | null) => void;
  // Milestone actions
  addMilestone: (projectId: string, milestone: ProjectMilestone) => void;
  updateMilestone: (projectId: string, milestoneId: string, updates: Partial<ProjectMilestone>) => void;
  removeMilestone: (projectId: string, milestoneId: string) => void;
  // Payment actions
  addPayment: (projectId: string, payment: ProjectPayment) => void;
  updatePayment: (projectId: string, paymentId: string, updates: Partial<ProjectPayment>) => void;
  removePayment: (projectId: string, paymentId: string) => void;
  // Photo actions
  addProgressPhoto: (projectId: string, photo: ProjectProgressPhoto) => void;
  removeProgressPhoto: (projectId: string, photoId: string) => void;
  // Common
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type ProjectStore = ProjectState & ProjectActions;

const initialState: ProjectState = {
  projects: [],
  activeProjects: [],
  selectedProject: null,
  filterStatus: null,
  isLoading: false,
  error: null,
};

const updateProjectProgress = (project: ProjectWithDetails): ProjectWithDetails => {
  const completedMilestones = project.milestones.filter((m) => m.status === 'completed').length;
  const totalMilestones = project.milestones.length;
  const paidAmount = project.payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0);
  const totalAmount = project.payments.reduce((sum, p) => sum + p.amount_cents, 0);

  return {
    ...project,
    progress: {
      completedMilestones,
      totalMilestones,
      paidAmount,
      totalAmount,
    },
  };
};

export const useProjectStore = create<ProjectStore>()(
  immer((set) => ({
    ...initialState,

      setProjects: (projects) =>
        set((state) => {
          state.projects = projects.map(updateProjectProgress);
        }),

      setActiveProjects: (projects) =>
        set((state) => {
          state.activeProjects = projects.map(updateProjectProgress);
        }),

      addProject: (project) =>
        set((state) => {
          const updatedProject = updateProjectProgress(project);
          state.projects.unshift(updatedProject);
          if (['planning', 'in_progress'].includes(project.status)) {
            state.activeProjects.unshift(updatedProject);
          }
        }),

      updateProject: (projectId, updates) =>
        set((state) => {
          const updateAndRecalculate = (project: ProjectWithDetails) => {
            const updated = { ...project, ...updates };
            return updateProjectProgress(updated);
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateAndRecalculate(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            const updated = updateAndRecalculate(state.activeProjects[activeIndex]);
            if (['completed', 'cancelled'].includes(updated.status)) {
              state.activeProjects.splice(activeIndex, 1);
            } else {
              state.activeProjects[activeIndex] = updated;
            }
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateAndRecalculate(state.selectedProject);
          }
        }),

      removeProject: (projectId) =>
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== projectId);
          state.activeProjects = state.activeProjects.filter((p) => p.id !== projectId);
          if (state.selectedProject?.id === projectId) {
            state.selectedProject = null;
          }
        }),

      setSelectedProject: (project) =>
        set((state) => {
          state.selectedProject = project ? updateProjectProgress(project) : null;
        }),

      setFilterStatus: (status) =>
        set((state) => {
          state.filterStatus = status;
        }),

      // Milestone actions
      addMilestone: (projectId, milestone) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const milestones = [...project.milestones, milestone].sort((a, b) => a.sort_order - b.sort_order);
            return updateProjectProgress({ ...project, milestones });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      updateMilestone: (projectId, milestoneId, updates) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const milestones = project.milestones.map((m) =>
              m.id === milestoneId ? { ...m, ...updates } : m
            );
            return updateProjectProgress({ ...project, milestones });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      removeMilestone: (projectId, milestoneId) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const milestones = project.milestones.filter((m) => m.id !== milestoneId);
            return updateProjectProgress({ ...project, milestones });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      // Payment actions
      addPayment: (projectId, payment) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const payments = [...project.payments, payment];
            return updateProjectProgress({ ...project, payments });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      updatePayment: (projectId, paymentId, updates) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const payments = project.payments.map((p) =>
              p.id === paymentId ? { ...p, ...updates } : p
            );
            return updateProjectProgress({ ...project, payments });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      removePayment: (projectId, paymentId) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => {
            const payments = project.payments.filter((p) => p.id !== paymentId);
            return updateProjectProgress({ ...project, payments });
          };

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      // Photo actions
      addProgressPhoto: (projectId, photo) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => ({
            ...project,
            progressPhotos: [...project.progressPhotos, photo],
          });

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      removeProgressPhoto: (projectId, photoId) =>
        set((state) => {
          const updateProject = (project: ProjectWithDetails) => ({
            ...project,
            progressPhotos: project.progressPhotos.filter((p) => p.id !== photoId),
          });

          const index = state.projects.findIndex((p) => p.id === projectId);
          if (index !== -1) {
            state.projects[index] = updateProject(state.projects[index]);
          }

          const activeIndex = state.activeProjects.findIndex((p) => p.id === projectId);
          if (activeIndex !== -1) {
            state.activeProjects[activeIndex] = updateProject(state.activeProjects[activeIndex]);
          }

          if (state.selectedProject?.id === projectId) {
            state.selectedProject = updateProject(state.selectedProject);
          }
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),
    }))
);
