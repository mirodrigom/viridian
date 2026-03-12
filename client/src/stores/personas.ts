import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '../lib/apiFetch';

export interface Persona {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  systemPrompt: string;
  suggestedTools: string[];
  isBuiltin: boolean;
  createdAt: string;
}

export const usePersonasStore = defineStore('personas', () => {
  const personas = ref<Persona[]>([]);
  const activePersonaId = ref<string | null>(null);
  const loading = ref(false);

  const activePersona = computed(() =>
    activePersonaId.value
      ? personas.value.find(p => p.id === activePersonaId.value) ?? null
      : null,
  );

  const builtinPersonas = computed(() =>
    personas.value.filter(p => p.isBuiltin),
  );

  const customPersonas = computed(() =>
    personas.value.filter(p => !p.isBuiltin),
  );

  async function fetchPersonas() {
    loading.value = true;
    try {
      const res = await apiFetch('/api/personas');
      if (res.ok) {
        const data = await res.json();
        personas.value = data.personas;
      }
    } catch (err) {
      console.warn('[personas] Failed to fetch personas:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createPersona(persona: Omit<Persona, 'id' | 'isBuiltin' | 'createdAt'>): Promise<Persona | null> {
    try {
      const res = await apiFetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persona),
      });
      if (res.ok) {
        const data = await res.json();
        personas.value.push(data.persona);
        return data.persona;
      }
    } catch (err) {
      console.warn('[personas] Failed to create persona:', err);
    }
    return null;
  }

  async function updatePersona(id: string, updates: Partial<Omit<Persona, 'id' | 'isBuiltin' | 'createdAt'>>): Promise<Persona | null> {
    try {
      const res = await apiFetch(`/api/personas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        const idx = personas.value.findIndex(p => p.id === id);
        if (idx >= 0) personas.value[idx] = data.persona;
        return data.persona;
      }
    } catch (err) {
      console.warn('[personas] Failed to update persona:', err);
    }
    return null;
  }

  async function deletePersona(id: string): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/personas/${id}`, { method: 'DELETE' });
      if (res.ok) {
        personas.value = personas.value.filter(p => p.id !== id);
        if (activePersonaId.value === id) activePersonaId.value = null;
        return true;
      }
    } catch (err) {
      console.warn('[personas] Failed to delete persona:', err);
    }
    return false;
  }

  function setActivePersona(id: string | null) {
    activePersonaId.value = id;
  }

  function clearActivePersona() {
    activePersonaId.value = null;
  }

  return {
    personas,
    activePersonaId,
    activePersona,
    builtinPersonas,
    customPersonas,
    loading,
    fetchPersonas,
    createPersona,
    updatePersona,
    deletePersona,
    setActivePersona,
    clearActivePersona,
  };
});
