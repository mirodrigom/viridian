import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getAudioProviderDTOs, getAudioProvider } from '../audio-providers/registry.js';
import { saveProviderConfig, getProviderConfig, deleteProviderEnvVar } from '../db/database.js';
import type { AudioProviderId } from '../audio-providers/types.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const log = createLogger('audio');

// Ensure all audio providers are registered (side-effect imports)
import '../audio-providers/browser.js';
import '../audio-providers/groq.js';
import '../audio-providers/deepgram.js';
import '../audio-providers/gladia.js';
import '../audio-providers/assemblyai.js';
import '../audio-providers/local-whisper.js';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

/** GET /api/audio/providers — List all audio providers with config status. */
router.get('/providers', (_req, res) => {
  res.json(getAudioProviderDTOs());
});

/** GET /api/audio/providers/:id — Single audio provider details. */
router.get('/providers/:id', (req, res) => {
  try {
    const provider = getAudioProvider(req.params.id as AudioProviderId);
    const status = provider.isConfigured();
    res.json({
      id: provider.info.id,
      name: provider.info.name,
      icon: provider.info.icon,
      description: provider.info.description,
      website: provider.info.website,
      pricing: provider.info.pricing,
      models: provider.models,
      capabilities: provider.capabilities,
      configured: status.configured,
      envVarName: provider.info.envVarName,
    });
  } catch {
    res.status(404).json({ error: `Audio provider "${req.params.id}" not found` });
  }
});

/**
 * POST /api/audio/providers/:id/configure — Save API key for an audio provider.
 * Body: { apiKey: string }
 */
router.post('/providers/:id/configure', validate({
  body: z.object({
    apiKey: z.string().min(1),
  }),
}), async (req, res) => {
  try {
    const provider = getAudioProvider(req.params.id as AudioProviderId);
    const envVarName = provider.info.envVarName;
    if (!envVarName) {
      res.status(400).json({ error: `Provider "${provider.info.id}" does not require an API key.` });
      return;
    }

    const { apiKey } = req.body as { apiKey: string };
    await saveProviderConfig(provider.info.id, { [envVarName]: apiKey.trim() });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: `Audio provider "${req.params.id}" not found` });
  }
});

/** GET /api/audio/providers/:id/config — Return masked API key. */
router.get('/providers/:id/config', async (req, res) => {
  const config = await getProviderConfig(req.params.id as AudioProviderId);
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value) {
      masked[key] = value.length > 8
        ? `${value.slice(0, 4)}****${value.slice(-4)}`
        : '****';
    }
  }
  res.json(masked);
});

/** DELETE /api/audio/providers/:id/config — Remove stored API key. */
router.delete('/providers/:id/config', async (req, res) => {
  try {
    const provider = getAudioProvider(req.params.id as AudioProviderId);
    const envVarName = provider.info.envVarName;
    if (!envVarName) {
      res.status(400).json({ error: 'This provider has no API key to delete.' });
      return;
    }
    await deleteProviderEnvVar(provider.info.id, envVarName);
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: `Audio provider "${req.params.id}" not found` });
  }
});

/**
 * POST /api/audio/providers/:id/test — Test API key by sending a tiny audio clip.
 * Returns: { success: boolean, message: string }
 */
router.post('/providers/:id/test', async (req, res) => {
  try {
    const provider = getAudioProvider(req.params.id as AudioProviderId);

    if (provider.info.id === 'audio-browser') {
      res.json({ success: true, message: 'Browser provider requires no API key. Works in Chrome/Edge.' });
      return;
    }

    const status = provider.isConfigured();
    if (!status.configured) {
      res.json({ success: false, message: status.reason || 'Not configured' });
      return;
    }

    // Test with a minimal silent WAV (44 bytes header + 1 second of silence)
    const sampleRate = 16000;
    const numSamples = sampleRate; // 1 second
    const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);     // PCM format chunk size
    header.writeUInt16LE(1, 20);      // PCM format
    header.writeUInt16LE(1, 22);      // Mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32);      // block align
    header.writeUInt16LE(16, 34);     // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    const silentAudio = Buffer.concat([header, Buffer.alloc(dataSize)]);

    const result = await provider.transcribe({
      audio: silentAudio,
      mimeType: 'audio/wav',
      language: 'en',
    });

    res.json({
      success: true,
      message: `API key works. Transcription test returned: "${result.text || '(silence)'}"`,
    });
  } catch (err) {
    res.json({
      success: false,
      message: err instanceof Error ? err.message : 'Test failed',
    });
  }
});

/**
 * POST /api/audio/transcribe — Transcribe audio using a specific provider.
 *
 * Expects multipart-like raw body with headers:
 *   X-Audio-Provider: audio-groq
 *   X-Audio-Language: en (optional)
 *   X-Audio-Model: whisper-large-v3-turbo (optional)
 *   Content-Type: audio/webm;codecs=opus
 *
 * Body: raw audio bytes
 */
router.post('/transcribe', async (req, res) => {
  try {
    const providerId = (req.headers['x-audio-provider'] as string) || 'audio-groq';
    const language = req.headers['x-audio-language'] as string | undefined;
    const model = req.headers['x-audio-model'] as string | undefined;
    const mimeType = req.headers['content-type'] || 'audio/webm';

    const provider = getAudioProvider(providerId as AudioProviderId);

    if (provider.info.id === 'audio-browser') {
      res.status(400).json({ error: 'Browser provider handles transcription client-side. Do not send audio to the server.' });
      return;
    }

    const status = provider.isConfigured();
    if (!status.configured) {
      res.status(400).json({ error: `Audio provider "${providerId}" is not configured: ${status.reason}` });
      return;
    }

    // Body is pre-parsed by express.raw() middleware as a Buffer
    const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    log.info({ provider: providerId, size: audioBuffer.length, language, model }, 'Transcribing audio');

    const result = await provider.transcribe({
      audio: audioBuffer,
      mimeType,
      language,
      model,
    });

    log.info({ provider: providerId, textLength: result.text.length, language: result.language }, 'Transcription complete');

    res.json(result);
  } catch (err) {
    log.error({ err }, 'Transcription failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Transcription failed' });
  }
});

export default router;
