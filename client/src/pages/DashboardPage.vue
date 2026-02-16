<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import DirectoryPicker from '@/components/DirectoryPicker.vue';
import OnboardingWizard from '@/components/OnboardingWizard.vue';
import {
  FolderOpen, ArrowRight, Clock, Moon, Sun, LogOut,
  Search, ArrowUpCircle, X,
  GitBranch, Loader2,
} from 'lucide-vue-next';
import { useVersionCheck } from '@/composables/useVersionCheck';

const auth = useAuthStore();
const chat = useChatStore();
const settings = useSettingsStore();
const router = useRouter();

const { currentVersion, latestVersion, updateAvailable, dismiss: dismissUpdate } = useVersionCheck();

const projectPath = ref('');
const recentPaths = ref<string[]>([]);
const showDirPicker = ref(false);

// GitHub clone state
const cloneUrl = ref('');
const cloning = ref(false);
const cloneProgress = ref('');
const clonePercent = ref(0);
const cloneError = ref('');

async function cloneRepo() {
  const url = cloneUrl.value.trim();
  if (!url || cloning.value) return;
  cloning.value = true;
  cloneProgress.value = 'Starting clone...';
  clonePercent.value = 0;
  cloneError.value = '';

  try {
    const res = await fetch('/api/files/clone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ url, targetDir: settings.projectsDir }),
    });

    if (!res.ok && !res.headers.get('content-type')?.includes('text/event-stream')) {
      const err = await res.json();
      cloneError.value = err.error || 'Clone failed';
      cloning.value = false;
      return;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) { cloning.value = false; return; }

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'progress') {
              cloneProgress.value = data.message || '';
              if (data.percent !== undefined) clonePercent.value = data.percent;
            } else if (currentEvent === 'complete') {
              cloneUrl.value = '';
              cloning.value = false;
              openProject(data.path);
              return;
            } else if (currentEvent === 'error') {
              cloneError.value = data.message || 'Clone failed';
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    cloneError.value = err instanceof Error ? err.message : 'Clone failed';
  }
  cloning.value = false;
}

onMounted(() => {
  settings.init();
  projectPath.value = settings.projectsDir;
  const saved = localStorage.getItem('recentPaths');
  if (saved) recentPaths.value = JSON.parse(saved);
});

function openProject(path?: string) {
  const target = path || projectPath.value;
  if (!target.trim()) return;

  // Remember the base dir for next time
  settings.projectsDir = target;
  settings.save();

  // Save to recent
  const paths = recentPaths.value.filter(p => p !== target);
  paths.unshift(target);
  recentPaths.value = paths.slice(0, 5);
  localStorage.setItem('recentPaths', JSON.stringify(recentPaths.value));

  chat.setProjectPath(target);
  router.push({ name: 'project' });
}

function logout() {
  auth.logout();
  router.push('/login');
}

</script>

<template>
  <div class="flex min-h-screen flex-col bg-background">
    <!-- Update notification banner -->
    <div v-if="updateAvailable" class="flex items-center justify-center gap-2 bg-primary/10 px-4 py-1.5 text-sm">
      <ArrowUpCircle class="h-4 w-4 text-primary" />
      <span class="text-foreground">
        Version <strong>{{ latestVersion }}</strong> is available
        <span class="text-muted-foreground">(current: {{ currentVersion }})</span>
      </span>
      <a
        :href="`https://github.com/mirodrigom/claude-code-web/releases/tag/v${latestVersion}`"
        target="_blank"
        class="ml-1 text-primary underline hover:text-primary/80"
      >View release</a>
      <button class="ml-2 rounded p-0.5 text-muted-foreground hover:text-foreground" @click="dismissUpdate">
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Mini top bar -->
    <header class="flex h-11 items-center justify-between border-b border-border px-4">
      <div class="flex items-center gap-2">
        <ClaudeLogo :size="18" class="text-primary" />
        <span class="text-sm font-medium text-foreground">Viridian</span>
      </div>
      <div class="flex items-center gap-1">
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="settings.toggleDarkMode()">
          <Sun v-if="settings.darkMode" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="logout">
          <LogOut class="h-4 w-4" />
        </Button>
      </div>
    </header>

    <!-- Main content -->
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="w-full max-w-2xl space-y-8">
        <!-- Hero -->
        <div class="text-center">
          <div class="mb-4 flex justify-center">
            <div class="rounded-2xl bg-primary/10 p-4">
              <ClaudeLogo :size="48" class="text-primary" />
            </div>
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {{ auth.username }}
          </h1>
          <p class="mt-2 text-muted-foreground">
            Open a project directory to start coding with Claude
          </p>
        </div>

        <!-- Open project -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-lg">
              <FolderOpen class="h-5 w-5" />
              Open Project
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex gap-2">
              <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2">
                <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
                <span class="truncate font-mono text-sm" :class="projectPath ? 'text-foreground' : 'text-muted-foreground'">
                  {{ projectPath || 'Select a project directory...' }}
                </span>
              </div>
              <Button variant="outline" @click="showDirPicker = true" class="shrink-0 gap-1">
                <Search class="h-4 w-4" />
                Browse
              </Button>
              <Button @click="openProject()" :disabled="!projectPath.trim()" class="gap-1">
                Open
                <ArrowRight class="h-4 w-4" />
              </Button>
            </div>

            <!-- Recent projects -->
            <div v-if="recentPaths.length > 0" class="space-y-2">
              <Label class="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock class="h-3 w-3" />
                Recent Projects
              </Label>
              <div class="space-y-1">
                <button
                  v-for="path in recentPaths"
                  :key="path"
                  class="group flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition-all hover:border-border hover:bg-accent"
                  @click="openProject(path)"
                >
                  <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-foreground">
                      {{ path.split('/').pop() }}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">{{ path }}</div>
                  </div>
                  <ArrowRight class="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Clone from GitHub -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-lg">
              <GitBranch class="h-5 w-5" />
              Clone Repository
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="flex gap-2">
              <Input
                v-model="cloneUrl"
                placeholder="https://github.com/user/repo.git"
                class="font-mono text-sm"
                :disabled="cloning"
                @keydown.enter="cloneRepo"
              />
              <Button @click="cloneRepo" :disabled="!cloneUrl.trim() || cloning" class="shrink-0 gap-1">
                <Loader2 v-if="cloning" class="h-4 w-4 animate-spin" />
                <GitBranch v-else class="h-4 w-4" />
                Clone
              </Button>
            </div>
            <!-- Clone progress -->
            <div v-if="cloning" class="space-y-1.5">
              <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary transition-all duration-300"
                  :style="{ width: `${clonePercent}%` }"
                />
              </div>
              <p class="truncate text-xs text-muted-foreground">{{ cloneProgress }}</p>
            </div>
            <p v-if="cloneError" class="text-xs text-destructive">{{ cloneError }}</p>
          </CardContent>
        </Card>

      </div>
    </div>

    <!-- Version footer -->
    <footer v-if="currentVersion" class="py-2 text-center text-[11px] text-muted-foreground">
      Viridian v{{ currentVersion }}
    </footer>

    <DirectoryPicker
      v-model:open="showDirPicker"
      :initial-path="settings.projectsDir"
      @select="(path: string) => { projectPath = path; openProject(path); }"
    />
    <OnboardingWizard @complete="openProject" />
  </div>
</template>
