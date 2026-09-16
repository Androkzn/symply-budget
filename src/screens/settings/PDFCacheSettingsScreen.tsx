import { useNavigation } from "expo-router/react-navigation";
import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Alert } from 'react-native';

import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Button, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { pdfCache, CachedPDFInfo } from '@services/pdfCache';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';

export function PDFCacheSettingsScreen() {  const colors = useAppColors();
  const navigation = useNavigation();

  const [cacheSize, setCacheSize] = useState('0 KB');
  const [cachedFiles, setCachedFiles] = useState<CachedPDFInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  const loadCacheInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      const [size, files] = await Promise.all([
        pdfCache.getCacheSizeFormatted(),
        pdfCache.getCachedFiles(),
      ]);
      setCacheSize(size);
      setCachedFiles(files);
    } catch (error) {
      console.error('[PDFCacheSettings] Error loading cache info:', error);
      showToast('error', 'Failed to load cache information');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCacheInfo();
  }, [loadCacheInfo]);

  const handleClearCache = useCallback(async () => {
    Alert.alert(
      'Clear PDF Cache',
      'This will delete all cached PDF files. You can re-download them when needed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsClearing(true);
              await pdfCache.clearCache();
              showToast('success', 'Cache cleared successfully');
              await loadCacheInfo();
            } catch (error) {
              console.error('[PDFCacheSettings] Error clearing cache:', error);
              showToast('error', 'Failed to clear cache');
            } finally {
              setIsClearing(false);
            }
          },
        },
      ]
    );
  }, [loadCacheInfo]);

  const handleClearOldCache = useCallback(async () => {
    try {
      setIsClearing(true);
      const clearedCount = await pdfCache.clearOldCache(30);
      if (clearedCount > 0) {
        showToast('success', `Cleared ${clearedCount} old file(s)`);
        await loadCacheInfo();
      } else {
        showToast('info', 'No old files to clear');
      }
    } catch (error) {
      console.error('[PDFCacheSettings] Error clearing old cache:', error);
      showToast('error', 'Failed to clear old cache');
    } finally {
      setIsClearing(false);
    }
  }, [loadCacheInfo]);

  const handleDeleteFile = useCallback(
    async (reportId: string) => {
      try {
        await pdfCache.clearCache(reportId);
        showToast('success', 'File removed from cache');
        await loadCacheInfo();
      } catch (error) {
        console.error('[PDFCacheSettings] Error deleting file:', error);
        showToast('error', 'Failed to delete file');
      }
    },
    [loadCacheInfo]
  );

  const formatDate = (dateStr: Date) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <AppBackground>
      <View style={styles.container}>
        {/* Header */}
        <ScreenHeader
        title="PDF Cache"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

        <ScrollView style={[screenScrollViewStyle.scroll, styles.scrollView]} contentContainerStyle={styles.content}>
          {/* Cache Summary Card */}
          <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Icon name="document" size={32} color={colors.primary} />
                <Typography
                  variant="title3"
                  weight="semibold"
                  style={{ marginTop: 8 }}
                >
                  {cachedFiles.length}
                </Typography>
                <Typography variant="caption1" color="secondary">
                  Cached Files
                </Typography>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Icon name="server" size={32} color={colors.primary} />
                <Typography
                  variant="title3"
                  weight="semibold"
                  style={{ marginTop: 8 }}
                >
                  {cacheSize}
                </Typography>
                <Typography variant="caption1" color="secondary">
                  Total Size
                </Typography>
              </View>
            </View>
          </Card>

          {/* Info Card */}
          <Card style={[styles.card, { backgroundColor: colors.primary + '10' }]}>
            <View style={styles.infoRow}>
              <Icon name="information-circle" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Typography variant="body" style={{ marginBottom: 4 }}>
                  PDFs are cached locally for faster loading and offline access
                </Typography>
                <Typography variant="caption1" color="secondary">
                  • Files older than 30 days are automatically removed
                </Typography>
                <Typography variant="caption1" color="secondary">
                  • Maximum cache size: 500 MB
                </Typography>
              </View>
            </View>
          </Card>

          {/* Action Buttons */}
          <View style={styles.buttonGroup}>
            <Button
              title="Clear Old Files (30+ days)"
              onPress={handleClearOldCache}
              disabled={isClearing || cachedFiles.length === 0}
              variant="outline"
              style={styles.button}
              fullWidth
            />
            <Button
              title="Clear All Cache"
              onPress={handleClearCache}
              disabled={isClearing || cachedFiles.length === 0}
              variant="outline"
              style={[styles.button, styles.dangerButton, { borderColor: colors.error }]}
              fullWidth
            />
          </View>

          {/* Cached Files List */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color="secondary" style={{ marginTop: 12 }}>
                Loading cache information...
              </Typography>
            </View>
          ) : cachedFiles.length > 0 ? (
            <>
              <Typography
                variant="headline"
                weight="semibold"
                style={styles.sectionTitle}
              >
                Cached Files
              </Typography>
              {cachedFiles.map((file) => (
                <Card
                  key={file.reportId}
                  style={[styles.fileCard, { backgroundColor: colors.backgroundSecondary }]}
                >
                  <View style={styles.fileInfo}>
                    <Icon
                      name="document-text"
                      size={24}
                      color={colors.primary}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Typography variant="subheadline" weight="medium" numberOfLines={1}>
                        Report {file.reportId.slice(0, 8)}
                      </Typography>
                      <Typography variant="caption1" color="secondary">
                        {formatFileSize(file.fileSize)} • Cached {formatDate(file.cachedAt)}
                      </Typography>
                      <Typography variant="caption2" color="secondary">
                        Last accessed {formatDate(file.lastAccessed)}
                      </Typography>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteFile(file.reportId)}
                      style={styles.deleteButton}
                    >
                      <Icon name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </Card>
              ))}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Icon name="folder-open-outline" size={64} color={colors.textTertiary} />
              <Typography
                variant="headline"
                color="secondary"
                style={{ marginTop: 16, textAlign: 'center' }}
              >
                No cached files
              </Typography>
              <Typography
                variant="body"
                color="secondary"
                style={{ marginTop: 8, textAlign: 'center' }}
              >
                PDFs will be cached automatically when you view them
              </Typography>
            </View>
          )}
        </ScrollView>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryDivider: {
    width: 1,
    height: 60,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonGroup: {
    gap: 12,
    marginBottom: 24,
  },
  button: {
    width: '100%',
  },
  dangerButton: {},
  sectionTitle: {
    marginBottom: 12,
  },
  fileCard: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
});
