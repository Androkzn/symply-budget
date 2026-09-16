import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Image, Alert, useWindowDimensions } from 'react-native';

import type { ContractorDocument } from '@api/contractors';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useTheme } from '@contexts/ThemeContext';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, useAppColors } from '@theme';

interface DocumentViewerModalProps {
  visible: boolean;
  document: ContractorDocument | null;
  onClose: () => void;
}

export function DocumentViewerModal({ visible, document, onClose }: DocumentViewerModalProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { width: windowWidth } = useWindowDimensions();
  const { currentHousehold } = useHouseholdStore();
  const [isLoading, setIsLoading] = useState(true);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isImage = document?.mime_type?.startsWith('image/');
  const isPdf = document?.mime_type?.includes('pdf');

  // Helper to safely decode URI component
  const safeDecodeURI = (str: string): string => {
    try {
      return decodeURIComponent(str);
    } catch {
      return str;
    }
  };

  // Get file extension from mime type or filename
  const getExtension = (mimeType?: string | null, fileName?: string | null): string => {
    if (fileName) {
      const ext = fileName.split('.').pop();
      if (ext && ext.length <= 5) return `.${ext}`;
    }
    if (mimeType?.includes('pdf')) return '.pdf';
    if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return '.jpg';
    if (mimeType?.includes('png')) return '.png';
    if (mimeType?.includes('gif')) return '.gif';
    if (mimeType?.includes('word')) return '.docx';
    return '';
  };

  // Get cached file path for this document
  const getCachedFilePath = (): string => {
    if (!document) return '';
    const ext = getExtension(document.mime_type, document.file_name);
    return `${FileSystem.documentDirectory}contractor_docs/${document.id}${ext}`;
  };

  // Check if file exists in cache
  const checkCachedFile = async (): Promise<string | null> => {
    const filePath = getCachedFilePath();
    if (!filePath) return null;
    
    try {
      const info = await FileSystem.getInfoAsync(filePath);
      if (info.exists) {
        return filePath;
      }
    } catch (err) {
      console.log('Cache check error:', err);
    }
    return null;
  };

  // Download file to cache
  const downloadToCache = async (): Promise<string> => {
    if (!currentHousehold?.id || !document) {
      throw new Error('Missing household or document');
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('Not authenticated');
    }

    const url = `${ENV.API_BASE_URL}/households/${currentHousehold.id}/contractors/documents/${document.id}/download`;
    const filePath = getCachedFilePath();

    // Ensure directory exists
    const dirPath = `${FileSystem.documentDirectory}contractor_docs/`;
    const dirInfo = await FileSystem.getInfoAsync(dirPath);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
    }

    const downloadResult = await FileSystem.downloadAsync(url, filePath, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (downloadResult.status === 200) {
      return downloadResult.uri;
    } else {
      throw new Error(`Download failed with status ${downloadResult.status}`);
    }
  };

  // Get file - from cache or download
  const getFile = async (): Promise<string> => {
    // Check cache first
    const cachedPath = await checkCachedFile();
    if (cachedPath) {
      console.log('Using cached file:', cachedPath);
      return cachedPath;
    }

    // Download if not cached
    console.log('Downloading file...');
    return await downloadToCache();
  };

  // Load document (image or PDF) immediately when modal opens
  const loadDocument = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const filePath = await getFile();
      setFileUri(filePath);
    } catch (err: any) {
      console.error('Error loading document:', err?.message || err);
      setError(`Failed to load: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Share/export document
  const shareDocument = async () => {
    if (!fileUri) return;
    
    try {
      const isSharingAvailable = await Sharing.isAvailableAsync();
      
      if (isSharingAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: document?.mime_type || 'application/octet-stream',
          dialogTitle: safeDecodeURI(document?.title || 'Document'),
        });
      } else {
        Alert.alert('Error', 'Unable to share document on this device');
      }
    } catch (err: any) {
      console.error('Error sharing document:', err?.message || err);
      Alert.alert('Error', `Failed to share document: ${err?.message || 'Unknown error'}`);
    }
  };

  // Auto-open PDFs immediately via Quick Look
  const openPdfInQuickLook = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const filePath = await getFile();
      setFileUri(filePath);
      
      // Immediately open in Quick Look / external viewer
      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (isSharingAvailable) {
        await Sharing.shareAsync(filePath, {
          mimeType: document?.mime_type || 'application/pdf',
          UTI: 'com.adobe.pdf', // iOS specific - opens in Quick Look
        });
      }
    } catch (err: any) {
      console.error('Error opening PDF:', err?.message || err);
      setError(`Failed to open: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visible && document) {
      // Load document (download to cache) for both images and PDFs
      loadDocument();
    } else {
      setFileUri(null);
      setError(null);
    }
  }, [visible, document]);

  if (!document) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.95)' }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={IconSize.md} color={colors.white} />
            <Typography variant="body" color={colors.white}>
              Close
            </Typography>
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Typography variant="subheadline" weight="semibold" color={colors.white} numberOfLines={1}>
              {safeDecodeURI(document.title)}
            </Typography>
            <Typography variant="caption1" color="#999">
              {document.type}
            </Typography>
          </View>
          <TouchableOpacity onPress={shareDocument} style={styles.shareButton} disabled={!fileUri}>
            <Typography variant="body" color={fileUri ? theme.pastel.teal : '#666'}>
              Share
            </Typography>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.white} />
              <Typography variant="body" color="#999" style={{ marginTop: 12 }}>
                Loading document...
              </Typography>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Typography variant="body" color={colors.error}>
                {error}
              </Typography>
              <TouchableOpacity 
                onPress={loadDocument} 
                style={styles.retryButton}
              >
                <Typography variant="body" color={theme.pastel.teal}>
                  Retry
                </Typography>
              </TouchableOpacity>
            </View>
          ) : isPdf ? (
            <View style={styles.documentPreview}>
              <Icon
                name="document-text"
                size={64}
                color={colors.white}
                style={{ marginBottom: 16 }}
              />
              <Typography variant="headline" color={colors.white} style={{ marginBottom: 8, textAlign: 'center' }}>
                {safeDecodeURI(document.file_name || document.title)}
              </Typography>
              <Typography variant="body" color="#999" style={{ marginBottom: 24 }}>
                PDF Document
              </Typography>
              <TouchableOpacity
                style={[styles.openButton, { backgroundColor: theme.pastel.teal }]}
                onPress={openPdfInQuickLook}
              >
                <Typography variant="headline" weight="semibold" color={colors.white}>
                  Open PDF
                </Typography>
              </TouchableOpacity>
            </View>
          ) : isImage && fileUri ? (
            <Image
              source={{ uri: fileUri }}
              style={[styles.image, { width: windowWidth }]}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.documentPreview}>
              <Icon
                name="document-attach"
                size={64}
                color={colors.white}
                style={{ marginBottom: 16 }}
              />
              <Typography variant="headline" color={colors.white} style={{ marginBottom: 8, textAlign: 'center' }}>
                {safeDecodeURI(document.file_name || document.title)}
              </Typography>
              <Typography variant="body" color="#999" style={{ marginBottom: 24 }}>
                {document.type} • {document.mime_type}
              </Typography>
              <TouchableOpacity
                style={[styles.openButton, { backgroundColor: theme.pastel.teal }]}
                onPress={shareDocument}
              >
                <Typography variant="headline" weight="semibold" color={colors.white}>
                  Open in External App
                </Typography>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  closeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  shareButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    flex: 1,
  },
  documentPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  openButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    marginTop: 16,
    padding: 12,
  },
});
