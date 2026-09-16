import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, RouteProp } from "expo-router/react-navigation";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, TextInput, Alert, Platform, Image, Modal, Pressable } from 'react-native';

import { contractorsApi, type VisitStatus, VISIT_STATUSES, type DocumentType, type ContractorDocument } from '@api/contractors';
import { AppBackground, SafeAreaView, ScreenHeader, SheetHeader, screenScrollViewStyle } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { DocumentViewerModal } from '@components/contractors/DocumentViewerModal';
import { Typography, GradientButton, StarPicker } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors, scaledFont, type AppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';

interface AttachedDocument {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

type RouteParams = {
  AddVisit: {
    contractorId: string;
    visitId?: string;
    visit?: {
      id: string;
      visit_date: string;
      description: string | null;
      cost: number | null;
      status: VisitStatus;
      notes: string | null;
      rating: number | null;
    };
  };
};

const getStatusInfo = (
  colors: AppColors
): Record<VisitStatus, { label: string; color: string; icon: IoniconName }> => ({
  scheduled: { label: 'Scheduled', color: colors.accent, icon: 'calendar' },
  completed: { label: 'Completed', color: colors.success, icon: 'checkmark-circle' },
  cancelled: { label: 'Cancelled', color: colors.error, icon: 'close-circle' },
});

export function AddVisitScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const STATUS_INFO = getStatusInfo(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'AddVisit'>>();
  const { currentHousehold } = useHouseholdStore();

  const contractorId = route.params?.contractorId;
  const existingVisit = route.params?.visit;
  const isEditing = !!existingVisit;

  const [visitDate, setVisitDate] = useState(
    existingVisit?.visit_date ? new Date(existingVisit.visit_date) : new Date()
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [description, setDescription] = useState(existingVisit?.description || '');
  const [costInput, setCostInput] = useState(
    existingVisit?.cost ? (existingVisit.cost / 100).toFixed(2) : ''
  );
  const [status, setStatus] = useState<VisitStatus>(existingVisit?.status || 'scheduled');
  const [notes, setNotes] = useState(existingVisit?.notes || '');
  const [rating, setRating] = useState<number | null>(existingVisit?.rating || null);
  const [attachedDocuments, setAttachedDocuments] = useState<AttachedDocument[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [existingDocuments, setExistingDocuments] = useState<ContractorDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ContractorDocument | null>(null);
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);

  // Load existing documents when editing
  const loadExistingDocuments = useCallback(async () => {
    if (!currentHousehold?.id || !contractorId || !existingVisit?.id) return;
    
    setIsLoadingDocuments(true);
    try {
      const response = await contractorsApi.getContractorDocuments(currentHousehold.id, contractorId);
      // Filter to only show documents associated with this visit
      const visitDocuments = response.documents.filter(doc => doc.visit_id === existingVisit.id);
      setExistingDocuments(visitDocuments);
    } catch (err) {
      console.error('Error loading documents:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [currentHousehold?.id, contractorId, existingVisit?.id]);

  useEffect(() => {
    if (isEditing) {
      loadExistingDocuments();
    }
  }, [isEditing, loadExistingDocuments]);

  // Delete existing document
  const handleDeleteExistingDocument = async (documentId: string) => {
    if (!currentHousehold?.id) return;

    Alert.alert(
      'Delete Document',
      'Are you sure you want to delete this document?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingDocumentId(documentId);
            try {
              await contractorsApi.deleteDocument(currentHousehold.id, documentId);
              setExistingDocuments(prev => prev.filter(doc => doc.id !== documentId));
            } catch (err) {
              console.error('Error deleting document:', err);
              Alert.alert('Error', 'Failed to delete document');
            } finally {
              setDeletingDocumentId(null);
            }
          },
        },
      ]
    );
  };

  /**
   * Where an invoice comes from — the shared four, not the hand-rolled three.
   *
   * Take Photo, Gallery and Document were three separate pickers here with
   * three different failure messages, and a contractor's invoice sitting in the
   * household's Drive folder had no route in at all. `useAttachmentSources`
   * owns all four; what lands in `attachedDocuments` is unchanged.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: 'contractor-invoice',
    mimeTypes: ['*/*'],
    pickerOptions: { cropping: false, compressImageQuality: 0.8 },
    onPicked: ([picked]) => {
      if (!picked) return;
      setAttachedDocuments((prev) => [
        ...prev,
        {
          uri: picked.uri,
          name: picked.name || `invoice-${Date.now()}.jpg`,
          type: picked.mime || 'image/jpeg',
          size: picked.size,
        },
      ]);
    },
  });

  const handleRemoveDocument = (index: number) => {
    setAttachedDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const showDocumentPicker = () => {
    Alert.alert('Attach Invoice', 'Choose how to add your invoice', [
      { text: 'Take Photo', onPress: sourceHandlers.onCamera },
      { text: 'Choose from Gallery', onPress: sourceHandlers.onGallery },
      { text: 'Pick PDF/Document', onPress: sourceHandlers.onFile },
      { text: 'Google Drive', onPress: sourceHandlers.onDrive },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Upload document to R2 and create record
  const uploadDocumentAndCreateRecord = async (
    householdId: string,
    contractorId: string,
    visitId: string,
    doc: AttachedDocument
  ) => {
    // Upload file directly to backend
    const uploadResult = await contractorsApi.uploadDocument(householdId, {
      uri: doc.uri,
      name: doc.name,
      type: doc.type,
    });

    // Determine document type based on mime type
    let docType: DocumentType = 'other';
    if (doc.type === 'application/pdf' || 
        doc.type.includes('word') || 
        doc.type.includes('document')) {
      docType = 'invoice';
    } else if (doc.type.startsWith('image/')) {
      docType = 'receipt';
    }

    // Create document record
    await contractorsApi.createDocument(householdId, {
      contractor_id: contractorId,
      visit_id: visitId,
      type: docType,
      title: doc.name,
      file_key: uploadResult.fileKey,
      file_name: uploadResult.fileName,
      file_size: uploadResult.fileSize,
      mime_type: uploadResult.mimeType,
      document_date: visitDate.toISOString().split('T')[0],
    });
  };

  // Snapshot of the loaded visit (or an empty draft when creating) to diff the
  // live form against. Memoized so the baseline Date stays stable across renders
  // and the form isn't flagged dirty on mount. See [[useUnsavedChanges]].
  const initialValues = useMemo(
    () => ({
      visitDate: existingVisit?.visit_date ? new Date(existingVisit.visit_date) : visitDate,
      description: existingVisit?.description || '',
      costInput: existingVisit?.cost ? (existingVisit.cost / 100).toFixed(2) : '',
      status: (existingVisit?.status || 'scheduled') as VisitStatus,
      notes: existingVisit?.notes || '',
      rating: existingVisit?.rating || null,
      attachedDocuments: [] as AttachedDocument[],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingVisit]
  );

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: { visitDate, description, costInput, status, notes, rating, attachedDocuments },
    baseline: initialValues,
    successMessage: isEditing ? 'Changes saved' : 'Visit scheduled',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold?.id || !contractorId) return false;

      const costInCents = costInput ? Math.round(parseFloat(costInput) * 100) : undefined;

      const data = {
        visit_date: visitDate.toISOString().split('T')[0],
        description: description.trim() || undefined,
        cost: costInCents,
        status,
        notes: notes.trim() || undefined,
        rating: rating || undefined,
      };

      let visitId: string;

      if (isEditing && existingVisit) {
        await contractorsApi.updateVisit(currentHousehold.id, existingVisit.id, data);
        visitId = existingVisit.id;
      } else {
        const result = await contractorsApi.createVisit(currentHousehold.id, contractorId, data);
        visitId = result.visit.id;
      }

      // Upload any attached documents
      if (attachedDocuments.length > 0) {
        setIsUploading(true);
        try {
          for (const doc of attachedDocuments) {
            try {
              await uploadDocumentAndCreateRecord(currentHousehold.id, contractorId, visitId, doc);
            } catch (uploadErr) {
              console.error('Error uploading document:', uploadErr);
              // Continue with other uploads even if one fails
            }
          }
        } finally {
          setIsUploading(false);
        }
      }
      return;
    },
  });

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    // On Android, close picker after selection
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setVisitDate(selectedDate);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.backgroundSecondary,
      color: colors.textPrimary,
      borderColor: colors.borderColor,
    },
  ];

  return (
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title={isEditing ? 'Edit Visit' : 'Add Visit'}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
      >
        {/* Date */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Visit Date *
          </Typography>
          <TouchableOpacity
            style={[inputStyle, styles.dateButton]}
            onPress={() => setShowDatePicker(true)}
          >
            <Typography variant="body">
              {visitDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Typography>
            <Icon name="calendar" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {/* Date Picker Bottom Sheet Modal */}
          <Modal
            visible={showDatePicker}
            transparent
            animationType="slide"
            onRequestClose={() => setShowDatePicker(false)}
          >
            <Pressable 
              style={styles.modalOverlay} 
              onPress={() => setShowDatePicker(false)}
            >
              <Pressable 
                style={[styles.datePickerSheet, { backgroundColor: colors.backgroundSecondary }]}
                onPress={(e) => e.stopPropagation()}
              >
                {/* The app's one sheet header — glass ✕ on the left, centred
                    title, hairline rule under it. No trailing "Done": the
                    spinner commits on change, so that button was only a second
                    way to dismiss, which is exactly what the ✕ already is. */}
                <SheetHeader
                  title="Select Date"
                  leftVariant="close"
                  onLeftPress={() => setShowDatePicker(false)}
                  leftTestID="visit-date-picker-close"
                  leftAccessibilityLabel="Close"
                  showDivider
                />
                
                {/* Date Picker */}
                <DateTimePicker
                  value={visitDate}
                  mode="date"
                  display="spinner"
                  onChange={handleDateChange}
                  style={{ height: 200 }}
                  textColor={colors.textPrimary}
                />
              </Pressable>
            </Pressable>
          </Modal>
        </View>

        {/* Status */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Status *
          </Typography>
          <View style={styles.statusOptions}>
            {VISIT_STATUSES.map((s) => {
              const info = STATUS_INFO[s];
              const isSelected = status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusOption,
                    {
                      backgroundColor: isSelected ? info.color + '20' : colors.backgroundSecondary,
                      borderColor: isSelected ? info.color : colors.borderColor,
                    },
                  ]}
                  onPress={() => setStatus(s)}
                >
                  <Icon
                    name={info.icon}
                    size={16}
                    color={isSelected ? info.color : colors.textPrimary}
                  />
                  <Typography
                    variant="subheadline"
                    weight={isSelected ? 'semibold' : 'regular'}
                    style={{ color: isSelected ? info.color : colors.textPrimary, marginLeft: 6 }}
                  >
                    {info.label}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Work Description
          </Typography>
          <TextInput
            style={[inputStyle, styles.multilineInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="What work was done or will be done?"
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Cost */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Cost
          </Typography>
          <View style={[inputStyle, styles.costInputContainer]}>
            <Typography variant="body" color={colors.textSecondary}>
              $
            </Typography>
            <TextInput
              style={[styles.costInput, { color: colors.textPrimary }]}
              value={costInput}
              onChangeText={numericTextHandler(setCostInput)}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Notes
          </Typography>
          <TextInput
            style={[inputStyle, styles.multilineInput, { minHeight: 80 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Additional notes..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Rating (for completed visits) */}
        {status === 'completed' && (
          <View style={styles.field}>
            <Typography variant="subheadline" weight="semibold" style={styles.label}>
              Rating
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} style={{ marginBottom: 8 }}>
              How was this visit?
            </Typography>
            <StarPicker rating={rating} onChange={setRating} />
          </View>
        )}

        {/* Invoice/Document Attachment */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Invoice / Receipt
          </Typography>

          {/* Loading indicator for existing documents */}
          {isLoadingDocuments && (
            <View style={styles.loadingDocsContainer}>
              <ActivityIndicator size="small" color={theme.pastel.teal} />
              <Typography variant="caption1" color={colors.textSecondary} style={{ marginLeft: 8 }}>
                Loading documents...
              </Typography>
            </View>
          )}

          {/* Existing documents from backend */}
          {existingDocuments.length > 0 && (
            <View style={styles.attachedDocsList}>
              <Typography variant="caption1" color={colors.textSecondary} style={{ marginBottom: 8 }}>
                Attached to this visit
              </Typography>
              {existingDocuments.map((doc) => (
                <TouchableOpacity
                  key={doc.id}
                  style={[
                    styles.attachedDocItem,
                    { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
                  ]}
                  onPress={() => {
                    setSelectedDocument(doc);
                    setShowDocumentViewer(true);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.docThumbnail, styles.pdfThumbnail, { backgroundColor: colors.backgroundSecondary }]}>
                    <Icon
                      name={
                        doc.type === 'receipt'
                          ? 'receipt-outline'
                          : doc.type === 'invoice'
                          ? 'document-text'
                          : doc.type === 'photo'
                          ? 'image'
                          : 'attach'
                      }
                      size={24}
                      color={colors.textSecondary}
                    />
                  </View>
                  <View style={styles.docInfo}>
                    <Typography variant="subheadline" numberOfLines={1}>
                      {doc.title}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                      {doc.file_size ? ` • ${(doc.file_size / 1024).toFixed(0)} KB` : ''}
                    </Typography>
                  </View>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDeleteExistingDocument(doc.id);
                    }}
                    style={styles.removeDocButton}
                    disabled={deletingDocumentId === doc.id}
                  >
                    {deletingDocumentId === doc.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Icon name="close" size={18} color={colors.error} />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Newly attached documents (pending upload) */}
          {attachedDocuments.length > 0 && (
            <View style={styles.attachedDocsList}>
              {existingDocuments.length > 0 && (
                <Typography variant="caption1" color={colors.textSecondary} style={{ marginBottom: 8 }}>
                  New documents to upload
                </Typography>
              )}
              {attachedDocuments.map((doc, index) => (
                <View
                  key={index}
                  style={[
                    styles.attachedDocItem,
                    { backgroundColor: colors.backgroundSecondary, borderColor: theme.pastel.green },
                  ]}
                >
                  {doc.type.startsWith('image/') ? (
                    <Image source={{ uri: doc.uri }} style={styles.docThumbnail} />
                  ) : (
                    <View style={[styles.docThumbnail, styles.pdfThumbnail, { backgroundColor: colors.backgroundSecondary }]}>
                      <Icon name="document-text" size={24} color={colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.docInfo}>
                    <Typography variant="subheadline" numberOfLines={1}>
                      {doc.name}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {doc.type.includes('pdf') ? 'PDF' : 'Image'}
                      {doc.size ? ` • ${(doc.size / 1024).toFixed(0)} KB` : ''}
                    </Typography>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveDocument(index)}
                    style={styles.removeDocButton}
                  >
                    <Icon name="close" size={18} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Upload Invoice Button - Prominent */}
          <TouchableOpacity
            style={[
              styles.uploadInvoiceButton,
              { 
                backgroundColor: theme.pastel.orange + '15',
                borderColor: theme.pastel.orange,
              },
            ]}
            onPress={showDocumentPicker}
          >
            <View style={styles.uploadInvoiceContent}>
              <Icon name="receipt-outline" size={34} color={theme.pastel.orange} />
              <View style={styles.uploadInvoiceText}>
                <Typography variant="headline" weight="semibold" color={theme.pastel.orange}>
                  {(attachedDocuments.length > 0 || existingDocuments.length > 0) ? 'Add Another Document' : 'Upload Invoice'}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Take photo, choose from gallery, or pick PDF
                </Typography>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Save Button */}
        <GradientButton
          title={
            isSaving
              ? isUploading
                ? 'Uploading documents...'
                : 'Saving...'
              : isEditing
                ? 'Save Changes'
                : 'Add Visit'
          }
          variant="blue"
          onPress={save}
          disabled={isSaving || !isDirty}
          style={styles.saveButton}
          fullWidth
        />
        {isSaving && (
          <ActivityIndicator style={{ marginTop: 12 }} color={theme.pastel.teal} />
        )}
      </ScrollView>

      {/* Document Viewer Modal */}
      <DocumentViewerModal
        visible={showDocumentViewer}
        document={selectedDocument}
        onClose={() => {
          setShowDocumentViewer(false);
          setSelectedDocument(null);
        }}
      />
    </SafeAreaView>
    {drivePicker}
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: 120,
  },
  header: {
    marginBottom: Spacing.xl,
  },
  field: {
    marginBottom: Spacing.lg,
  },
  label: {
    marginBottom: Spacing.sm,
  },
  input: {
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md + Spacing.xxs,
    ...scaledFont('body'),
    borderWidth: 1,
  },
  multilineInput: {
    textAlignVertical: 'top',
    paddingTop: Spacing.md + Spacing.xxs,
  },
  dateButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statusOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  costInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  costInput: {
    flex: 1,
    ...scaledFont('body'),
    marginLeft: Spacing.xs,
    padding: 0,
  },
  starPicker: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  starButton: {
    padding: Spacing.xs,
  },
  saveButton: {
    marginTop: Spacing.xl,
  },
  loadingDocsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  attachedDocsList: {
    marginBottom: Spacing.md,
  },
  attachedDocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  docThumbnail: {
    width: 48,
    height: 48,
    borderRadius: CornerRadius.sm,
    marginRight: Spacing.md,
  },
  pdfThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  docInfo: {
    flex: 1,
  },
  removeDocButton: {
    padding: Spacing.sm,
  },
  addDocButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  uploadInvoiceButton: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    borderWidth: 2,
  },
  uploadInvoiceContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadInvoiceText: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  datePickerSheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    paddingBottom: 34, // Safe area
  },
});
