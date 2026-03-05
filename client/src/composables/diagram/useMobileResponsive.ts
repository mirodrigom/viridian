import { ref, onMounted, onUnmounted } from 'vue';

export function useMobileResponsive() {
  const isMobile = ref(false);
  const showMobilePalette = ref(false);

  function onResize() {
    isMobile.value = window.innerWidth < 768;
    if (!isMobile.value) {
      showMobilePalette.value = false;
    }
  }

  onMounted(() => {
    onResize();
    window.addEventListener('resize', onResize);
  });

  onUnmounted(() => {
    window.removeEventListener('resize', onResize);
  });

  return { isMobile, showMobilePalette };
}
