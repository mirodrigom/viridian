import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { toast } from 'vue-sonner';
import router from './router';
import i18n from './i18n';
import App from './App.vue';
import './style.css';
import { useSettingsStore } from './stores/settings';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// Expose Pinia for E2E test access via page.evaluate()
if (import.meta.env.DEV) {
  (window as any).__pinia = pinia;
}
app.use(router);
app.use(i18n);

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue error]', info, err);
  const message = err instanceof Error ? err.message : String(err);
  toast.error(message.length > 80 ? message.slice(0, 80) + '...' : message);
};

// Init settings (dark mode, etc.) before mounting
useSettingsStore().init();

app.mount('#app');
