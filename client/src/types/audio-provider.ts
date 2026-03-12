/**
 * Audio Provider types — mirrors server/src/audio-providers/types.ts AudioProviderInfoDTO.
 */

export type AudioProviderId = 'audio-browser' | 'audio-groq' | 'audio-deepgram' | 'audio-gladia' | 'audio-assemblyai';

export interface AudioModel {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

export interface AudioProviderCapabilities {
  supportsStreaming: boolean;
  supportedLanguages: string[];
  supportedFormats: string[];
  maxFileSizeMB: number;
  supportsDiarization: boolean;
  supportsTimestamps: boolean;
}

export interface AudioProviderInfo {
  id: AudioProviderId;
  name: string;
  icon: string;
  description: string;
  website: string;
  pricing: string;
  models: AudioModel[];
  capabilities: AudioProviderCapabilities;
  configured: boolean;
  envVarName?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: {
    start: number;
    end: number;
    text: string;
  }[];
}
