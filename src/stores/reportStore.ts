import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { Report, Finding, ActionPlan, ProcessingJob } from '@api/reports';

interface ReportState {
  reports: Report[];
  currentReport: Report | null;
  findings: Finding[];
  actionPlans: ActionPlan[];
  currentJob: ProcessingJob | null;
  isLoading: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}

interface ReportActions {
  setReports: (reports: Report[]) => void;
  addReport: (report: Report) => void;
  updateReport: (reportId: string, updates: Partial<Report>) => void;
  removeReport: (reportId: string) => void;
  setCurrentReport: (report: Report | null) => void;
  setFindings: (findings: Finding[]) => void;
  setActionPlans: (plans: ActionPlan[]) => void;
  setCurrentJob: (job: ProcessingJob | null) => void;
  setLoading: (loading: boolean) => void;
  setUploading: (uploading: boolean) => void;
  setUploadProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type ReportStore = ReportState & ReportActions;

const initialState: ReportState = {
  reports: [],
  currentReport: null,
  findings: [],
  actionPlans: [],
  currentJob: null,
  isLoading: false,
  isUploading: false,
  uploadProgress: 0,
  error: null,
};

export const useReportStore = create<ReportStore>()(
  immer((set) => ({
    ...initialState,

    setReports: (reports) =>
      set((state) => {
        state.reports = reports;
      }),

    addReport: (report) =>
      set((state) => {
        state.reports.unshift(report);
      }),

    updateReport: (reportId, updates) =>
      set((state) => {
        const index = state.reports.findIndex((r) => r.id === reportId);
        if (index !== -1) {
          state.reports[index] = { ...state.reports[index], ...updates };
        }
        if (state.currentReport?.id === reportId) {
          state.currentReport = { ...state.currentReport, ...updates };
        }
      }),

    removeReport: (reportId) =>
      set((state) => {
        state.reports = state.reports.filter((r) => r.id !== reportId);
        if (state.currentReport?.id === reportId) {
          state.currentReport = null;
          state.findings = [];
          state.actionPlans = [];
        }
      }),

    setCurrentReport: (report) =>
      set((state) => {
        state.currentReport = report;
      }),

    setFindings: (findings) =>
      set((state) => {
        state.findings = findings;
      }),

    setActionPlans: (plans) =>
      set((state) => {
        state.actionPlans = plans;
      }),

    setCurrentJob: (job) =>
      set((state) => {
        state.currentJob = job;
      }),

    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setUploading: (uploading) =>
      set((state) => {
        state.isUploading = uploading;
        if (!uploading) {
          state.uploadProgress = 0;
        }
      }),

    setUploadProgress: (progress) =>
      set((state) => {
        state.uploadProgress = progress;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    reset: () => set(initialState),
  }))
);
