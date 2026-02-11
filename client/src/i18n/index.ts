import { createI18n } from 'vue-i18n';
import en from './locales/en';
import zh from './locales/zh';
import ko from './locales/ko';

export type SupportedLocale = 'en' | 'zh' | 'ko';

export const LOCALE_OPTIONS: { value: SupportedLocale; label: string; nativeLabel: string }[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'zh', label: 'Chinese', nativeLabel: '中文' },
  { value: 'ko', label: 'Korean', nativeLabel: '한국어' },
];

const savedLocale = (localStorage.getItem('locale') as SupportedLocale) || 'en';

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, zh, ko },
});

export function setLocale(locale: SupportedLocale) {
  (i18n.global.locale as any).value = locale;
  localStorage.setItem('locale', locale);
  document.documentElement.lang = locale;
}

export default i18n;
