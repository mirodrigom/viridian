<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { toast } from 'vue-sonner';
import { Plus, Trash2, FolderOpen } from 'lucide-vue-next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const open = defineModel<boolean>('open', { default: false });
const store = useProjectsStore();

interface ServiceEntry {
  name: string;
  command: string;
}

const form = reactive({
  name: '',
  path: '',
  description: '',
});

const services = ref<ServiceEntry[]>([
  { name: 'frontend', command: 'pnpm dev' },
  { name: 'backend', command: 'pnpm start' },
]);

const submitting = ref(false);
const error = ref('');

function addService() {
  services.value.push({ name: '', command: '' });
}

function removeService(i: number) {
  services.value.splice(i, 1);
}

function reset() {
  form.name = '';
  form.path = '';
  form.description = '';
  services.value = [
    { name: 'frontend', command: 'pnpm dev' },
    { name: 'backend', command: 'pnpm start' },
  ];
  error.value = '';
}

async function submit() {
  error.value = '';
  if (!form.name.trim()) { error.value = 'Project name is required.'; return; }
  if (!form.path.trim()) { error.value = 'Project path is required.'; return; }

  const validServices = services.value.filter(s => s.name.trim() && s.command.trim());

  submitting.value = true;
  try {
    await store.addProject({
      name: form.name.trim(),
      path: form.path.trim(),
      description: form.description.trim(),
      services: validServices,
    });
    toast.success(`Project "${form.name}" added`);
    open.value = false;
    reset();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add project';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open" @update:open="(v) => { if (!v) reset(); }">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FolderOpen class="h-4 w-4 text-primary" />
          Add Project
        </DialogTitle>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Name -->
        <div class="space-y-1.5">
          <Label>Project Name</Label>
          <Input v-model="form.name" placeholder="My App" />
        </div>

        <!-- Path -->
        <div class="space-y-1.5">
          <Label>Project Path</Label>
          <Input v-model="form.path" placeholder="/home/user/projects/my-app" class="font-mono text-sm" />
          <p class="text-xs text-muted-foreground">Absolute path on the server's filesystem.</p>
        </div>

        <!-- Description -->
        <div class="space-y-1.5">
          <Label>Description <span class="text-muted-foreground">(optional)</span></Label>
          <Input v-model="form.description" placeholder="Short description…" />
        </div>

        <!-- Services -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>Services</Label>
            <Button variant="ghost" size="sm" class="h-7 gap-1 text-xs" @click="addService">
              <Plus class="h-3.5 w-3.5" />
              Add Service
            </Button>
          </div>

          <div class="space-y-2">
            <div
              v-for="(svc, i) in services"
              :key="i"
              class="flex items-center gap-2"
            >
              <Input
                v-model="svc.name"
                placeholder="frontend"
                class="w-28 text-sm"
              />
              <Input
                v-model="svc.command"
                placeholder="pnpm dev"
                class="flex-1 font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                @click="removeService(i)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
            <p v-if="services.length === 0" class="text-xs text-muted-foreground">
              No services — you can add them later.
            </p>
          </div>
        </div>

        <!-- Error -->
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button :disabled="submitting" @click="submit">
          {{ submitting ? 'Adding…' : 'Add Project' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
