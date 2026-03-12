/**
 * Browser Audio Provider — uses the Web Speech API (no server-side processing).
 *
 * This is a "virtual" provider: transcription happens entirely in the browser.
 * The server just registers it so the UI can list it as an option.
 * When selected, the MicButton uses the browser's SpeechRecognition API directly.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-browser',
  name: 'Browser (Web Speech API)',
  icon: 'Monitor',
  description: 'Free, uses your browser\'s built-in speech recognition. No API key needed. Chrome recommended.',
  website: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API',
  pricing: 'Free (built into browser)',
};

const models: AudioModel[] = [
  { id: 'default', label: 'Browser Default', description: 'Uses browser\'s built-in speech engine.', isDefault: true },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: true,  // Web Speech API is inherently streaming
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
  supportedFormats: [],  // N/A — browser handles mic directly
  maxFileSizeMB: 0,      // N/A
  supportsDiarization: false,
  supportsTimestamps: false,
};

const provider: IAudioProvider = {
  info,
  models,
  capabilities,

  isConfigured(): AudioConfigStatus {
    // Always "configured" — no API key needed. Actual availability depends on the browser.
    return { configured: true };
  },

  async transcribe(_options: TranscribeOptions): Promise<TranscribeResult> {
    // This provider doesn't do server-side transcription.
    // The client handles it directly via Web Speech API.
    throw new Error('Browser audio provider does not support server-side transcription. Use client-side Web Speech API instead.');
  },
};

registerAudioProvider(provider);
export default provider;
