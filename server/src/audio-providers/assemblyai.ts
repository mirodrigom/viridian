/**
 * AssemblyAI Audio Provider — Universal-2 model.
 *
 * Pricing: ~$0.15/hr, $50 one-time credit.
 * Two-step API: upload → transcribe → poll.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-assemblyai',
  name: 'AssemblyAI',
  icon: 'BrainCircuit',
  description: 'High-accuracy STT with best streaming latency (~300ms). $50 free credit.',
  website: 'https://assemblyai.com',
  envVarName: 'ASSEMBLYAI_API_KEY',
  pricing: '~$0.15/hr, $50 free credit',
};

const models: AudioModel[] = [
  { id: 'best', label: 'Universal-2 (Best)', description: 'Highest accuracy, auto language detection.', isDefault: true },
  { id: 'nano', label: 'Nano', description: 'Faster, lower cost, English only.' },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: true,
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'nl', 'pl', 'sv', 'tr', 'uk', 'vi', 'fi'],
  supportedFormats: ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4'],
  maxFileSizeMB: 5000,
  supportsDiarization: true,
  supportsTimestamps: true,
};

function getApiKey(): string | undefined {
  return process.env.ASSEMBLYAI_API_KEY;
}

const BASE_URL = 'https://api.assemblyai.com/v2';

const provider: IAudioProvider = {
  info,
  models,
  capabilities,

  isConfigured(): AudioConfigStatus {
    const key = getApiKey();
    if (!key) return { configured: false, reason: 'ASSEMBLYAI_API_KEY not set' };
    return { configured: true };
  },

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not configured');

    // Step 1: Upload audio
    const uploadResp = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(options.audio),
      signal: AbortSignal.timeout(120000),
    });

    if (!uploadResp.ok) {
      const err = await uploadResp.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(`AssemblyAI upload failed: ${(err.error as string) || `HTTP ${uploadResp.status}`}`);
    }

    const uploadData = await uploadResp.json() as { upload_url?: string };
    if (!uploadData.upload_url) throw new Error('AssemblyAI upload did not return upload_url');

    // Step 2: Request transcription
    const transcribeBody: Record<string, unknown> = {
      audio_url: uploadData.upload_url,
      speech_model: options.model || 'best',
    };

    if (options.language) {
      transcribeBody.language_code = options.language;
    } else {
      transcribeBody.language_detection = true;
    }

    const transcribeResp = await fetch(`${BASE_URL}/transcript`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transcribeBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!transcribeResp.ok) {
      const err = await transcribeResp.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(`AssemblyAI transcription request failed: ${(err.error as string) || `HTTP ${transcribeResp.status}`}`);
    }

    const transcribeData = await transcribeResp.json() as { id?: string };
    if (!transcribeData.id) throw new Error('AssemblyAI did not return transcript ID');

    // Step 3: Poll for result
    const maxWait = 300000; // 5 minutes for longer files
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const pollResp = await fetch(`${BASE_URL}/transcript/${transcribeData.id}`, {
        headers: { authorization: apiKey },
        signal: AbortSignal.timeout(30000),
      });

      if (!pollResp.ok) throw new Error(`AssemblyAI poll failed: HTTP ${pollResp.status}`);

      const pollData = await pollResp.json() as {
        status?: string;
        text?: string;
        language_code?: string;
        audio_duration?: number;
        utterances?: { start: number; end: number; text: string }[];
        error?: string;
      };

      if (pollData.status === 'completed') {
        return {
          text: pollData.text || '',
          language: pollData.language_code,
          duration: pollData.audio_duration,
          segments: pollData.utterances?.map(u => ({
            start: u.start / 1000, // AssemblyAI uses milliseconds
            end: u.end / 1000,
            text: u.text,
          })),
        };
      }

      if (pollData.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${pollData.error || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('AssemblyAI transcription timed out');
  },
};

registerAudioProvider(provider);
export default provider;
