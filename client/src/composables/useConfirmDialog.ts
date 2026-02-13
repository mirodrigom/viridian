import { ref } from 'vue';

const isOpen = ref(false);
const title = ref('');
const description = ref('');
let resolvePromise: ((value: boolean) => void) | null = null;

export function useConfirmDialog() {
  function confirm(opts: { title: string; description: string }): Promise<boolean> {
    title.value = opts.title;
    description.value = opts.description;
    isOpen.value = true;
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  }

  function handleConfirm() {
    isOpen.value = false;
    resolvePromise?.(true);
    resolvePromise = null;
  }

  function handleCancel() {
    isOpen.value = false;
    resolvePromise?.(false);
    resolvePromise = null;
  }

  return { isOpen, title, description, confirm, handleConfirm, handleCancel };
}
