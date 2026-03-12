<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ViridianLogo from '@/components/icons/ViridianLogo.vue';
import { Loader2, User, Lock, UserPlus, LogIn, ShieldAlert } from 'lucide-vue-next';

const auth = useAuthStore();
const router = useRouter();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const isRegister = ref(false);
const needsSetup = ref(false);
const checking = ref(true);
const registrationDisabled = ref(false);

async function checkSetup() {
  try {
    const status = await auth.checkStatus();
    needsSetup.value = !status.hasUsers;
    registrationDisabled.value = status.hasUsers;
    if (needsSetup.value) {
      isRegister.value = true;
    }
  } finally {
    checking.value = false;
  }
}
checkSetup();

async function handleSubmit() {
  error.value = '';
  loading.value = true;
  try {
    if (isRegister.value) {
      await auth.register(username.value, password.value);
    } else {
      await auth.login(username.value, password.value);
    }
    router.push('/');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'An error occurred';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm space-y-6">
      <!-- Logo and title -->
      <div class="text-center">
        <div class="mb-4 flex justify-center">
          <div class="rounded-2xl bg-primary/10 p-3">
            <ViridianLogo :size="40" />
          </div>
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-foreground">Viridian</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ needsSetup ? 'Set up your first account to get started' : 'Sign in to start coding with Claude' }}
        </p>
      </div>

      <Card>
        <CardHeader class="pb-4">
          <CardTitle as="h2" class="flex items-center justify-center gap-2 text-lg">
            <component :is="isRegister ? UserPlus : LogIn" class="h-5 w-5" />
            {{ needsSetup ? 'Initial Setup' : 'Welcome Back' }}
          </CardTitle>
          <CardDescription v-if="needsSetup" class="text-center">
            No users found. Create an admin account to begin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <!-- Loading state while checking setup -->
          <div v-if="checking" class="flex items-center justify-center py-8">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>

          <form v-else @submit.prevent="handleSubmit" class="space-y-4">
            <div class="space-y-2">
              <Label for="username" class="flex items-center gap-1.5">
                <User class="h-3.5 w-3.5 text-muted-foreground" />
                Username
              </Label>
              <Input
                id="username"
                v-model="username"
                :placeholder="needsSetup ? 'e.g. adminUser' : 'Enter username'"
                required
                autocomplete="username"
              />
              <p v-if="needsSetup" class="text-xs text-muted-foreground">
                Use camelCase format (e.g. johnDoe, adminUser)
              </p>
            </div>
            <div class="space-y-2">
              <Label for="password" class="flex items-center gap-1.5">
                <Lock class="h-3.5 w-3.5 text-muted-foreground" />
                Password
              </Label>
              <Input
                id="password"
                v-model="password"
                type="password"
                placeholder="Enter password"
                required
                autocomplete="current-password"
              />
            </div>

            <div v-if="needsSetup" class="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              <ShieldAlert class="h-4 w-4 mt-0.5 shrink-0" />
              <span>This account will have full control over the system. New user registration will be disabled after setup for security.</span>
            </div>

            <p v-if="error" class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {{ error }}
            </p>

            <Button type="submit" class="w-full gap-2" :disabled="loading">
              <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
              <component v-else :is="isRegister ? UserPlus : LogIn" class="h-4 w-4" />
              {{ loading ? 'Please wait...' : (isRegister ? 'Create Account' : 'Sign In') }}
            </Button>
          </form>
        </CardContent>
      </Card>


    </div>
  </main>
</template>
