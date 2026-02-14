<script setup lang="ts">
import { computed } from 'vue';
import {
  Brain, Shield, Wrench, Code, Search, HelpCircle, User,
  Layers, Monitor, Server, Route, ShieldAlert, Gauge, Accessibility,
  GitBranch, Box, Database, Globe, FileText, Network, ClipboardList,
  Users, GitPullRequest,
} from 'lucide-vue-next';
import type { AutopilotProfile } from '@/types/autopilot';

const props = defineProps<{
  profile: AutopilotProfile;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const iconMap: Record<string, unknown> = {
  Brain, Shield, Wrench, Code, Search, HelpCircle, User,
  Layers, Monitor, Server, Route, ShieldAlert, Gauge, Accessibility,
  GitBranch, Box, Database, Globe, FileText, Network, ClipboardList,
  Users, GitPullRequest,
};

const roleIcon = computed(() => {
  // Use explicit icon field first
  if (props.profile.icon && iconMap[props.profile.icon]) {
    return iconMap[props.profile.icon];
  }
  // Fallback to role-based mapping (backward compat)
  switch (props.profile.role) {
    case 'analyst': return Brain;
    case 'architect': return Shield;
    case 'qa': return Search;
    case 'feature_creator': return Code;
    case 'reviewer': return Wrench;
    case 'serial_questioner': return HelpCircle;
    case 'fullstack_dev': return Layers;
    case 'frontend_specialist': return Monitor;
    case 'backend_specialist': return Server;
    case 'api_designer': return Route;
    case 'security_auditor': return ShieldAlert;
    case 'performance_tester': return Gauge;
    case 'accessibility_checker': return Accessibility;
    case 'cicd_optimizer': return GitBranch;
    case 'container_specialist': return Box;
    case 'db_optimizer': return Database;
    case 'i18n_specialist': return Globe;
    case 'doc_writer': return FileText;
    case 'multi_agent_coordinator': return Network;
    case 'sprint_planner': return ClipboardList;
    case 'review_team': return Users;
    case 'github_workflow': return GitPullRequest;
    default: return User;
  }
});

const roleColor = computed(() => {
  // Category-based color scheme
  const cat = props.profile.category || 'general';
  switch (cat) {
    case 'development': return 'text-emerald-400 bg-emerald-500/15';
    case 'testing': return 'text-amber-400 bg-amber-500/15';
    case 'devops': return 'text-orange-400 bg-orange-500/15';
    case 'domain': return 'text-cyan-400 bg-cyan-500/15';
    case 'orchestrator': return 'text-violet-400 bg-violet-500/15';
    case 'general':
    default:
      // Fallback to role-specific colors for legacy profiles
      switch (props.profile.role) {
        case 'analyst': return 'text-blue-400 bg-blue-500/15';
        case 'architect': return 'text-purple-400 bg-purple-500/15';
        case 'reviewer': return 'text-amber-400 bg-amber-500/15';
        case 'serial_questioner': return 'text-cyan-400 bg-cyan-500/15';
        default: return 'text-blue-400 bg-blue-500/15';
      }
  }
});

const hasWriteTools = computed(() => {
  const writeTools = ['Write', 'Edit', 'Bash'];
  return props.profile.allowedTools.some(t => writeTools.includes(t));
});

const hasSubagents = computed(() =>
  props.profile.subagents && props.profile.subagents.length > 0,
);

const hasMcp = computed(() =>
  props.profile.mcpServers && props.profile.mcpServers.length > 0,
);
</script>

<template>
  <button
    class="flex items-start gap-3 rounded-lg border p-3 text-left transition-all"
    :class="[
      selected
        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
        : 'border-border hover:border-border/80 hover:bg-muted/30',
    ]"
    @click="emit('select')"
  >
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      :class="roleColor"
    >
      <component :is="roleIcon" class="h-4 w-4" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class="text-sm font-medium">{{ profile.name }}</span>
        <span
          v-if="hasWriteTools"
          class="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-400"
        >
          executor
        </span>
        <span
          v-else
          class="rounded bg-blue-500/15 px-1 text-[10px] text-blue-400"
        >
          thinker
        </span>
        <span
          v-if="hasSubagents"
          class="rounded bg-violet-500/15 px-1 text-[10px] text-violet-400"
        >
          {{ profile.subagents.length }} agents
        </span>
        <span
          v-if="hasMcp"
          class="rounded bg-orange-500/15 px-1 text-[10px] text-orange-400"
        >
          MCP
        </span>
      </div>
      <p class="mt-0.5 text-xs text-muted-foreground line-clamp-2">
        {{ profile.description }}
      </p>
    </div>
  </button>
</template>
