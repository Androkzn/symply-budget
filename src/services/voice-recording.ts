import {
  AudioModule,
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';

import { apiClient } from '../api/client';

export interface VoiceRecordingResult {
  voice_note_key: string;
  duration_seconds: number;
  file_size: number;
  transcription?: string;
}

export interface VoiceRecordingOptions {
  maxDuration?: number; // milliseconds
}

export class VoiceRecordingService {
  private static recording: AudioRecorder | null = null;
  private static player: AudioPlayer | null = null;

  static async requestPermission(): Promise<boolean> {
    try {
      const { status } = await requestRecordingPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Permission Required',
          'Please grant microphone access to record voice notes.',
          [{ text: 'OK' }]
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to request audio permission:', error);
      return false;
    }
  }

  static async startRecording(options: VoiceRecordingOptions = {}): Promise<boolean> {
    try {
      const hasPermission = await this.requestPermission();
      if (!hasPermission) return false;

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });

      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await recorder.prepareToRecordAsync();
      if (options.maxDuration && options.maxDuration > 0) {
        recorder.record({ forDuration: options.maxDuration / 1000 });
      } else {
        recorder.record();
      }
      this.recording = recorder;
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Recording Failed', 'Failed to start voice recording. Please try again.');
      return false;
    }
  }

  static async stopRecording(): Promise<{ uri: string; duration: number } | null> {
    try {
      if (!this.recording) {
        console.warn('No recording in progress');
        return null;
      }

      const duration = this.recording.currentTime;
      await this.recording.stop();
      await setAudioModeAsync({ allowsRecording: false });

      const uri = this.recording.uri;
      this.recording = null;

      if (!uri) {
        console.error('No recording URI');
        return null;
      }

      return { uri, duration };
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to save voice recording.');
      return null;
    }
  }

  static async cancelRecording(): Promise<void> {
    try {
      if (this.recording) {
        await this.recording.stop();
        this.recording = null;
        await setAudioModeAsync({ allowsRecording: false });
      }
    } catch (error) {
      console.error('Failed to cancel recording:', error);
    }
  }

  static async playVoiceNote(uri: string): Promise<void> {
    try {
      if (this.player) {
        this.player.remove();
        this.player = null;
      }

      const player = createAudioPlayer({ uri });
      this.player = player;
      player.play();
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          this.player?.remove();
          this.player = null;
        }
      });
    } catch (error) {
      console.error('Failed to play voice note:', error);
      Alert.alert('Playback Failed', 'Failed to play voice note.');
    }
  }

  static async stopPlayback(): Promise<void> {
    try {
      if (this.player) {
        this.player.pause();
        this.player.remove();
        this.player = null;
      }
    } catch (error) {
      console.error('Failed to stop playback:', error);
    }
  }

  static async uploadVoiceRecording(
    householdId: string,
    uri: string,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<VoiceRecordingResult> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      const fileSize = 'size' in fileInfo ? fileInfo.size : 0;

      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: `voice_${Date.now()}.m4a`,
      } as unknown as Blob);
      formData.append('duration_seconds', duration.toString());

      const response = await apiClient.post<{
        voice_note_key: string;
        transcription?: string;
      }>(`/households/${householdId}/voice-notes/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            onProgress(progressEvent.loaded / progressEvent.total);
          }
        },
      });

      return {
        voice_note_key: response.data.voice_note_key,
        duration_seconds: duration,
        file_size: fileSize || 0,
        transcription: response.data.transcription,
      };
    } catch (error) {
      console.error('Failed to upload voice recording:', error);
      throw error;
    }
  }

  static async recordChecklistItemVoiceNote(
    _householdId: string,
    _checklistId: string,
    _itemId: string,
    onRecordingStart?: () => void,
    _onRecordingStop?: () => void
  ): Promise<VoiceRecordingResult | null> {
    try {
      const started = await this.startRecording({ maxDuration: 300000 });
      if (!started) return null;
      onRecordingStart?.();
      return null;
    } catch (error) {
      console.error('Failed to record voice note:', error);
      Alert.alert('Recording Failed', 'Failed to record voice note. Please try again.');
      return null;
    }
  }

  static isRecording(): boolean {
    return this.recording !== null;
  }

  static async getRecordingDuration(): Promise<number> {
    if (!this.recording) return 0;
    try {
      return this.recording.isRecording ? this.recording.currentTime : 0;
    } catch (error) {
      console.error('Failed to get recording duration:', error);
      return 0;
    }
  }
}
