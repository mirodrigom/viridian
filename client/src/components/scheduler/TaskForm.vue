<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useScheduledTasksStore, SCHEDULE_PRESETS, type ScheduledTask } from '@/stores/scheduledTasks';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'vue-sonner';

const props = defineProps<{
  open: boolean;
  task: ScheduledTask | null;
  defaultProjectDir: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const store = useScheduledTasksStore();

const name = ref('');
const description = ref('');
const prompt = ref('');
const scheduleMode = ref<'preset' | 'custom'>('preset');
const selectedPreset = ref(SCHEDULE_PRESETS[0].value);
const customCron = ref('');
const projectDir = ref('');
const saving = ref(false);

const isEdit = computed(() => !!props.task);

const schedule = computed(() => {
  return scheduleMode.value === 'preset' ? selectedPreset.value : customCron.value;
});

const isValid = computed(() => {
  return name.value.trim().length > 0 &&
    prompt.value.trim().length > 0 &&
    schedule.value.trim().length > 0 &&
    projectDir.value.trim().length > 0;
});

watch(() => props.open, (open) => {
  if (open) {
    if (props.task) {
      name.value = props.task.name;
      description.value = props.task.description;
      prompt.value = props.task.prompt;
      projectDir.value = props.task.projectDir;

      // Check if current schedule matches a preset
      const preset = SCHEDULE_PRESETS.find(p => p.value === props.task!.schedule);
      if (preset) {
        scheduleMode.value = 'preset';
        selectedPreset.value = preset.value;
      } else {
        scheduleMode.value = 'custom';
        customCron.value = props.task.schedule;
      }
    } else {
      name.value = '';
      description.value = '';
      prompt.value = '';
      scheduleMode.value = 'preset';
      selectedPreset.value = SCHEDULE_PRESETS[0].value;
      customCron.value = '';
      projectDir.value = props.defaultProjectDir;
    }
  }
});

async function handleSubmit() {
  if (!isValid.value || saving.value) return;
  saving.value = true;

  try {
    if (isEdit.value && props.task) {
      await store.updateTask(props.task.id, {
        name: name.value,
        description: description.value,
        prompt: prompt.value,
        schedule: schedule.value,
        projectDir: projectDir.value,
      });
      toast.success('Task updated');
    } else {
      await store.createTask({
        name: name.value,
        description: description.value,
        prompt: prompt.value,
        schedule: schedule.value,
        projectDir: projectDir.value,
      });
      toast.success('Task created');
    }
    emit('saved');
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to save task');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => { if (!v) emit('close'); }">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit' : 'Create' }} Scheduled Task</DialogTitle>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Name -->
        <div class="space-y-1.5">
          <Label for="task-name">Name</Label>
          <Input
            id="task-name"
            v-model="name"
            placeholder="e.g., Daily code review"
          />
        </div>

        <!-- Description -->
        <div class="space-y-1.5">
          <Label for="task-desc">Description <span class="text-muted-foreground">(optional)</span></Label>
          <Input
            id="task-desc"
            v-model="description"
            placeholder="What this task does"
          />
        </div>

        <!-- Prompt -->
        <div class="space-y-1.5">
          <Label for="task-prompt">Prompt</Label>
          <Textarea
            id="task-prompt"
            v-model="prompt"
            placeholder="The AI prompt to execute on schedule..."
            class="min-h-[100px] resize-y"
          />
          <p class="text-xs text-muted-foreground">
            This prompt will be sent to the AI agent in the configured project context.
          </p>
        </div>

        <!-- Schedule -->
        <div class="space-y-1.5">
          <Label>Schedule</Label>
          <div class="flex items-center gap-2 mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              :class="{ 'ring-2 ring-primary': scheduleMode === 'preset' }"
              @click="scheduleMode = 'preset'"
            >
              Presets
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              :class="{ 'ring-2 ring-primary': scheduleMode === 'custom' }"
              @click="scheduleMode = 'custom'"
            >
              Custom Cron
            </Button>
          </div>

          <Select v-if="scheduleMode === 'preset'" v-model="selectedPreset">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="preset in SCHEDULE_PRESETS"
                :key="preset.value"
                :value="preset.value"
              >
                {{ preset.label }}
                <span class="ml-2 text-xs text-muted-foreground">{{ preset.value }}</span>
              </SelectItem>
            </SelectContent>
          </Select>

          <div v-else>
            <Input
              v-model="customCron"
              placeholder="* * * * * (min hour dom mon dow)"
              class="font-mono text-sm"
            />
            <p class="mt-1 text-xs text-muted-foreground">
              Standard 5-field cron expression: minute hour day-of-month month day-of-week
            </p>
          </div>
        </div>

        <!-- Project directory -->
        <div class="space-y-1.5">
          <Label for="task-dir">Project Directory</Label>
          <Input
            id="task-dir"
            v-model="projectDir"
            placeholder="/path/to/project"
            class="font-mono text-sm"
          />
          <p class="text-xs text-muted-foreground">
            Working directory for the AI agent when executing this task.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('close')">Cancel</Button>
          <Button type="submit" :disabled="!isValid || saving">
            {{ saving ? 'Saving...' : isEdit ? 'Update' : 'Create' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
