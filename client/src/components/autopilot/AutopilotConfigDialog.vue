<script setup lang="ts">
import { ref, inject, watch, computed } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Play, Plus, X, FolderOpen } from 'lucide-vue-next';
import AutopilotProfileCard from './AutopilotProfileCard.vue';
import DirectoryPicker from '@/components/DirectoryPicker.vue';
import { useAutopilotStore } from '@/stores/autopilot';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';

const store = useAutopilotStore();
const chatStore = useChatStore();
const settings = useSettingsStore();

const showConfig = inject<import('vue').Ref<boolean>>('showAutopilotConfig', ref(false));

// Form state
const goalPrompt = ref('');
const agentAProfileId = ref('analyst');
const agentBProfileId = ref('feature_creator');
const agentAModel = ref('claude-sonnet-4-20250514');
const agentBModel = ref('claude-sonnet-4-20250514');
const maxIterations = ref(20);
const scopePath = ref('');
const allowedPaths = ref<string[]>([]);
const cwdOverride = ref('');
const showDirPicker = ref(false);

// Schedule
const scheduleEnabled = ref(false);
const scheduleStartTime = ref('22:00');
const scheduleEndTime = ref('10:00');

const models = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

// Load profiles and set defaults when dialog opens
watch(showConfig, (open) => {
  if (open) {
    if (store.profiles.length === 0) store.fetchProfiles();
    if (!cwdOverride.value && chatStore.projectPath) {
      cwdOverride.value = chatStore.projectPath;
    }
  }
});

const thinkerProfiles = computed(() =>
  store.profiles.filter(p => {
    const writeTools = ['Write', 'Edit', 'Bash'];
    return !p.allowedTools.some(t => writeTools.includes(t)) || p.disallowedTools.some(t => writeTools.includes(t));
  }),
);

const executorProfiles = computed(() =>
  store.profiles.filter(p => {
    const writeTools = ['Write', 'Edit', 'Bash'];
    return p.allowedTools.some(t => writeTools.includes(t));
  }),
);

function addScopePath() {
  const path = scopePath.value.trim();
  if (path && !allowedPaths.value.includes(path)) {
    allowedPaths.value.push(path);
    scopePath.value = '';
  }
}

function removeScopePath(index: number) {
  allowedPaths.value.splice(index, 1);
}

function startRun() {
  if (!goalPrompt.value.trim() || !cwdOverride.value.trim()) return;

  const cwd = cwdOverride.value.trim();
  store.startAdhoc({
    goalPrompt: goalPrompt.value,
    agentAProfileId: agentAProfileId.value,
    agentBProfileId: agentBProfileId.value,
    agentAModel: agentAModel.value,
    agentBModel: agentBModel.value,
    cwd,
    allowedPaths: allowedPaths.value,
    maxIterations: maxIterations.value,
  });

  showConfig.value = false;
}

const canStart = computed(() => goalPrompt.value.trim().length > 0 && cwdOverride.value.trim().length > 0);
</script>

<template>
  <Dialog v-model:open="showConfig">
    <DialogContent class="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Configure Autopilot</DialogTitle>
        <DialogDescription>
          Set up two Claude instances to collaborate autonomously on your project.
        </DialogDescription>
      </DialogHeader>

      <Tabs default-value="goal" class="mt-2">
        <TabsList class="w-full">
          <TabsTrigger value="goal" class="flex-1 text-xs sm:text-sm">Goal</TabsTrigger>
          <TabsTrigger value="profiles" class="flex-1 text-xs sm:text-sm">Profiles</TabsTrigger>
          <TabsTrigger value="scope" class="flex-1 text-xs sm:text-sm">Scope</TabsTrigger>
          <TabsTrigger value="schedule" class="flex-1 text-xs sm:text-sm">Schedule</TabsTrigger>
        </TabsList>

        <!-- Goal tab -->
        <TabsContent value="goal" class="space-y-4 pt-4">
          <div class="space-y-2">
            <Label>Project Path</Label>
            <div class="flex gap-2">
              <div
                class="flex min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 py-2 text-sm"
                :class="cwdOverride ? 'text-foreground' : 'text-muted-foreground'"
              >
                <FolderOpen class="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ cwdOverride || 'No project selected' }}</span>
              </div>
              <Button variant="outline" size="sm" class="shrink-0" @click="showDirPicker = true">
                <FolderOpen class="h-4 w-4 sm:mr-1.5" />
                <span class="hidden sm:inline">Browse</span>
              </Button>
            </div>
            <p v-if="!cwdOverride" class="text-xs text-destructive">
              Required — select a project directory.
            </p>
          </div>
          <DirectoryPicker
            v-model:open="showDirPicker"
            :initial-path="cwdOverride || settings.projectsDir || '/home'"
            @select="(path: string) => cwdOverride = path"
          />

          <div class="space-y-2">
            <Label>What should the Autopilot work on?</Label>
            <Textarea
              v-model="goalPrompt"
              placeholder="e.g., Improve error handling across the application, add proper try-catch blocks, user-friendly error messages, and logging..."
              class="min-h-[120px]"
            />
            <p class="text-xs text-muted-foreground">
              Be specific about the goal. Agent A will analyze the project to find improvements
              related to this goal, and Agent B will implement them.
            </p>
          </div>
        </TabsContent>

        <!-- Profiles tab -->
        <TabsContent value="profiles" class="space-y-6 pt-4">
          <!-- Agent A: Thinker -->
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <Label class="text-sm font-medium">Agent A (Thinker)</Label>
              <Badge variant="outline" class="text-[10px] text-blue-400">analyzes & suggests</Badge>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <AutopilotProfileCard
                v-for="profile in thinkerProfiles"
                :key="profile.id"
                :profile="profile"
                :selected="agentAProfileId === profile.id"
                @select="agentAProfileId = profile.id"
              />
            </div>
            <div class="flex items-center gap-2">
              <Label class="text-xs text-muted-foreground">Model:</Label>
              <Select v-model="agentAModel">
                <SelectTrigger class="h-8 w-full max-w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="m in models" :key="m.value" :value="m.value">
                    {{ m.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- Agent B: Executor -->
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <Label class="text-sm font-medium">Agent B (Executor)</Label>
              <Badge variant="outline" class="text-[10px] text-emerald-400">implements changes</Badge>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <AutopilotProfileCard
                v-for="profile in executorProfiles"
                :key="profile.id"
                :profile="profile"
                :selected="agentBProfileId === profile.id"
                @select="agentBProfileId = profile.id"
              />
              <!-- Also show thinker profiles (user can pick any) -->
              <AutopilotProfileCard
                v-for="profile in thinkerProfiles"
                :key="'b-' + profile.id"
                :profile="profile"
                :selected="agentBProfileId === profile.id"
                @select="agentBProfileId = profile.id"
              />
            </div>
            <div class="flex items-center gap-2">
              <Label class="text-xs text-muted-foreground">Model:</Label>
              <Select v-model="agentBModel">
                <SelectTrigger class="h-8 w-full max-w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="m in models" :key="m.value" :value="m.value">
                    {{ m.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <!-- Scope & Limits tab -->
        <TabsContent value="scope" class="space-y-4 pt-4">
          <div class="space-y-2">
            <Label>Allowed Paths (scope restriction)</Label>
            <p class="text-xs text-muted-foreground">
              Restrict Agent B to only modify files within these glob patterns.
              Leave empty to allow all files.
            </p>
            <div class="flex gap-2">
              <Input
                v-model="scopePath"
                placeholder="e.g., src/** or client/src/components/**"
                class="min-w-0 flex-1"
                @keydown.enter="addScopePath"
              />
              <Button size="sm" variant="outline" @click="addScopePath">
                <Plus class="h-4 w-4" />
              </Button>
            </div>
            <div v-if="allowedPaths.length > 0" class="flex flex-wrap gap-1.5">
              <Badge
                v-for="(path, i) in allowedPaths"
                :key="i"
                variant="secondary"
                class="gap-1 font-mono text-xs"
              >
                {{ path }}
                <button @click="removeScopePath(i)" class="ml-0.5 hover:text-destructive">
                  <X class="h-3 w-3" />
                </button>
              </Badge>
            </div>
          </div>

          <div class="space-y-2">
            <Label>Max Iterations</Label>
            <Input
              v-model.number="maxIterations"
              type="number"
              :min="1"
              :max="200"
              class="w-32"
            />
            <p class="text-xs text-muted-foreground">
              Maximum number of A→B cycles before stopping automatically.
            </p>
          </div>
        </TabsContent>

        <!-- Schedule tab -->
        <TabsContent value="schedule" class="space-y-4 pt-4">
          <div class="flex items-center gap-3">
            <input
              type="checkbox"
              v-model="scheduleEnabled"
              class="h-4 w-4 rounded border-border"
            />
            <Label>Enable scheduled operation</Label>
          </div>

          <template v-if="scheduleEnabled">
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label>Start Time</Label>
                <Input v-model="scheduleStartTime" type="time" />
              </div>
              <div class="space-y-2">
                <Label>End Time</Label>
                <Input v-model="scheduleEndTime" type="time" />
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              The Autopilot will run autonomously between these hours.
              When the time window closes, it will finish the current cycle and pause.
              Rate limits are handled automatically — it waits and resumes.
            </p>
          </template>
        </TabsContent>
      </Tabs>

      <DialogFooter class="mt-4 flex-col-reverse gap-2 sm:flex-row sm:gap-2">
        <Button variant="outline" class="w-full sm:w-auto" @click="showConfig = false">Cancel</Button>
        <Button :disabled="!canStart" class="w-full gap-1.5 sm:w-auto" @click="startRun">
          <Play class="h-4 w-4" />
          Start Autopilot
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
