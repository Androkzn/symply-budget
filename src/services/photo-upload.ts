import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { apiClient } from '../api/client';

export interface PhotoUploadResult {
  photo_key: string;
  thumbnail_key?: string;
  width: number;
  height: number;
  file_size: number;
  mime_type: string;
}

export interface PhotoPickerOptions {
  allowsEditing?: boolean;
  quality?: number;
  aspect?: [number, number];
}

export class PhotoUploadService {
  /**
   * Request camera permission
   */
  static async requestCameraPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please grant camera access to take photos.',
        [{ text: 'OK' }]
      );
      return false;
    }

    return true;
  }

  /**
   * Request media library permission
   */
  static async requestMediaLibraryPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert(
        'Photo Library Permission Required',
        'Please grant photo library access to select photos.',
        [{ text: 'OK' }]
      );
      return false;
    }

    return true;
  }

  /**
   * Pick photo from library
   */
  static async pickFromLibrary(options: PhotoPickerOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> {
    const hasPermission = await this.requestMediaLibraryPermission();
    if (!hasPermission) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: options.allowsEditing ?? true,
      quality: options.quality ?? 0.8,
      aspect: options.aspect,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    return result.assets[0];
  }

  /**
   * Take photo with camera
   */
  static async takePhoto(options: PhotoPickerOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> {
    const hasPermission = await this.requestCameraPermission();
    if (!hasPermission) return null;

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: options.allowsEditing ?? true,
      quality: options.quality ?? 0.8,
      aspect: options.aspect,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    return result.assets[0];
  }

  /**
   * Show action sheet to choose between camera and library
   */
  static async pickPhoto(options: PhotoPickerOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> {
    return new Promise((resolve) => {
      Alert.alert(
        'Select Photo',
        'Choose a photo from your library or take a new one',
        [
          {
            text: 'Take Photo',
            onPress: async () => {
              const photo = await this.takePhoto(options);
              resolve(photo);
            },
          },
          {
            text: 'Choose from Library',
            onPress: async () => {
              const photo = await this.pickFromLibrary(options);
              resolve(photo);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(null),
          },
        ]
      );
    });
  }

  /**
   * Upload photo to backend
   */
  static async uploadPhoto(
    householdId: string,
    photo: ImagePicker.ImagePickerAsset,
    onProgress?: (progress: number) => void
  ): Promise<PhotoUploadResult> {
    // Get file info
    const fileInfo = await FileSystem.getInfoAsync(photo.uri);
    const fileSize = 'size' in fileInfo ? fileInfo.size : 0;

    // Prepare form data
    const formData = new FormData();
    formData.append('image', {
      uri: photo.uri,
      type: photo.mimeType || 'image/jpeg',
      name: `photo_${Date.now()}.jpg`,
    } as any);

    // Upload to backend
    const response = await apiClient.post<{ photo_key: string; thumbnail_key?: string }>(
      `/households/${householdId}/images/upload`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = progressEvent.loaded / progressEvent.total;
            onProgress(progress);
          }
        },
      }
    );

    return {
      photo_key: response.data.photo_key,
      thumbnail_key: response.data.thumbnail_key,
      width: photo.width,
      height: photo.height,
      file_size: fileSize || 0,
      mime_type: photo.mimeType || 'image/jpeg',
    };
  }

  /**
   * Upload photo for checklist item
   */
  static async uploadChecklistItemPhoto(
    householdId: string,
    _checklistId: string,
    _itemId: string,
    _caption?: string,
    options?: PhotoPickerOptions
  ): Promise<PhotoUploadResult | null> {
    try {
      // Pick photo
      const photo = await this.pickPhoto(options);
      if (!photo) return null;

      // Upload photo
      const uploadResult = await this.uploadPhoto(householdId, photo);

      return {
        ...uploadResult,
      };
    } catch (error) {
      console.error('Failed to upload checklist item photo:', error);
      Alert.alert('Upload Failed', 'Failed to upload photo. Please try again.');
      return null;
    }
  }
}
