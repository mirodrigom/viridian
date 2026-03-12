/**
 * Deepgram Audio Provider — Nova-3 model for speech-to-text.
 *
 * Pricing: ~$0.26/hr (batch), $200 free credit to start.
 * REST API with simple POST to /listen endpoint.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-deepgram',
  name: 'Deepgram Nova-3',
  icon: 'AudioWaveform',
  description: 'High-accuracy STT with streaming support. $200 free credit.',
  website: 'https://deepgram.com',
  envVarName: 'DEEPGRAM_API_KEY',
  pricing: '~$0.26/hr (batch), $200 free credit',
};

const models: AudioModel[] = [
  { id: 'nova-3', label: 'Nova-3', description: 'Latest and most accurate model.', isDefault: true },
  { id: 'nova-2', label: 'Nova-2', description: 'Previous generation, slightly cheaper.' },
  { id: 'whisper-large', label: 'Whisper Large', description: 'OpenAI Whisper hosted on Deepgram.' },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: true,
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'nl', 'hi', 'ru', 'sv', 'tr', 'pl', 'uk'],
  supportedFormats: ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4'],
  maxFileSizeMB: 2000,
  supportsDiarization: true,
  supportsTimestamps: true,
};

function getApiKey(): string | undefined {
  return process.env.DEEPGRAM_API_KEY;
}

const provider: IAudioProvider = {
  info,
  models,
  capabilities,

  isConfigured(): AudioConfigStatus {
    const key = getApiKey();
    if (!key) return { configured: false, reason: 'DEEPGRAM_API_KEY not set' };
    return { configured: true };
  },

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not configured');

    const model = options.model || 'nova-3';
    const params = new URLSearchParams({
      model,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
    });
    if (options.language) {
      params.set('language', options.language);
    } else {
      params.set('detect_language', 'true');
    }

    const contentType = options.mimeType.split(';')[0] || 'audio/webm';

    const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': contentType,
      },
      body: new Uint8Array(options.audio),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (err.err_msg as string) || (err.message as string) || `HTTP ${resp.status}`;
      throw new Error(`Deepgram transcription failed: ${msg}`);
    }

    const data = await resp.json() as {
      results?: {
        channels?: [{
          alternatives?: [{
            transcript?: string;
            words?: { start: number; end: number; word: string }[];
          }];
          detected_language?: string;
        }];
        utterances?: { start: number; end: number; transcript: string }[];
      };
      metadata?: { duration?: number };
    };

    const channel = data.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];

    return {
      text: alt?.transcript || '',
      language: channel?.detected_language,
      duration: data.metadata?.duration,
      segments: data.results?.utterances?.map(u => ({
        start: u.start,
        end: u.end,
        text: u.transcript,
      })),
    };
  },
};

registerAudioProvider(provider);
export default provider;
