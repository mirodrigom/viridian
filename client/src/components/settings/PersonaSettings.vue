<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { usePersonasStore, type Persona } from '@/stores/personas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Bot, SearchCode, Building2, Palette, Container, BookOpen, BarChart3,
  ShieldCheck, GraduationCap, User, Plus, Pencil, Trash2, Check,
} from 'lucide-vue-next';

const personaStore = usePersonasStore();

const showDialog = ref(false);
const editingPersona = ref<Persona | null>(null);
const form = ref({
  name: '',
  description: '',
  icon: 'Bot',
  color: '#6366f1',
  systemPrompt: '',
  suggestedTools: '' as string,
});
const saving = ref(false);

const iconMap: Record<string, unknown> = {
  Bot,
  SearchCode,
  Building2,
  Palette,
  Container,
  BookOpen,
  BarChart3,
  ShieldCheck,
  GraduationCap,
  User,
};

const availableIcons = Object.keys(iconMap);

const availableColors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#dc2626', '#a855f7',
];

function getIcon(iconName: string) {
  return iconMap[iconName] || Bot;
}

function openNew() {
  editingPersona.value = null;
  form.value = { name: '', description: '', icon: 'Bot', color: '#6366f1', systemPrompt: '', suggestedTools: '' };
  showDialog.value = true;
}

function openEdit(persona: Persona) {
  editingPersona.value = persona;
  form.value = {
    name: persona.name,
    description: persona.description,
    icon: persona.icon,
    color: persona.color,
    systemPrompt: persona.systemPrompt,
    suggestedTools: persona.suggestedTools.join(', '),
  };
  showDialog.value = true;
}

async function save() {
  saving.value = true;
  try {
    const tools = form.value.suggestedTools
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    if (editingPersona.value) {
      await personaStore.updatePersona(editingPersona.value.id, {
        name: form.value.name,
        description: form.value.description,
        icon: form.value.icon,
        color: form.value.color,
        systemPrompt: form.value.systemPrompt,
        suggestedTools: tools,
      });
    } else {
      await personaStore.createPersona({
        name: form.value.name,
        description: form.value.description,
        icon: form.value.icon,
        color: form.value.color,
        systemPrompt: form.value.systemPrompt,
        suggestedTools: tools,
      });
    }
    showDialog.value = false;
  } finally {
    saving.value = false;
  }
}

async function remove(persona: Persona) {
  if (confirm(`Delete "${persona.name}"?`)) {
    await personaStore.deletePersona(persona.id);
  }
}

onMounted(() => {
  if (personaStore.personas.length === 0) {
    personaStore.fetchPersonas();
  }
});
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-xs font-medium uppercase text-muted-foreground">Assistants</h4>
      <Button variant="outline" size="sm" class="h-7 gap-1 text-xs" @click="openNew">
        <Plus class="h-3 w-3" />
        New
      </Button>
    </div>

    <p class="text-xs text-muted-foreground mb-3">
      Personas change the AI's behavior by prepending custom instructions to your messages.
    </p>

    <!-- Persona list -->
    <div class="space-y-1.5">
      <div
        v-for="persona in personaStore.personas"
        :key="persona.id"
        class="group flex items-center gap-2.5 rounded-md border border-border p-2 hover:bg-accent/30 transition-colors"
      >
        <component
          :is="getIcon(persona.icon)"
          class="h-5 w-5 shrink-0"
          :style="{ color: persona.color }"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium truncate">{{ persona.name }}</span>
            <span
              v-if="persona.isBuiltin"
              class="text-[9px] font-medium uppercase px-1 py-0.5 rounded bg-muted text-muted-foreground"
            >
              built-in
            </span>
            <span
              v-if="personaStore.activePersonaId === persona.id"
              class="text-[9px] font-medium uppercase px-1 py-0.5 rounded bg-primary/10 text-primary"
            >
              active
            </span>
          </div>
          <div class="text-[11px] text-muted-foreground truncate">{{ persona.description }}</div>
        </div>
        <div class="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            class="rounded p-1 hover:bg-muted"
            title="Edit"
            @click="openEdit(persona)"
          >
            <Pencil class="h-3 w-3" />
          </button>
          <button
            v-if="!persona.isBuiltin"
            class="rounded p-1 hover:bg-destructive/20 hover:text-destructive"
            title="Delete"
            @click="remove(persona)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>

      <div v-if="personaStore.personas.length === 0 && !personaStore.loading" class="text-center py-4 text-xs text-muted-foreground">
        No personas yet. Create one to get started.
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="showDialog">
      <DialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingPersona ? 'Edit Persona' : 'New Persona' }}</DialogTitle>
          <DialogDescription>
            {{ editingPersona ? 'Modify this persona\'s behavior and appearance.' : 'Create a custom assistant persona with specialized behavior.' }}
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="save">
          <div class="space-y-1.5">
            <Label class="text-xs">Name</Label>
            <Input v-model="form.name" placeholder="e.g. Python Expert" class="h-8 text-sm" />
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs">Description</Label>
            <Input v-model="form.description" placeholder="Brief description of the persona" class="h-8 text-sm" />
          </div>

          <!-- Icon picker -->
          <div class="space-y-1.5">
            <Label class="text-xs">Icon</Label>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="iconName in availableIcons"
                :key="iconName"
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                :class="form.icon === iconName
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-accent/50'"
                @click="form.icon = iconName"
              >
                <component :is="getIcon(iconName)" class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- Color picker -->
          <div class="space-y-1.5">
            <Label class="text-xs">Color</Label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="color in availableColors"
                :key="color"
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all"
                :class="form.color === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'"
                :style="{ backgroundColor: color }"
                @click="form.color = color"
              >
                <Check v-if="form.color === color" class="h-3 w-3 text-white" />
              </button>
            </div>
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs">System Prompt</Label>
            <textarea
              v-model="form.systemPrompt"
              placeholder="Instructions that define the persona's behavior..."
              class="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[100px]"
              rows="5"
            />
          </div>

          <div class="space-y-1.5">
            <Label class="text-xs">Suggested Tools (comma-separated)</Label>
            <Input
              v-model="form.suggestedTools"
              placeholder="e.g. Read, Glob, Grep"
              class="h-8 text-sm"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" @click="showDialog = false">Cancel</Button>
            <Button
              type="submit"
              size="sm"
              :disabled="!form.name.trim() || !form.systemPrompt.trim() || saving"
            >
              {{ editingPersona ? 'Save' : 'Create' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
