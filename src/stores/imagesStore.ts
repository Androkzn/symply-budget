import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { ReportImage } from '@api/images';

interface ImagesState {
  images: ReportImage[];
  reportImages: Record<string, ReportImage[]>; // Keyed by reportId
  findingImages: Record<string, ReportImage[]>; // Keyed by findingId
  selectedImage: ReportImage | null;
  isLoading: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}

interface ImagesActions {
  setImages: (images: ReportImage[]) => void;
  setReportImages: (reportId: string, images: ReportImage[]) => void;
  setFindingImages: (findingId: string, images: ReportImage[]) => void;
  addImage: (image: ReportImage) => void;
  updateImage: (imageId: string, updates: Partial<ReportImage>) => void;
  removeImage: (imageId: string) => void;
  setSelectedImage: (image: ReportImage | null) => void;
  getImagesByReport: (reportId: string) => ReportImage[];
  getImagesByFinding: (findingId: string) => ReportImage[];
  linkImageToFinding: (imageId: string, findingId: string) => void;
  setLoading: (loading: boolean) => void;
  setUploading: (uploading: boolean) => void;
  setUploadProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type ImagesStore = ImagesState & ImagesActions;

const initialState: ImagesState = {
  images: [],
  reportImages: {},
  findingImages: {},
  selectedImage: null,
  isLoading: false,
  isUploading: false,
  uploadProgress: 0,
  error: null,
};

export const useImagesStore = create<ImagesStore>()(
  immer((set, get) => ({
    ...initialState,

      setImages: (images) =>
        set((state) => {
          state.images = images;
        }),

      setReportImages: (reportId, images) =>
        set((state) => {
          state.reportImages[reportId] = images;
          // Also update main images array
          const existingIds = new Set(state.images.map((i) => i.id));
          const newImages = images.filter((i) => !existingIds.has(i.id));
          state.images.push(...newImages);
        }),

      setFindingImages: (findingId, images) =>
        set((state) => {
          state.findingImages[findingId] = images;
        }),

      addImage: (image) =>
        set((state) => {
          state.images.push(image);
          // Add to report images if applicable
          if (image.report_id) {
            if (!state.reportImages[image.report_id]) {
              state.reportImages[image.report_id] = [];
            }
            state.reportImages[image.report_id].push(image);
          }
        }),

      updateImage: (imageId, updates) =>
        set((state) => {
          // Update in main array
          const index = state.images.findIndex((i) => i.id === imageId);
          if (index !== -1) {
            state.images[index] = { ...state.images[index], ...updates };
          }
          // Update in report images
          Object.keys(state.reportImages).forEach((reportId) => {
            const reportIndex = state.reportImages[reportId].findIndex((i) => i.id === imageId);
            if (reportIndex !== -1) {
              state.reportImages[reportId][reportIndex] = {
                ...state.reportImages[reportId][reportIndex],
                ...updates,
              };
            }
          });
          // Update in finding images
          Object.keys(state.findingImages).forEach((findingId) => {
            const findingIndex = state.findingImages[findingId].findIndex((i) => i.id === imageId);
            if (findingIndex !== -1) {
              state.findingImages[findingId][findingIndex] = {
                ...state.findingImages[findingId][findingIndex],
                ...updates,
              };
            }
          });
          // Update selected
          if (state.selectedImage?.id === imageId) {
            state.selectedImage = { ...state.selectedImage, ...updates };
          }
        }),

      removeImage: (imageId) =>
        set((state) => {
          state.images = state.images.filter((i) => i.id !== imageId);
          // Remove from report images
          Object.keys(state.reportImages).forEach((reportId) => {
            state.reportImages[reportId] = state.reportImages[reportId].filter((i) => i.id !== imageId);
          });
          // Remove from finding images
          Object.keys(state.findingImages).forEach((findingId) => {
            state.findingImages[findingId] = state.findingImages[findingId].filter((i) => i.id !== imageId);
          });
          if (state.selectedImage?.id === imageId) {
            state.selectedImage = null;
          }
        }),

      setSelectedImage: (image) =>
        set((state) => {
          state.selectedImage = image;
        }),

      getImagesByReport: (reportId) => {
        return get().reportImages[reportId] || [];
      },

      getImagesByFinding: (findingId) => {
        return get().findingImages[findingId] || [];
      },

      linkImageToFinding: (imageId, findingId) =>
        set((state) => {
          const imageIndex = state.images.findIndex((i) => i.id === imageId);
          if (imageIndex !== -1) {
            // Update the linked finding ID on the original image
            state.images[imageIndex].linked_finding_id = findingId;

            // Initialize the finding images array if needed
            if (!state.findingImages[findingId]) {
              state.findingImages[findingId] = [];
            }

            // Add reference to the same image object (not a copy) if not already linked
            if (!state.findingImages[findingId].find((i) => i.id === imageId)) {
              // Push the same reference from the images array to maintain sync
              state.findingImages[findingId].push(state.images[imageIndex]);
            }

            // Also update in reportImages if present
            Object.values(state.reportImages).forEach((reportImgs) => {
              const reportImgIndex = reportImgs.findIndex((i) => i.id === imageId);
              if (reportImgIndex !== -1) {
                reportImgs[reportImgIndex].linked_finding_id = findingId;
              }
            });
          }
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
