/**
 * Audio Provider — Core type definitions for Speech-to-Text services.
 *
 * Each STT backend (Groq, Deepgram, Gladia, AssemblyAI, Browser)
 * implements the IAudioProvider interface. The transcribe() method
 * accepts raw audio and returns text, so callers are provider-agnostic.
 */

// ─── Provider Identity ──────────────────────────────────────────────────

export type AudioProviderId = 'audio-browser' | 'audio-groq' | 'audio-deepgram' | 'audio-gladia' | 'audio-assemblyai' | 'audio-local-whisper';

export interface AudioProviderInfo {
  id: AudioProviderId;
  name: string;              // Human-readable: "Groq Whisper", "Deepgram Nova-3", etc.
  icon: string;              // Component name for client-side logo
  description: string;
  website: string;
  envVarName?: string;       // e.g. "GROQ_API_KEY"
  configLabel?: string;      // UI label for the config field, e.g. "Server URL" — defaults to "API Key"
  pricing: string;           // Brief pricing info
}

// ─── Models ─────────────────────────────────────────────────────────────

export interface AudioModel {
  id: string;                // e.g. "whisper-large-v3-turbo"
  label: string;
  description: string;
  isDefault?: boolean;
}

// ─── Capabilities ───────────────────────────────────────────────────────

export interface AudioProviderCapabilities {
  supportsStreaming: boolean;
  supportedLanguages: string[];  // ISO 639-1 codes: ['en', 'es', ...]
  supportedFormats: string[];    // ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a']
  maxFileSizeMB: number;
  supportsDiarization: boolean;
  supportsTimestamps: boolean;
}

// ─── Transcription Options ──────────────────────────────────────────────

export interface TranscribeOptions {
  audio: Buffer;
  mimeType: string;           // e.g. "audio/webm;codecs=opus"
  language?: string;          // ISO 639-1, e.g. "en", "es" — auto-detect if omitted
  model?: string;             // Override default model
  prompt?: string;            // Optional context hint for better accuracy
}

// ─── Transcription Result ───────────────────────────────────────────────

export interface TranscribeResult {
  text: string;
  language?: string;          // Detected language
  duration?: number;          // Audio duration in seconds
  segments?: {
    start: number;
    end: number;
    text: string;
  }[];
}

// ─── Configuration Status ────────────────────────────────────────────────

export interface AudioConfigStatus {
  configured: boolean;
  reason?: string;
}

// ─── Provider Interface ─────────────────────────────────────────────────

export interface IAudioProvider {
  readonly info: AudioProviderInfo;
  readonly models: AudioModel[];
  readonly capabilities: AudioProviderCapabilities;

  /** Check if the provider has valid credentials. */
  isConfigured(): AudioConfigStatus;

  /** Transcribe audio to text. */
  transcribe(options: TranscribeOptions): Promise<TranscribeResult>;
}

// ─── Serializable DTO (for REST API / client) ────────────────────────────

export interface AudioProviderInfoDTO {
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
  configLabel?: string;
}
