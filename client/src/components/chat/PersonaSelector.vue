<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { usePersonasStore, type Persona } from '@/stores/personas';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Bot, SearchCode, Building2, Palette, Container, BookOpen, BarChart3,
  ShieldCheck, GraduationCap, User, ChevronDown,
} from 'lucide-vue-next';

const personaStore = usePersonasStore();
const showMenu = ref(false);

// Map icon names to components
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

function getIcon(iconName: string) {
  return iconMap[iconName] || Bot;
}

function selectPersona(persona: Persona | null) {
  if (persona) {
    personaStore.setActivePersona(persona.id);
  } else {
    personaStore.clearActivePersona();
  }
  showMenu.value = false;
}

function toggleMenu() {
  showMenu.value = !showMenu.value;
}

// Close on outside click
function handleGlobalClick() {
  showMenu.value = false;
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick);
  if (personaStore.personas.length === 0) {
    personaStore.fetchPersonas();
  }
});

import { onUnmounted } from 'vue';
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
});

const hasActivePersona = computed(() => !!personaStore.activePersona);
</script>

<template>
  <div class="relative">
    <TooltipProvider :delay-duration="400">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 rounded-lg px-1.5 transition-colors gap-1"
            :class="hasActivePersona
              ? 'text-foreground hover:opacity-80'
              : 'text-muted-foreground hover:text-foreground'"
            :style="hasActivePersona && personaStore.activePersona
              ? { backgroundColor: personaStore.activePersona.color + '18', color: personaStore.activePersona.color }
              : {}"
            @click.stop="toggleMenu"
          >
            <component
              :is="hasActivePersona && personaStore.activePersona
                ? getIcon(personaStore.activePersona.icon)
                : User"
              class="h-4 w-4"
            />
            <span
              v-if="hasActivePersona && personaStore.activePersona"
              class="text-[10px] font-medium hidden sm:inline max-w-20 truncate"
            >
              {{ personaStore.activePersona.name }}
            </span>
            <ChevronDown v-if="!hasActivePersona" class="h-3 w-3 opacity-50" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" class="text-xs">
          {{ hasActivePersona && personaStore.activePersona
            ? `Persona: ${personaStore.activePersona.name} (click to change)`
            : 'Select a persona' }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Persona dropdown menu -->
    <Transition name="scale-fade">
      <div
        v-if="showMenu"
        class="absolute bottom-full right-0 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg z-20"
        @click.stop
      >
        <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border flex items-center justify-between">
          <span>Personas</span>
          <button
            v-if="hasActivePersona"
            class="text-[10px] font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground transition-colors"
            @click="selectPersona(null)"
          >
            Clear
          </button>
        </div>

        <div class="max-h-72 overflow-y-auto">
          <!-- No persona option -->
          <button
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
            :class="!hasActivePersona
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
            @click="selectPersona(null)"
          >
            <Bot class="h-4 w-4 shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium">Default Assistant</div>
              <div class="text-[10px] text-muted-foreground leading-tight truncate">No persona — standard behavior</div>
            </div>
            <span v-if="!hasActivePersona" class="text-primary text-xs">&#10003;</span>
          </button>

          <!-- Built-in personas -->
          <div v-if="personaStore.builtinPersonas.length > 0">
            <div class="px-3 py-1 text-[10px] font-medium text-muted-foreground bg-muted/20 border-t border-border">
              Built-in
            </div>
            <button
              v-for="persona in personaStore.builtinPersonas"
              :key="persona.id"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
              :class="personaStore.activePersonaId === persona.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
              @click="selectPersona(persona)"
            >
              <component
                :is="getIcon(persona.icon)"
                class="h-4 w-4 shrink-0"
                :style="{ color: persona.color }"
              />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium">{{ persona.name }}</div>
                <div class="text-[10px] text-muted-foreground leading-tight truncate">{{ persona.description }}</div>
              </div>
              <span v-if="personaStore.activePersonaId === persona.id" class="text-primary text-xs">&#10003;</span>
            </button>
          </div>

          <!-- Custom personas -->
          <div v-if="personaStore.customPersonas.length > 0">
            <div class="px-3 py-1 text-[10px] font-medium text-muted-foreground bg-muted/20 border-t border-border">
              Custom
            </div>
            <button
              v-for="persona in personaStore.customPersonas"
              :key="persona.id"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
              :class="personaStore.activePersonaId === persona.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'"
              @click="selectPersona(persona)"
            >
              <component
                :is="getIcon(persona.icon)"
                class="h-4 w-4 shrink-0"
                :style="{ color: persona.color }"
              />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium">{{ persona.name }}</div>
                <div class="text-[10px] text-muted-foreground leading-tight truncate">{{ persona.description }}</div>
              </div>
              <span v-if="personaStore.activePersonaId === persona.id" class="text-primary text-xs">&#10003;</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
