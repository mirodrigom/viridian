<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore, MODEL_OPTIONS, PERMISSION_OPTIONS, type ClaudeModel, type PermissionMode } from '@/stores/settings';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import {
  FolderOpen, ArrowRight, Clock, Moon, Sun, LogOut,
  Zap, Shield, FileEdit, ClipboardList,
} from 'lucide-vue-next';

const auth = useAuthStore();
const settings = useSettingsStore();
const router = useRouter();

const projectPath = ref('');
const recentPaths = ref<string[]>([]);

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

  router.push({ name: 'project', query: { path: target } });
}

function logout() {
  auth.logout();
  router.push('/login');
}

function selectModel(value: ClaudeModel) {
  settings.model = value;
  settings.save();
}

function selectPermission(value: PermissionMode) {
  settings.permissionMode = value;
  settings.save();
}

const permissionIcons: Record<string, typeof Zap> = {
  bypassPermissions: Zap,
  acceptEdits: FileEdit,
  plan: ClipboardList,
  default: Shield,
};
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background">
    <!-- Mini top bar -->
    <header class="flex h-11 items-center justify-between border-b border-border px-4">
      <div class="flex items-center gap-2">
        <ClaudeLogo :size="18" class="text-primary" />
        <span class="text-sm font-medium text-foreground">Claude Code Web</span>
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
              <Input
                v-model="projectPath"
                placeholder="/home/rodrigom/Documents/my-project"
                class="font-mono text-sm"
                @keydown.enter="openProject()"
              />
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

        <!-- Quick settings row -->
        <div class="grid grid-cols-2 gap-4">
          <!-- Model selection -->
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm">Model</CardTitle>
              <CardDescription class="text-xs">Select Claude model</CardDescription>
            </CardHeader>
            <CardContent class="space-y-1.5">
              <button
                v-for="m in MODEL_OPTIONS"
                :key="m.value"
                class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
                :class="settings.model === m.value
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent hover:border-border hover:bg-accent'"
                @click="selectModel(m.value)"
              >
                <div class="flex-1">
                  <div class="text-sm font-medium text-foreground">{{ m.label }}</div>
                  <div class="text-xs text-muted-foreground">{{ m.description }}</div>
                </div>
                <div v-if="settings.model === m.value" class="h-2 w-2 rounded-full bg-primary" />
              </button>
            </CardContent>
          </Card>

          <!-- Permission mode -->
          <Card>
            <CardHeader class="pb-2">
              <CardTitle class="text-sm">Permissions</CardTitle>
              <CardDescription class="text-xs">Tool approval mode</CardDescription>
            </CardHeader>
            <CardContent class="space-y-1.5">
              <button
                v-for="p in PERMISSION_OPTIONS"
                :key="p.value"
                class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
                :class="settings.permissionMode === p.value
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent hover:border-border hover:bg-accent'"
                @click="selectPermission(p.value)"
              >
                <component :is="permissionIcons[p.value] || Shield" class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="flex-1">
                  <div class="text-sm font-medium text-foreground">{{ p.label }}</div>
                  <div class="text-xs text-muted-foreground">{{ p.description }}</div>
                </div>
                <div v-if="settings.permissionMode === p.value" class="h-2 w-2 rounded-full bg-primary" />
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
