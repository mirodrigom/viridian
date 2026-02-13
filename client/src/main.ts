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
app.use(router);
app.use(i18n);

app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue error:', err, info);
  toast.error('Something went wrong');
};

// Init settings (dark mode, etc.) before mounting
useSettingsStore().init();

app.mount('#app');
