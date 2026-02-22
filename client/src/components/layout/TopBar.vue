<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useRouter } from 'vue-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ViridianLogo from '@/components/icons/ViridianLogo.vue';
import {
  TerminalSquare, Settings, LogOut, FolderOpen,
  Loader2, Moon, Sun, Wrench,
} from 'lucide-vue-next';

const auth = useAuthStore();
const chat = useChatStore();
const settings = useSettingsStore();
const router = useRouter();

const emit = defineEmits<{
  toggleTerminal: [];
  openSettings: [];
  openToolsSettings: [];
}>();

function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <header class="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card/50 px-2 md:px-3">
      <!-- Left: Logo + Project -->
      <div class="flex min-w-0 items-center gap-1.5 md:gap-2">
        <div class="flex shrink-0 items-center gap-1.5">
          <ViridianLogo :size="20" />
          <span class="hidden text-sm font-semibold text-foreground sm:inline">Viridian</span>
        </div>

        <Separator orientation="vertical" class="mx-0.5 hidden h-5 sm:block md:mx-1" />

        <Tooltip v-if="chat.projectPath">
          <TooltipTrigger as-child>
            <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" @click="router.push('/')">
              <FolderOpen class="h-3.5 w-3.5 shrink-0" />
              <span class="max-w-24 truncate sm:max-w-48">{{ chat.projectPath?.split('/').pop() }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ chat.projectPath }}</TooltipContent>
        </Tooltip>

        <Badge v-if="chat.isStreaming" variant="secondary" class="gap-1 text-xs">
          <Loader2 class="h-3 w-3 animate-spin" />
          <span class="hidden sm:inline">Streaming</span>
        </Badge>
      </div>

      <!-- Right: Actions -->
      <div class="flex shrink-0 items-center gap-1 md:gap-1">
        <!-- Terminal toggle: hidden on mobile (terminal is force-disabled on mobile) -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="hidden sm:inline-flex h-7 w-7 p-0" @click="emit('toggleTerminal')">
              <TerminalSquare class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle Terminal</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="h-8 w-8 sm:h-7 sm:w-7 p-0" @click="settings.toggleDarkMode()">
              <Sun v-if="settings.darkMode" class="h-4 w-4" />
              <Moon v-else class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle Dark Mode</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" class="mx-0.5 hidden h-5 sm:block md:mx-1" />

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="h-8 w-8 sm:h-7 sm:w-7 p-0" @click="emit('openToolsSettings')">
              <Wrench class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tools Settings</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="h-8 w-8 sm:h-7 sm:w-7 p-0" @click="emit('openSettings')">
              <Settings class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="h-8 w-8 sm:h-7 sm:w-7 p-0" @click="logout">
              <LogOut class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Logout</TooltipContent>
        </Tooltip>
      </div>
    </header>
  </TooltipProvider>
</template>
