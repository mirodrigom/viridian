import { ref, computed, nextTick, onMounted, onUnmounted, type Ref } from 'vue';
import { Bug, Eye, Shield, Zap, Wrench, FileCode, FileText, TestTube, Sparkles } from 'lucide-vue-next';

export interface MessageTemplate {
  id: string;
  name: string;
  text: string;
  category: string;
  icon: any;
  shortcut?: string;
}

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  // Debug category
  { id: 'debug-error', name: 'Debug Error', text: 'Help me debug this error:', category: 'Debug', icon: Bug, shortcut: 'Ctrl+1' },
  { id: 'debug-explain', name: 'Explain Issue', text: 'Explain what\'s causing this issue and how to fix it:', category: 'Debug', icon: Bug },
  { id: 'debug-trace', name: 'Trace Problem', text: 'Help me trace through this code to find the problem:', category: 'Debug', icon: Bug },

  // Code Review category
  { id: 'review-improvements', name: 'Review Code', text: 'Review this code for improvements and best practices:', category: 'Review', icon: Eye, shortcut: 'Ctrl+2' },
  { id: 'review-security', name: 'Security Check', text: 'Check this code for security vulnerabilities:', category: 'Review', icon: Shield },
  { id: 'review-performance', name: 'Performance Review', text: 'Analyze this code for performance issues:', category: 'Review', icon: Zap },

  // Refactoring category
  { id: 'refactor-clean', name: 'Clean Refactor', text: 'Refactor this code to be cleaner and more maintainable:', category: 'Refactor', icon: Wrench, shortcut: 'Ctrl+3' },
  { id: 'refactor-optimize', name: 'Optimize Code', text: 'Optimize this code for better performance:', category: 'Refactor', icon: Zap },
  { id: 'refactor-structure', name: 'Restructure', text: 'Help me restructure this code with better architecture:', category: 'Refactor', icon: Wrench },

  // Documentation category
  { id: 'docs-add', name: 'Add Docs', text: 'Add comprehensive documentation to this code:', category: 'Docs', icon: FileCode, shortcut: 'Ctrl+4' },
  { id: 'docs-explain', name: 'Explain Code', text: 'Explain how this code works in detail:', category: 'Docs', icon: FileText },
  { id: 'docs-comments', name: 'Add Comments', text: 'Add helpful comments to this code:', category: 'Docs', icon: FileCode },

  // Testing category
  { id: 'test-unit', name: 'Unit Tests', text: 'Write comprehensive unit tests for this code:', category: 'Testing', icon: TestTube, shortcut: 'Ctrl+5' },
  { id: 'test-integration', name: 'Integration Tests', text: 'Help me write integration tests for this feature:', category: 'Testing', icon: TestTube },
  { id: 'test-edge-cases', name: 'Edge Cases', text: 'What edge cases should I test for this code?', category: 'Testing', icon: TestTube },
];

const TEMPLATES_KEY = 'chat-message-templates';

export function useMessageTemplates(
  input: Ref<string>,
  textarea: Ref<HTMLTextAreaElement | null>,
  autoResize: () => void,
  resetHistoryNavigation: () => void,
  isNavigatingHistory: Ref<boolean>,
) {
  const showTemplateMenu = ref(false);
  const selectedTemplateIndex = ref(0);
  const templateMenuRef = ref<HTMLElement | null>(null);

  // Template management dialog
  const showTemplateDialog = ref(false);
  const editingTemplate = ref<MessageTemplate | null>(null);
  const templateForm = ref({ name: '', text: '', category: '' });

  function getCustomTemplates(): MessageTemplate[] {
    try {
      const stored = localStorage.getItem(TEMPLATES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  function saveCustomTemplates(templates: MessageTemplate[]) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  const allTemplates = computed(() => {
    const custom = getCustomTemplates();
    return [...DEFAULT_TEMPLATES, ...custom];
  });

  const templateCategories = computed(() => {
    const categories: Record<string, MessageTemplate[]> = {};
    allTemplates.value.forEach(template => {
      if (!categories[template.category]) {
        categories[template.category] = [];
      }
      categories[template.category]!.push(template);
    });
    return categories;
  });

  const customTemplates = computed(() => getCustomTemplates());

  function insertTemplate(template: MessageTemplate) {
    const textToInsert = template.text + (input.value ? ' ' : '');
    const currentValue = input.value;
    const el = textarea.value;

    if (el) {
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;

      // Insert template text at cursor position
      const newValue = currentValue.slice(0, start) + textToInsert + currentValue.slice(end);
      input.value = newValue;

      // Set cursor position after inserted text
      nextTick(() => {
        const newCursorPos = start + textToInsert.length;
        el.setSelectionRange(newCursorPos, newCursorPos);
        el.focus();
        autoResize();
      });
    } else {
      // Fallback: append to input
      input.value = currentValue + (currentValue ? ' ' : '') + textToInsert;
      nextTick(() => {
        autoResize();
        textarea.value?.focus();
      });
    }

    showTemplateMenu.value = false;
    selectedTemplateIndex.value = 0;

    // Reset history navigation if active
    if (isNavigatingHistory.value) {
      resetHistoryNavigation();
    }
  }

  function handleTemplateKeydown(e: KeyboardEvent): boolean {
    if (!showTemplateMenu.value) return false;

    const allTemplatesFlat = Object.values(templateCategories.value).flat();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedTemplateIndex.value = Math.min(selectedTemplateIndex.value + 1, allTemplatesFlat.length - 1);
      return true;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedTemplateIndex.value = Math.max(selectedTemplateIndex.value - 1, 0);
      return true;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const template = allTemplatesFlat[selectedTemplateIndex.value];
      if (template) {
        insertTemplate(template);
      }
      return true;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      showTemplateMenu.value = false;
      selectedTemplateIndex.value = 0;
      return true;
    }

    return false;
  }

  // Handle keyboard shortcuts for templates
  function handleTemplateShortcuts(e: KeyboardEvent): boolean {
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const shortcuts: Record<string, string> = {
        '1': 'debug-error',
        '2': 'review-improvements',
        '3': 'refactor-clean',
        '4': 'docs-add',
        '5': 'test-unit',
      };

      const templateId = shortcuts[e.key];
      if (templateId) {
        const template = allTemplates.value.find(t => t.id === templateId);
        if (template) {
          e.preventDefault();
          insertTemplate(template);
          return true;
        }
      }
    }
    return false;
  }

  // Click outside handler for template menu
  function handleClickOutside(event: MouseEvent) {
    if (showTemplateMenu.value && templateMenuRef.value && !templateMenuRef.value.contains(event.target as Node)) {
      showTemplateMenu.value = false;
      selectedTemplateIndex.value = 0;
    }
  }

  function openNewTemplate() {
    editingTemplate.value = null;
    templateForm.value = { name: '', text: '', category: 'Custom' };
    showTemplateMenu.value = false;
    showTemplateDialog.value = true;
  }

  function openEditTemplate(template: MessageTemplate) {
    editingTemplate.value = template;
    templateForm.value = { name: template.name, text: template.text, category: template.category };
    showTemplateMenu.value = false;
    showTemplateDialog.value = true;
  }

  function saveTemplate() {
    const { name, text, category } = templateForm.value;
    if (!name.trim() || !text.trim()) return;

    const customs = getCustomTemplates();
    if (editingTemplate.value) {
      const idx = customs.findIndex(t => t.id === editingTemplate.value!.id);
      if (idx >= 0) {
        customs[idx] = { ...customs[idx]!, name: name.trim(), text: text.trim(), category: category.trim() || 'Custom' };
      }
    } else {
      customs.push({
        id: `custom-${Date.now()}`,
        name: name.trim(),
        text: text.trim(),
        category: category.trim() || 'Custom',
        icon: Sparkles,
      });
    }
    saveCustomTemplates(customs);
    showTemplateDialog.value = false;
  }

  function deleteTemplate(id: string) {
    const customs = getCustomTemplates().filter(t => t.id !== id);
    saveCustomTemplates(customs);
  }

  function isCustomTemplate(template: MessageTemplate) {
    return template.id.startsWith('custom-');
  }

  // Close template menu when typing
  function closeTemplateMenu() {
    if (showTemplateMenu.value) {
      showTemplateMenu.value = false;
      selectedTemplateIndex.value = 0;
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside);
  });

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  return {
    showTemplateMenu,
    selectedTemplateIndex,
    templateMenuRef,
    showTemplateDialog,
    editingTemplate,
    templateForm,
    allTemplates,
    templateCategories,
    customTemplates,
    insertTemplate,
    handleTemplateKeydown,
    handleTemplateShortcuts,
    openNewTemplate,
    openEditTemplate,
    saveTemplate,
    deleteTemplate,
    isCustomTemplate,
    closeTemplateMenu,
  };
}
