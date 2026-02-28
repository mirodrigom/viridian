<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';
import { useProviderStore } from '@/stores/provider';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Key, Loader2, ExternalLink, Terminal, FlaskConical,
  CheckCircle, XCircle, Trash2, Info, Github, Building2, Chrome,
} from 'lucide-vue-next';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProviderInfo } from '@/types/provider';

const props = defineProps<{ provider: ProviderInfo | null }>();
// anySuccess: true = at least one model/backend passed, false = all failed
// failedModelIds: model IDs that failed (for marking them in the selector)
const emit = defineEmits<{ configured: [anySuccess: boolean, failedModelIds: string[]] }>();

const open = defineModel<boolean>('open', { default: false });
const providerStore = useProviderStore();

const apiKey = ref('');
const selectedEnvVar = ref('');
const saving = ref(false);
const testing = ref(false);
const deleting = ref<string | null>(null);  // envVarName being deleted
const configuredKeys = ref<Record<string, string>>({});  // masked values

// ─── Login flow state (for Kiro-style device code auth) ──────────────────
const loginLoading = ref(false);
const loginUrl = ref<string | null>(null);
const loginDeviceCode = ref<string | null>(null);
const loginMessage = ref('');
const loginDone = ref(false);
const loginStep = ref<'choose' | 'waiting'>('choose');
// Pro (Identity Center) fields
const idcStartUrl = ref('');
const idcRegion = ref('us-east-1');

async function startLoginFlow(license: 'free' | 'pro') {
  if (!props.provider || loginLoading.value) return;
  loginLoading.value = true;
  loginUrl.value = null;
  loginDeviceCode.value = null;
  loginMessage.value = 'Starting login...';
  loginDone.value = false;
  loginStep.value = 'waiting';

  try {
    const body: Record<string, string> = { license };
    if (license === 'pro') {
      if (idcStartUrl.value.trim()) body.identityProvider = idcStartUrl.value.trim();
      if (idcRegion.value.trim()) body.region = idcRegion.value.trim();
    }

    const res = await apiFetch(`/api/providers/${props.provider.id}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as {
      success: boolean;
      output?: string;
      loginUrl?: string;
      deviceCode?: string;
      message?: string;
    };

    if (!data.success && !data.loginUrl) {
      // Login failed (e.g. invalid identity provider URL) — stay on choose step
      loginStep.value = 'choose';
      const rawError = (data.output || data.message || '').trim();
      loginMessage.value = rawError.includes('dispatch failure')
        ? 'Login failed. Check your Identity Center Start URL and region, then try again.'
        : rawError || 'Login failed.';
      toast.error(loginMessage.value);
      return;
    }

    loginUrl.value = data.loginUrl || null;
    loginDeviceCode.value = data.deviceCode || null;
    loginMessage.value = data.message || data.output || '';

    if (data.loginUrl) {
      window.open(data.loginUrl, '_blank');
    }

    if (data.success && !data.loginUrl) {
      loginDone.value = true;
      toast.success(`${props.provider.name} authenticated!`);
      await providerStore.fetchProviders();
      emit('configured', true, []);
    }
  } catch (err) {
    loginStep.value = 'choose';
    loginMessage.value = err instanceof Error ? err.message : 'Login failed';
    toast.error(`Failed to start ${props.provider?.name} login`);
  } finally {
    loginLoading.value = false;
  }
}

async function checkLoginStatus() {
  if (!props.provider) return;
  loginLoading.value = true;
  loginMessage.value = 'Checking authentication...';

  try {
    await providerStore.fetchProviders();
    const updated = providerStore.providers.find(p => p.id === props.provider!.id);
    if (updated?.configured) {
      loginDone.value = true;
      loginMessage.value = 'Authentication successful!';
      toast.success(`${props.provider.name} authenticated!`);
      emit('configured', true, []);
    } else {
      loginMessage.value = 'Not authenticated yet. Complete the login in your browser, then click "Check again".';
    }
  } catch {
    loginMessage.value = 'Failed to check status.';
  } finally {
    loginLoading.value = false;
  }
}

interface TestResult {
  label: string;
  envVarName: string;
  modelId?: string;  // set when this row represents an individual model test
  status: 'pending' | 'running' | 'success' | 'error' | 'unconfigured';
  message: string;
}

const testResults = ref<TestResult[]>([]);
const showResults = computed(() => testResults.value.length > 0);

// Tracks last test outcome per envVarName: 'ok' | 'error' | 'untested'
const keyStatuses = ref<Record<string, 'ok' | 'error' | 'untested'>>({});

// ─── Per-provider setup config ──────────────────────────────────────────

interface EnvVarOption {
  name: string;
  label: string;
  placeholder: string;
  getKeyUrl: string;
  getKeyLabel: string;
}

interface ProviderSetup {
  instructionsOnly?: boolean;
  loginFlow?: boolean;
  envVar?: EnvVarOption;
  envVarOptions?: EnvVarOption[];
  note?: string;
  instructions?: { step: string }[];
}

const PROVIDER_SETUPS: Record<string, ProviderSetup> = {
  claude: {
    instructionsOnly: true,
    instructions: [
      { step: 'Install Claude CLI: npm install -g @anthropic-ai/claude-code' },
      { step: 'Run `claude` in your terminal to open the OAuth flow' },
      { step: 'Sign in with your Anthropic account' },
      { step: 'Restart this app — Claude will be detected automatically' },
    ],
  },
  gemini: {
    envVar: {
      name: 'GEMINI_API_KEY',
      label: 'Gemini API Key',
      placeholder: 'AIza...',
      getKeyUrl: 'https://aistudio.google.com/app/apikey',
      getKeyLabel: 'Get key from Google AI Studio',
    },
    note: 'Alternatively, run `gemini` in your terminal to authenticate via Google OAuth.',
  },
  codex: {
    instructionsOnly: true,
    instructions: [
      { step: 'Install Codex CLI: npm install -g @openai/codex' },
      { step: 'Run `codex` in your terminal to open the authentication flow' },
      { step: 'Sign in with your OpenAI account' },
      { step: 'Restart this app — Codex will be detected automatically' },
    ],
  },
  aider: {
    envVarOptions: [
      {
        name: 'ANTHROPIC_API_KEY',
        label: 'Anthropic (Claude models)',
        placeholder: 'sk-ant-...',
        getKeyUrl: 'https://console.anthropic.com/settings/keys',
        getKeyLabel: 'Get Anthropic key',
      },
      {
        name: 'OPENAI_API_KEY',
        label: 'OpenAI (GPT models)',
        placeholder: 'sk-...',
        getKeyUrl: 'https://platform.openai.com/api-keys',
        getKeyLabel: 'Get OpenAI key',
      },
      {
        name: 'GEMINI_API_KEY',
        label: 'Google (Gemini models)',
        placeholder: 'AIza...',
        getKeyUrl: 'https://aistudio.google.com/app/apikey',
        getKeyLabel: 'Get Google key',
      },
      {
        name: 'DEEPSEEK_API_KEY',
        label: 'DeepSeek',
        placeholder: 'sk-...',
        getKeyUrl: 'https://platform.deepseek.com/api_keys',
        getKeyLabel: 'Get DeepSeek key',
      },
    ],
    note: 'Set the key for the LLM you want Aider to use. You can add multiple keys for different models.',
  },
  kiro: {
    loginFlow: true,
  },
  qwen: {
    envVar: {
      name: 'DASHSCOPE_API_KEY',
      label: 'DashScope API Key',
      placeholder: 'sk-...',
      getKeyUrl: 'https://dashscope.aliyuncs.com/',
      getKeyLabel: 'Get key from Alibaba DashScope',
    },
    note: 'Alternatively, run `qwen` in your terminal to authenticate via Alibaba OAuth.',
  },
  opencode: {
    envVarOptions: [
      {
        name: 'ANTHROPIC_API_KEY',
        label: 'Anthropic (Claude)',
        placeholder: 'sk-ant-...',
        getKeyUrl: 'https://console.anthropic.com/settings/keys',
        getKeyLabel: 'Get Anthropic key',
      },
      {
        name: 'OPENAI_API_KEY',
        label: 'OpenAI (GPT)',
        placeholder: 'sk-...',
        getKeyUrl: 'https://platform.openai.com/api-keys',
        getKeyLabel: 'Get OpenAI key',
      },
      {
        name: 'GEMINI_API_KEY',
        label: 'Google (Gemini)',
        placeholder: 'AIza...',
        getKeyUrl: 'https://aistudio.google.com/app/apikey',
        getKeyLabel: 'Get Google key',
      },
    ],
    note: 'OpenCode supports 75+ LLM providers. Set any key to get started — you can add more later.',
  },
};

const setup = computed<ProviderSetup | null>(() =>
  props.provider ? (PROVIDER_SETUPS[props.provider.id] ?? null) : null
);

const activeEnvVarOption = computed<EnvVarOption | null>(() => {
  if (!setup.value) return null;
  if (setup.value.envVar) return setup.value.envVar;
  if (setup.value.envVarOptions) {
    return setup.value.envVarOptions.find(o => o.name === selectedEnvVar.value)
      ?? setup.value.envVarOptions[0]
      ?? null;
  }
  return null;
});

const currentMaskedKey = computed<string | null>(() => {
  if (!activeEnvVarOption.value) return null;
  return configuredKeys.value[activeEnvVarOption.value.name] ?? null;
});

const currentKeyStatus = computed<'ok' | 'error' | 'untested'>(() => {
  if (!activeEnvVarOption.value) return 'untested';
  return keyStatuses.value[activeEnvVarOption.value.name] ?? 'untested';
});

// True when at least one key is stored (even for a different backend)
const hasAnyConfiguredKey = computed(() => Object.keys(configuredKeys.value).length > 0);

async function fetchConfiguredKeys() {
  if (!props.provider) return;
  try {
    const res = await apiFetch(`/api/providers/${props.provider.id}/config`);
    if (res.ok) {
      const keys = await res.json() as Record<string, string>;
      configuredKeys.value = keys;

      // Seed keyStatuses from localStorage failedProviders so badge stays red
      // across page refreshes — only for envVars not yet tested this session
      const failed = new Set<string>(
        JSON.parse(localStorage.getItem('failedProviders') || '[]') as string[],
      );
      if (failed.has(props.provider.id)) {
        for (const envVarName of Object.keys(keys)) {
          if (!keyStatuses.value[envVarName]) {
            keyStatuses.value[envVarName] = 'error';
          }
        }
      }
    }
  } catch { /* ignore */ }
}

watch(() => props.provider?.id, (newId, oldId) => {
  // Only reset keyStatuses when switching to a different provider,
  // not on object-reference changes caused by fetchProviders() refreshes
  if (newId !== oldId) {
    keyStatuses.value = {};
  }
  apiKey.value = '';
  testResults.value = [];
  configuredKeys.value = {};
  if (setup.value?.envVarOptions) {
    selectedEnvVar.value = setup.value.envVarOptions[0]?.name ?? '';
  }
}, { immediate: true });

watch(open, (isOpen) => {
  if (isOpen) {
    fetchConfiguredKeys();
    // Reset login flow state
    loginStep.value = 'choose';
    loginUrl.value = null;
    loginDeviceCode.value = null;
    loginMessage.value = '';
    loginDone.value = false;
  } else {
    testResults.value = [];
    apiKey.value = '';
    // keyStatuses intentionally kept so badge color persists across re-opens
  }
});

// ─── Delete a stored key ─────────────────────────────────────────────────

async function deleteKey(envVarName: string) {
  if (!props.provider || deleting.value) return;
  deleting.value = envVarName;
  try {
    const res = await apiFetch(`/api/providers/${props.provider.id}/config`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ envVarName }),
    });
    if (!res.ok) {
      toast.error('Failed to remove key');
      return;
    }
    await providerStore.fetchProviders();
    await fetchConfiguredKeys();
    // If we deleted the only key, clear any test results
    if (!hasAnyConfiguredKey.value) testResults.value = [];
  } catch {
    toast.error('Failed to remove key');
  } finally {
    deleting.value = null;
  }
}

// ─── Run tests (shared by "Save & Test" and "Test" button) ───────────────

async function runTests(
  providerId: string,
  providerName: string,
): Promise<{ anySuccess: boolean; failedModelIds: string[] }> {
  const backends: Array<{ label: string; envVarName?: string }> = [];
  if (setup.value?.envVarOptions) {
    for (const opt of setup.value.envVarOptions) {
      backends.push({ label: opt.label, envVarName: opt.name });
    }
  } else {
    backends.push({ label: providerName });
  }

  testResults.value = backends.map(b => ({
    label: b.label,
    envVarName: b.envVarName ?? '',
    status: 'pending' as const,
    message: '',
  }));

  testing.value = true;
  let anySuccess = false;
  const failedModelIds: string[] = [];
  let rowIdx = 0;

  for (const backend of backends) {
    testResults.value[rowIdx]!.status = 'running';
    const testBody: Record<string, string> = {};
    if (backend.envVarName) testBody.envVarName = backend.envVarName;

    try {
      const testRes = await apiFetch(`/api/providers/${providerId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testBody),
      });
      const testData = await testRes.json() as {
        success: boolean;
        message: string;
        models?: Array<{ id: string; label: string; success: boolean; message: string }>;
      };

      const envVarName = backend.envVarName ?? '';
      const isUnconfigured = !testData.success && /no api key/i.test(testData.message);
      const modelList = testData.models ?? [];

      if (modelList.length > 1) {
        // Per-model results (e.g. Gemini) — expand this placeholder row into one row per model
        const modelRows: TestResult[] = modelList.map(m => ({
          label: m.label,
          envVarName,
          modelId: m.id,
          status: (isUnconfigured ? 'unconfigured' : m.success ? 'success' : 'error') as TestResult['status'],
          message: m.message,
        }));
        testResults.value.splice(rowIdx, 1, ...modelRows);
        rowIdx += modelList.length;
        for (const m of modelList) {
          if (!m.success && !isUnconfigured) failedModelIds.push(m.id);
        }
      } else {
        // Single result (connection test or no models list)
        testResults.value[rowIdx]!.status = isUnconfigured ? 'unconfigured' : testData.success ? 'success' : 'error';
        testResults.value[rowIdx]!.message = modelList[0]?.message ?? testData.message;
        rowIdx++;
      }

      // Update key badge status: envVar is set for multi-backend; fall back to setup.envVar for single
      const envVar = envVarName || setup.value?.envVar?.name || '';
      if (!isUnconfigured && envVar) {
        keyStatuses.value[envVar] = testData.success ? 'ok' : 'error';
      }
      if (testData.success) anySuccess = true;
    } catch (err) {
      testResults.value[rowIdx]!.status = 'error';
      testResults.value[rowIdx]!.message = err instanceof Error ? err.message : 'Request failed';
      const envVar = backend.envVarName || setup.value?.envVar?.name || '';
      if (envVar) keyStatuses.value[envVar] = 'error';
      rowIdx++;
    }
  }

  testing.value = false;
  return { anySuccess, failedModelIds };
}

// ─── Test existing key without saving ───────────────────────────────────

async function testOnly() {
  if (!props.provider) return;
  const { anySuccess, failedModelIds } = await runTests(props.provider.id, props.provider.name);
  emit('configured', anySuccess, failedModelIds);
}

// ─── Save new key then test ──────────────────────────────────────────────

async function save() {
  if (!props.provider || !apiKey.value.trim() || !activeEnvVarOption.value) return;
  saving.value = true;
  testResults.value = [];

  const providerId = props.provider.id;
  const providerName = props.provider.name;

  try {
    const body: Record<string, string> = { apiKey: apiKey.value.trim() };
    if (setup.value?.envVarOptions) body.envVarName = activeEnvVarOption.value.name;

    const res = await apiFetch(`/api/providers/${providerId}/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      toast.error(data.error || 'Failed to save credentials');
      return;
    }

    apiKey.value = '';
    await providerStore.fetchProviders();
    await fetchConfiguredKeys();
    saving.value = false;

    const { anySuccess, failedModelIds } = await runTests(providerId, providerName);
    emit('configured', anySuccess, failedModelIds);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Network error');
  } finally {
    saving.value = false;
    testing.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Key class="h-5 w-5" />
          Configure {{ provider?.name }}
        </DialogTitle>
        <DialogDescription>
          Set up credentials so {{ provider?.name }} can accept queries.
        </DialogDescription>
      </DialogHeader>

      <!-- Login flow providers (Kiro — device code auth) -->
      <div v-if="setup?.loginFlow" class="space-y-4 py-1">
        <!-- Step 1: Choose login type -->
        <template v-if="loginStep === 'choose' && !loginDone">
          <div class="space-y-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="loginLoading"
              @click="startLoginFlow('free')"
              class="w-full justify-start h-10"
            >
              <Chrome class="mr-2.5 h-4 w-4 text-muted-foreground" />
              Sign in with Google
            </Button>

            <Button
              variant="outline"
              size="sm"
              :disabled="loginLoading"
              @click="startLoginFlow('free')"
              class="w-full justify-start h-10"
            >
              <Github class="mr-2.5 h-4 w-4 text-muted-foreground" />
              Sign in with GitHub
            </Button>

            <Button
              variant="outline"
              size="sm"
              :disabled="loginLoading"
              @click="startLoginFlow('free')"
              class="w-full justify-start h-10"
            >
              <svg class="mr-2.5 h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor"><path d="M18.75 11.35a4.32 4.32 0 0 1-.79-.06 3.93 3.93 0 0 1-.73-.2 4.02 4.02 0 0 1-.65-.34 3.9 3.9 0 0 1-.57-.45 3.93 3.93 0 0 1-.79-1.23 3.95 3.95 0 0 1-.28-1.47c0-.53.1-1.03.28-1.48a3.93 3.93 0 0 1 2.01-2.02 3.95 3.95 0 0 1 1.52-.3c.53 0 1.03.1 1.48.3a3.93 3.93 0 0 1 2.02 2.02c.19.45.28.95.28 1.48s-.1 1.02-.28 1.47a3.93 3.93 0 0 1-2.02 2.02 3.93 3.93 0 0 1-1.48.29zM5.25 11.35c-.53 0-1.03-.1-1.48-.29a3.93 3.93 0 0 1-2.02-2.02A3.92 3.92 0 0 1 1.47 7.6c0-.53.1-1.03.28-1.48a3.93 3.93 0 0 1 2.02-2.02 3.95 3.95 0 0 1 1.48-.3c.53 0 1.03.1 1.48.3a3.93 3.93 0 0 1 2.02 2.02c.19.45.28.95.28 1.48s-.1 1.02-.28 1.47a3.93 3.93 0 0 1-2.02 2.02 3.93 3.93 0 0 1-1.48.29zM12 20.2a3.93 3.93 0 0 1-1.48-.29 3.93 3.93 0 0 1-2.02-2.02 3.92 3.92 0 0 1-.28-1.47c0-.53.1-1.03.28-1.48a3.93 3.93 0 0 1 2.02-2.02A3.95 3.95 0 0 1 12 12.62c.53 0 1.03.1 1.48.3a3.93 3.93 0 0 1 2.02 2.02c.19.45.28.95.28 1.48s-.1 1.02-.28 1.47a3.93 3.93 0 0 1-2.02 2.02A3.93 3.93 0 0 1 12 20.2z"/></svg>
              Sign in with AWS Builder ID
            </Button>

            <div class="relative my-3">
              <div class="absolute inset-0 flex items-center"><span class="w-full border-t" /></div>
              <div class="relative flex justify-center text-xs"><span class="bg-background px-2 text-muted-foreground">or</span></div>
            </div>

            <div class="space-y-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="loginLoading || !idcStartUrl.trim()"
                @click="startLoginFlow('pro')"
                class="w-full justify-start h-10"
              >
                <Building2 class="mr-2.5 h-4 w-4 text-muted-foreground" />
                Sign in with your organization identity
              </Button>
              <div class="pl-1 space-y-1.5">
                <Input
                  v-model="idcStartUrl"
                  type="text"
                  placeholder="Start URL (e.g. https://my-org.awsapps.com/start)"
                  class="h-8 text-xs font-mono"
                />
                <Input
                  v-model="idcRegion"
                  type="text"
                  placeholder="Region (default: us-east-1)"
                  class="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Step 2: Waiting for auth -->
        <template v-if="loginStep === 'waiting' && loginUrl && !loginDone">
          <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p class="text-xs font-medium text-amber-400">Complete authentication in your browser</p>
            <p v-if="loginDeviceCode" class="text-sm text-foreground">
              Code: <span class="font-mono font-bold text-lg">{{ loginDeviceCode }}</span>
            </p>
            <a
              :href="loginUrl"
              target="_blank"
              rel="noopener"
              class="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ExternalLink class="h-3 w-3" />
              Open login page
            </a>
          </div>
          <Button
            variant="outline"
            size="sm"
            :disabled="loginLoading"
            @click="checkLoginStatus"
            class="w-full"
          >
            <Loader2 v-if="loginLoading" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            <CheckCircle v-else class="mr-1.5 h-3.5 w-3.5" />
            {{ loginLoading ? 'Checking...' : 'I\'ve completed login — check status' }}
          </Button>
        </template>

        <!-- Loading without URL yet -->
        <template v-if="loginStep === 'waiting' && !loginUrl && !loginDone && loginLoading">
          <div class="flex items-center gap-2 py-4 justify-center">
            <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
            <p class="text-sm text-muted-foreground">{{ loginMessage }}</p>
          </div>
        </template>

        <!-- Done -->
        <template v-if="loginDone">
          <div class="rounded-lg border border-green-500/30 bg-green-500/5 p-3 flex items-center gap-2">
            <CheckCircle class="h-4 w-4 text-green-500" />
            <p class="text-sm text-green-500 font-medium">{{ loginMessage }}</p>
          </div>
        </template>

        <p v-if="loginMessage && !loginDone && !loginUrl && !loginLoading" class="text-xs text-muted-foreground">{{ loginMessage }}</p>

        <div class="flex justify-end gap-2 pt-1">
          <Button v-if="loginStep === 'waiting' && !loginDone" variant="ghost" size="sm" @click="loginStep = 'choose'; loginUrl = null; loginDeviceCode = null">
            Back
          </Button>
          <Button variant="outline" size="sm" @click="open = false">
            {{ loginDone ? 'Done' : 'Close' }}
          </Button>
        </div>
      </div>

      <!-- Instructions-only providers (Claude) -->
      <div v-else-if="setup?.instructionsOnly" class="space-y-4 py-1">
        <ol class="space-y-2">
          <li
            v-for="(item, i) in setup.instructions"
            :key="i"
            class="flex items-start gap-2.5 text-sm"
          >
            <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
              {{ i + 1 }}
            </span>
            <span class="text-muted-foreground leading-relaxed">{{ item.step }}</span>
          </li>
        </ol>
        <div class="flex justify-end pt-1">
          <Button variant="outline" size="sm" @click="open = false">Close</Button>
        </div>
      </div>

      <!-- API key form -->
      <div v-else-if="setup" class="space-y-4 py-1">
        <template v-if="!showResults">
          <!-- Backend selector (multi-backend providers) -->
          <div v-if="setup.envVarOptions" class="space-y-1.5">
            <Label class="text-xs">LLM Backend</Label>
            <Select v-model="selectedEnvVar">
              <SelectTrigger class="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in setup.envVarOptions"
                  :key="opt.name"
                  :value="opt.name"
                >
                  <span class="flex items-center gap-2">
                    {{ opt.label }}
                    <span
                      v-if="configuredKeys[opt.name]"
                      class="text-[10px] font-mono"
                      :class="{
                        'text-green-500': keyStatuses[opt.name] === 'ok',
                        'text-red-400': keyStatuses[opt.name] === 'error',
                        'text-amber-400': !keyStatuses[opt.name] || keyStatuses[opt.name] === 'untested',
                      }"
                    >●</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- API key section -->
          <div v-if="activeEnvVarOption" class="space-y-1.5">
            <div class="flex items-center gap-1.5">
              <Label class="text-xs">
                {{ setup.envVar ? setup.envVar.label : activeEnvVarOption.label + ' API Key' }}
              </Label>
              <TooltipProvider :delay-duration="100">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Info class="h-3 w-3 text-muted-foreground/50 cursor-default" />
                  </TooltipTrigger>
                  <TooltipContent class="max-w-[200px] text-xs space-y-1 p-2.5">
                    <p class="flex items-center gap-1.5"><span class="text-amber-400">●</span> <span class="text-muted-foreground">Stored — saved but not yet tested</span></p>
                    <p class="flex items-center gap-1.5"><span class="text-red-400">●</span> <span class="text-muted-foreground">Failed — invalid or expired key</span></p>
                    <p class="flex items-center gap-1.5"><span class="text-green-500">●</span> <span class="text-muted-foreground">Verified — connection test passed</span></p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <!-- Stored key row — color reflects last test result -->
            <div
              v-if="currentMaskedKey"
              class="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              :class="{
                'border-green-500/30 bg-green-500/5': currentKeyStatus === 'ok',
                'border-red-500/30 bg-red-500/5': currentKeyStatus === 'error',
                'border-amber-500/30 bg-amber-500/5': currentKeyStatus === 'untested',
              }"
            >
              <CheckCircle v-if="currentKeyStatus === 'ok'" class="h-3 w-3 shrink-0 text-green-500" />
              <XCircle v-else-if="currentKeyStatus === 'error'" class="h-3 w-3 shrink-0 text-red-400" />
              <span
                class="font-mono text-[11px] flex-1"
                :class="{
                  'text-green-500': currentKeyStatus === 'ok',
                  'text-red-400': currentKeyStatus === 'error',
                  'text-amber-500': currentKeyStatus === 'untested',
                }"
              >{{ currentMaskedKey }}</span>
              <span class="text-[10px] text-muted-foreground">
                {{ currentKeyStatus === 'ok' ? 'verified' : currentKeyStatus === 'error' ? 'failed' : 'stored' }}
              </span>
              <button
                class="ml-1 rounded p-0.5 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                :disabled="deleting === activeEnvVarOption.name"
                title="Remove key"
                @click="deleteKey(activeEnvVarOption.name)"
              >
                <Loader2 v-if="deleting === activeEnvVarOption.name" class="h-3 w-3 animate-spin" />
                <Trash2 v-else class="h-3 w-3" />
              </button>
            </div>

            <!-- Input for new / replacement key -->
            <Input
              v-model="apiKey"
              type="password"
              :placeholder="currentMaskedKey ? 'Enter new key to replace...' : activeEnvVarOption.placeholder"
              class="h-9 font-mono text-sm"
              @keydown.enter="save"
            />
            <a
              :href="activeEnvVarOption.getKeyUrl"
              target="_blank"
              rel="noopener"
              class="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ExternalLink class="h-3 w-3" />
              {{ activeEnvVarOption.getKeyLabel }}
            </a>
          </div>

          <!-- Optional note -->
          <div v-if="setup.note" class="rounded-lg border border-border bg-muted/30 p-3">
            <div class="flex items-start gap-2">
              <Terminal class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p class="text-xs text-muted-foreground leading-relaxed">{{ setup.note }}</p>
            </div>
          </div>
        </template>

        <!-- Test results panel — compact: one row per model, tooltip for details -->
        <div v-if="showResults" class="space-y-0.5">
          <p class="text-xs text-muted-foreground mb-2">
            {{ testing ? 'Testing connections...' : 'Connection test results:' }}
          </p>
          <div
            v-for="result in testResults"
            :key="result.label"
            class="flex items-center gap-2 rounded px-1.5 py-1 transition-colors"
            :class="{ 'opacity-35': result.status === 'unconfigured' }"
          >
            <!-- Status icon -->
            <Loader2 v-if="result.status === 'running'" class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            <CheckCircle v-else-if="result.status === 'success'" class="h-3.5 w-3.5 shrink-0 text-green-500" />
            <XCircle v-else-if="result.status === 'error'" class="h-3.5 w-3.5 shrink-0 text-red-400" />
            <div v-else class="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />

            <!-- Label -->
            <span
              class="text-xs flex-1 min-w-0 truncate font-medium"
              :class="{
                'text-green-500': result.status === 'success',
                'text-red-400': result.status === 'error',
                'text-foreground': result.status === 'running',
                'text-muted-foreground': result.status === 'pending' || result.status === 'unconfigured',
              }"
            >{{ result.label }}</span>

            <!-- Info tooltip — shows message on hover -->
            <TooltipProvider v-if="result.message" :delay-duration="100">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Info
                    class="h-3 w-3 shrink-0 cursor-default transition-colors"
                    :class="{
                      'text-red-400/50 hover:text-red-400': result.status === 'error',
                      'text-green-500/50 hover:text-green-500': result.status === 'success',
                      'text-muted-foreground/40 hover:text-muted-foreground': result.status !== 'error' && result.status !== 'success',
                    }"
                  />
                </TooltipTrigger>
                <TooltipContent class="max-w-[280px] text-xs break-words leading-relaxed">
                  {{ result.message }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-1">
          <!-- Form mode -->
          <template v-if="!showResults">
            <Button variant="outline" size="sm" @click="open = false">Cancel</Button>
            <!-- Test existing key without re-entering it -->
            <Button
              v-if="hasAnyConfiguredKey && !apiKey.trim()"
              variant="outline"
              size="sm"
              :disabled="testing"
              @click="testOnly"
            >
              <FlaskConical class="mr-1.5 h-3.5 w-3.5" />
              Test
            </Button>
            <!-- Save new key and test -->
            <Button
              v-if="apiKey.trim()"
              size="sm"
              :disabled="saving"
              @click="save"
            >
              <Loader2 v-if="saving" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
              <FlaskConical v-else class="mr-1.5 h-3.5 w-3.5" />
              {{ saving ? 'Saving...' : currentMaskedKey ? 'Update & Test' : 'Save & Test' }}
            </Button>
          </template>

          <!-- Results mode -->
          <template v-if="showResults">
            <Button variant="outline" size="sm" :disabled="testing" @click="testResults = []">
              Back
            </Button>
            <Button size="sm" :disabled="testing" @click="open = false">
              {{ testing ? 'Testing...' : 'Done' }}
            </Button>
          </template>
        </div>
      </div>

      <!-- Fallback -->
      <div v-else class="space-y-3 py-1 text-sm text-muted-foreground">
        <p>
          This provider manages its own authentication. Run
          <code class="rounded bg-muted px-1 text-xs">{{ provider?.name.toLowerCase() }}</code>
          in your terminal to authenticate, then restart the server.
        </p>
        <div class="flex justify-end">
          <Button variant="outline" size="sm" @click="open = false">Close</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
