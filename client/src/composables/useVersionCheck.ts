import { ref, onMounted, onUnmounted } from 'vue';

const GITHUB_REPO = 'mirodrigom/claude-code-web';
const CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const DISMISSED_KEY = 'version-update-dismissed';

export function useVersionCheck() {
  const currentVersion = ref('');
  const latestVersion = ref('');
  const updateAvailable = ref(false);
  const dismissed = ref(false);

  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchCurrentVersion() {
    try {
      const res = await fetch('/api/version');
      if (res.ok) {
        const data = await res.json();
        currentVersion.value = data.version || '';
      }
    } catch { /* ignore */ }
  }

  async function checkForUpdates() {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github.v3+json' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      const tag = (data.tag_name || '').replace(/^v/, '');
      if (!tag || !currentVersion.value) return;

      latestVersion.value = tag;
      if (tag !== currentVersion.value && isNewer(tag, currentVersion.value)) {
        const dismissedVer = localStorage.getItem(DISMISSED_KEY);
        if (dismissedVer === tag) {
          dismissed.value = true;
        } else {
          updateAvailable.value = true;
        }
      }
    } catch { /* silently fail - private repo or no releases */ }
  }

  function isNewer(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return true;
      if (na < nb) return false;
    }
    return false;
  }

  function dismiss() {
    dismissed.value = true;
    updateAvailable.value = false;
    if (latestVersion.value) {
      localStorage.setItem(DISMISSED_KEY, latestVersion.value);
    }
  }

  onMounted(async () => {
    await fetchCurrentVersion();
    await checkForUpdates();
    timer = setInterval(checkForUpdates, CHECK_INTERVAL);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    dismiss,
  };
}
