<script setup lang="ts">
import { ref, watch } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Plus, Trash2, Copy, Check, Loader2, AlertTriangle } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked: number;
}

const keys = ref<ApiKey[]>([]);
const loading = ref(false);
const error = ref('');
const newKeyName = ref('');
const createdKey = ref<string | null>(null);
const copied = ref(false);
const creating = ref(false);
const revokingId = ref<number | null>(null);

async function fetchKeys() {
  loading.value = true;
  error.value = '';
  try {
    const res = await apiFetch('/api/keys');
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    keys.value = data.keys || [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load API keys';
  }
  loading.value = false;
}

async function createKey() {
  if (!newKeyName.value.trim()) return;
  creating.value = true;
  try {
    const res = await apiFetch('/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newKeyName.value.trim() }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Failed to create key');
      return;
    }
    const data = await res.json();
    createdKey.value = data.key;
    newKeyName.value = '';
    fetchKeys();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to create key');
  } finally {
    creating.value = false;
  }
}

async function revokeKey(id: number) {
  revokingId.value = id;
  try {
    const res = await apiFetch(`/api/keys/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'Failed to revoke key');
      return;
    }
    fetchKeys();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to revoke key');
  } finally {
    revokingId.value = null;
  }
}

function copyKey() {
  if (createdKey.value) {
    navigator.clipboard.writeText(createdKey.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }
}

function dismissCreatedKey() {
  createdKey.value = null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

watch(open, (isOpen) => {
  if (isOpen) {
    createdKey.value = null;
    fetchKeys();
  }
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Key class="h-5 w-5" />
          API Keys
        </DialogTitle>
        <DialogDescription>
          Create and manage API keys for programmatic access
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Newly created key banner -->
        <div v-if="createdKey" class="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <div class="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
            <AlertTriangle class="h-4 w-4" />
            Save this key — it won't be shown again
          </div>
          <div class="flex items-center gap-2">
            <code class="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{{ createdKey }}</code>
            <Button variant="outline" size="sm" class="h-7 shrink-0 gap-1" @click="copyKey">
              <Check v-if="copied" class="h-3 w-3" />
              <Copy v-else class="h-3 w-3" />
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </div>
          <Button variant="ghost" size="sm" class="mt-2 h-6 text-xs" @click="dismissCreatedKey">Dismiss</Button>
        </div>

        <!-- Create new key -->
        <div class="space-y-2">
          <Label class="text-xs">Create new key</Label>
          <div class="flex gap-2">
            <Input v-model="newKeyName" placeholder="Key name (e.g. CI/CD)" class="h-8 text-sm" @keydown.enter="createKey" />
            <Button size="sm" class="h-8 shrink-0 gap-1" :disabled="creating || !newKeyName.trim()" @click="createKey">
              <Loader2 v-if="creating" class="h-3.5 w-3.5 animate-spin" />
              <Plus v-else class="h-3.5 w-3.5" />
              {{ creating ? 'Creating...' : 'Create' }}
            </Button>
          </div>
        </div>

        <!-- Error -->
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-4">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <!-- Key list -->
        <div v-else-if="keys.length > 0" class="space-y-2">
          <div
            v-for="key in keys"
            :key="key.id"
            class="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            :class="{ 'opacity-50': key.revoked }"
          >
            <Key class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-foreground">{{ key.name }}</span>
                <span v-if="key.revoked" class="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">Revoked</span>
              </div>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <code class="rounded bg-muted px-1">{{ key.key_prefix }}</code>
                <span>Created {{ formatDate(key.created_at) }}</span>
              </div>
            </div>
            <Button
              v-if="!key.revoked"
              variant="ghost"
              size="sm"
              class="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
              :disabled="revokingId === key.id"
              @click="revokeKey(key.id)"
            >
              <Loader2 v-if="revokingId === key.id" class="h-3.5 w-3.5 animate-spin" />
              <Trash2 v-else class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div v-else-if="!loading" class="py-4 text-center text-sm text-muted-foreground">
          No API keys created yet
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
