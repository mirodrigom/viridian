import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'));
  const username = ref<string | null>(localStorage.getItem('username'));

  const isAuthenticated = computed(() => !!token.value);

  async function login(user: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Login failed');
    }
    const data = await res.json();
    token.value = data.token;
    username.value = data.username;
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
  }

  async function register(user: string, password: string) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Registration failed');
    }
    const data = await res.json();
    token.value = data.token;
    username.value = data.username;
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
  }

  function logout() {
    token.value = null;
    username.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
  }

  async function checkStatus(): Promise<{ hasUsers: boolean }> {
    const res = await fetch('/api/auth/status');
    return res.json();
  }

  return { token, username, isAuthenticated, login, register, logout, checkStatus };
});
