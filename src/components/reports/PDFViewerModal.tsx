import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Platform, TextInput, KeyboardAvoidingView, useWindowDimensions } from 'react-native';

import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';
import type { AppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

// Lazy import PDF to avoid initialization errors
let Pdf: any = null;
try {
  Pdf = require('react-native-pdf').default;
} catch (error) {
  console.warn('react-native-pdf not available:', error);
}

interface PDFViewerModalProps {
  visible: boolean;
  onClose: () => void;
  pdfUrl: string;
  initialPage?: number;
  reportTitle?: string;
  citedPages?: number[];
}

export function PDFViewerModal({
  visible,
  onClose,
  pdfUrl,
  initialPage = 1,
  reportTitle,
  citedPages = [],
}: PDFViewerModalProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState(String(initialPage));
  const [showPageInput, setShowPageInput] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pdfRef = useRef<any>(null);

  // Reset state when modal opens/closes or when initialPage changes
  useEffect(() => {
    if (visible) {
      setCurrentPage(initialPage);
      setPageInputValue(String(initialPage));
      setTotalPages(0);
      setIsLoading(true);
      setError(null);
      setShowPageInput(false);
      setShowSearch(false);
      setSearchQuery('');

      // Validate PDF URL (must be file:// for local files)
      if (pdfUrl && !pdfUrl.startsWith('file://') && !pdfUrl.startsWith('http://') && !pdfUrl.startsWith('https://')) {
        console.error('[PDFViewer] Invalid PDF URL format:', pdfUrl);
        setError('Invalid PDF file path. Please try again.');
        setIsLoading(false);
      }
    } else {
      // Cleanup when modal closes
      setShowSearch(false);
      setSearchQuery('');
      setShowPageInput(false);
    }
  }, [visible, pdfUrl, initialPage]);

  const handleLoadComplete = useCallback((numberOfPages: number) => {
    setTotalPages(numberOfPages);
    setIsLoading(false);
    console.log(`[PDFViewer] Loaded ${numberOfPages} pages`);
  }, []);

  const handlePageChanged = useCallback((page: number, numberOfPages: number) => {
    setCurrentPage(page);
    setPageInputValue(String(page));
    console.log(`[PDFViewer] Page changed to ${page}/${numberOfPages}`);
  }, []);

  const handleError = useCallback((error: any) => {
    console.error('[PDFViewer] Load error:', error);

    // Provide more specific error messages
    let errorMessage = 'Failed to load PDF. Please try again.';

    if (error?.message?.includes('not found') || error?.message?.includes('404')) {
      errorMessage = 'PDF file not found. It may have been deleted.';
    } else if (error?.message?.includes('network') || error?.message?.includes('timeout')) {
      errorMessage = 'Network error. Please check your connection and try again.';
    } else if (error?.message?.includes('corrupted') || error?.message?.includes('invalid')) {
      errorMessage = 'This PDF file appears to be corrupted or invalid.';
    } else if (error?.message?.includes('permission')) {
      errorMessage = 'Permission denied. Unable to access the PDF file.';
    }

    setError(errorMessage);
    setIsLoading(false);
  }, []);

  const goToNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, totalPages]);

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const goToPage = useCallback(
    (page: number) => {
      const targetPage = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(targetPage);
      setPageInputValue(String(targetPage));
      setShowPageInput(false);
    },
    [totalPages]
  );

  const handlePageInputSubmit = useCallback(() => {
    const pageNum = parseInt(pageInputValue, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      goToPage(pageNum);
    } else {
      // Reset to current page if invalid
      setPageInputValue(String(currentPage));
      setShowPageInput(false);
    }
  }, [pageInputValue, currentPage, totalPages, goToPage]);

  const isCitedPage = citedPages.includes(currentPage);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.backgroundMain }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.backgroundSecondary }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={28} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Typography
              variant="subheadline"
              weight="semibold"
              numberOfLines={1}
              style={styles.title}
            >
              {reportTitle || 'Inspection Report'}
            </Typography>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => setShowSearch(!showSearch)}
              style={styles.searchButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="search" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            {isCitedPage && (
              <View style={[styles.citedBadge, { backgroundColor: colors.primary }]}>
                <Typography variant="caption2" style={{ color: colors.white }}>
                  CITED
                </Typography>
              </View>
            )}
          </View>
        </View>

        {/* Search Bar */}
        {showSearch && (
          <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={[styles.searchInputContainer, { borderColor: colors.borderColor }]}>
              <Icon name="search" size={20} color={colors.textSecondary} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search in document..."
                placeholderTextColor={colors.textSecondary}
                style={[styles.searchInput, { color: colors.textPrimary }]}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <Typography variant="caption1" color="secondary" style={styles.searchNote}>
              Note: Use browser/system PDF search (Cmd+F / Ctrl+F) for full-text search
            </Typography>
          </View>
        )}

        {/* PDF Viewer */}
        <View style={styles.pdfContainer}>
          {!Pdf ? (
            <View style={styles.errorContainer}>
              <Icon
                name="alert-circle-outline"
                size={48}
                color={colors.error}
              />
              <Typography
                variant="body"
                color="error"
                style={{ marginTop: 16, textAlign: 'center', paddingHorizontal: 32 }}
              >
                PDF viewer is not available. Please reinstall the app.
              </Typography>
              <TouchableOpacity
                onPress={onClose}
                style={[
                  styles.retryButton,
                  { backgroundColor: colors.primary + '20' },
                ]}
              >
                <Typography variant="subheadline" color="primary">
                  Close
                </Typography>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {isLoading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Typography
                    variant="body"
                    color="textSecondary"
                    style={{ marginTop: 16 }}
                  >
                    Loading PDF...
                  </Typography>
                </View>
              )}

              {error && (
                <View style={styles.errorContainer}>
                  <Icon
                    name="alert-circle-outline"
                    size={48}
                    color={colors.error}
                  />
                  <Typography
                    variant="body"
                    color="error"
                    style={{ marginTop: 16, textAlign: 'center', paddingHorizontal: 32 }}
                  >
                    {error}
                  </Typography>
                  <TouchableOpacity
                    onPress={onClose}
                    style={[
                      styles.retryButton,
                      { backgroundColor: colors.primary + '20' },
                    ]}
                  >
                    <Typography variant="subheadline" color="primary">
                      Close
                    </Typography>
                  </TouchableOpacity>
                </View>
              )}

              {!error && pdfUrl && (
                <Pdf
                  ref={pdfRef}
                  source={{ uri: pdfUrl, cache: true }}
                  page={currentPage}
                  onLoadComplete={handleLoadComplete}
                  onPageChanged={handlePageChanged}
                  onError={handleError}
                  style={[styles.pdf, { width: windowWidth, height: windowHeight }]}
                  trustAllCerts={false}
                  enablePaging
                  horizontal={false}
                  spacing={0}
                  fitPolicy={0}
                  enableAntialiasing
                />
              )}
            </>
          )}
        </View>

        {/* Navigation Controls */}
        {!isLoading && !error && totalPages > 0 && (
          <View style={[styles.controls, { backgroundColor: colors.backgroundSecondary }]}>
            <TouchableOpacity
              onPress={goToPrevPage}
              disabled={currentPage === 1}
              style={styles.navButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon
                name="chevron-back"
                size={24}
                color={currentPage === 1 ? colors.textTertiary : colors.primary}
              />
            </TouchableOpacity>

            <View style={styles.pageIndicator}>
              {showPageInput ? (
                <View style={styles.pageInputContainer}>
                  <TextInput
                    value={pageInputValue}
                    // Raw RN TextInput, so the shared field's letter filter does
                    // not apply: a paste or a hardware keyboard would otherwise
                    // put letters into a page number that `parseInt`s to NaN.
                    onChangeText={numericTextHandler(setPageInputValue)}
                    onSubmitEditing={handlePageInputSubmit}
                    onBlur={handlePageInputSubmit}
                    keyboardType="number-pad"
                    autoFocus
                    selectTextOnFocus
                    style={[
                      styles.pageInput,
                      {
                        color: colors.textPrimary,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    maxLength={String(totalPages).length}
                  />
                  <Typography variant="body" color="textSecondary">
                    / {totalPages}
                  </Typography>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowPageInput(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
                >
                  <Typography variant="body" weight="medium">
                    Page {currentPage} of {totalPages}
                  </Typography>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              onPress={goToNextPage}
              disabled={currentPage === totalPages}
              style={styles.navButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon
                name="chevron-forward"
                size={24}
                color={
                  currentPage === totalPages
                    ? colors.textTertiary
                    : colors.primary
                }
              />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 16,
  },
  title: {
    textAlign: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 60,
  },
  searchButton: {
    padding: 4,
  },
  citedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  searchNote: {
    marginTop: 8,
    fontStyle: 'italic',
  },
  pdfContainer: {
    flex: 1,
    backgroundColor: '#525659',
  },
  pdf: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  navButton: {
    padding: 8,
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
    justifyContent: 'center',
  },
  pageInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 16,
    fontWeight: '500',
    minWidth: 50,
    textAlign: 'center',
  },
});
