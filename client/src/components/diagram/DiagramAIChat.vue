<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDiagramAI, type AIMessage, type AIAttachment, type SendPromptAttachments } from '@/composables/diagram/useDiagramAI';
import { useDiagramsStore } from '@/stores/diagrams';
import { renderMarkdown } from '@/lib/markdown';
import { Sparkles, Send, X, Minus, Trash2, Check, Loader2, Square, LayoutDashboard, Paperclip, Image, FileText } from 'lucide-vue-next';

const props = defineProps<{
  fitView: () => void;
}>();

const diagrams = useDiagramsStore();
const ai = useDiagramAI();

const isOpen = ref(false);
const isMinimized = ref(false);
const inputText = ref('');
const inputRef = ref<HTMLTextAreaElement>();
const scrollRef = ref<HTMLDivElement>();
const fileInputRef = ref<HTMLInputElement>();

// ─── File attachment state ─────────────────────────────────────────────
const pendingAttachment = ref<{
  type: 'image' | 'html';
  name: string;
  dataUrl?: string;      // base64 data URL for images
  htmlContent?: string;  // text content for HTML files
  thumbnail?: string;    // small preview URL for images
} | null>(null);

// True from the moment sendMessage() is called until stream_start fires (or an
// error is received). This gives us a loading indicator before the first delta.
const isPending = ref(false);

// Whether the UI should be blocked: either we're waiting for the server to
// acknowledge the request, or the stream is actively flowing.
const isBusy = computed(() => isPending.value || ai.isStreaming.value);

// Send is allowed when there's text or an attachment (and we're connected / not busy)
const canSend = computed(() =>
  (inputText.value.trim() || pendingAttachment.value) && ai.connected.value && !isBusy.value,
);

onMounted(() => {
  ai.init();
});

// Clear isPending as soon as the composable flips isStreaming to true (stream_start)
// or when a new assistant message appears at the end of the list (covers errors too).
watch(ai.isStreaming, (streaming) => {
  if (streaming) {
    isPending.value = false;
  }
});

watch(
  () => {
    const last = ai.messages.value[ai.messages.value.length - 1];
    return last?.role === 'assistant' ? last.id : null;
  },
  () => {
    // A new assistant message was added (stream_start or error path)
    isPending.value = false;
  },
);

function toggle() {
  if (isOpen.value) {
    isOpen.value = false;
    isMinimized.value = false;
  } else {
    isOpen.value = true;
    isMinimized.value = false;
    nextTick(() => inputRef.value?.focus());
  }
}

function minimize() {
  isMinimized.value = !isMinimized.value;
}

function openFileDialog() {
  fileInputRef.value?.click();
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  // Reset input so the same file can be re-selected
  input.value = '';

  const isImage = file.type.startsWith('image/');
  const isHtml = file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/html';

  if (!isImage && !isHtml) {
    // Unsupported file type — ignore silently
    return;
  }

  if (isImage) {
    // Max 10MB for images
    if (file.size > 10 * 1024 * 1024) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      pendingAttachment.value = {
        type: 'image',
        name: file.name,
        dataUrl,
        thumbnail: dataUrl,
      };
    };
    reader.readAsDataURL(file);
  } else {
    // HTML file — read as text
    if (file.size > 2 * 1024 * 1024) return; // Max 2MB for HTML

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      // Extract visible text from the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      // Remove script and style tags
      doc.querySelectorAll('script, style').forEach(el => el.remove());
      const textContent = doc.body?.textContent?.trim() || text;

      pendingAttachment.value = {
        type: 'html',
        name: file.name,
        htmlContent: textContent,
      };
    };
    reader.readAsText(file);
  }
}

function clearAttachment() {
  pendingAttachment.value = null;
}

function sendMessage() {
  const text = inputText.value.trim();
  const attachment = pendingAttachment.value;

  if (!text && !attachment) return;
  if (ai.isStreaming.value) {
    // If somehow stuck in streaming state, abort and let the user retry
    ai.abort();
    return;
  }

  // Default prompt when only an attachment is provided
  const prompt = text || 'Recreate this as an AWS architecture diagram';

  // Build attachments payload
  let attachments: SendPromptAttachments | undefined;
  if (attachment) {
    const aiAttachment: AIAttachment = {
      type: attachment.type,
      name: attachment.name,
      thumbnail: attachment.thumbnail,
    };
    attachments = { attachment: aiAttachment };

    if (attachment.type === 'image' && attachment.dataUrl) {
      attachments.images = [{ name: attachment.name, dataUrl: attachment.dataUrl }];
    } else if (attachment.type === 'html' && attachment.htmlContent) {
      attachments.htmlContent = attachment.htmlContent;
    }
  }

  inputText.value = '';
  pendingAttachment.value = null;
  isPending.value = true;
  ai.sendPrompt(prompt, attachments);
}

function applyCommands(msg: AIMessage) {
  ai.applyCommands(msg.id, diagrams, props.fitView);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Strip diagram-commands blocks then render as markdown HTML.
function renderedContent(content: string): string {
  const stripped = content.replace(/```diagram-commands\s*\n[\s\S]*?```/g, '').trim();
  if (!stripped) return '';
  return renderMarkdown(stripped);
}

// Auto-scroll on new messages
watch(
  () => ai.messages.value.length > 0 ? ai.messages.value[ai.messages.value.length - 1]?.content : '',
  () => {
    nextTick(() => {
      if (scrollRef.value) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
      }
    });
  },
);

defineExpose({
  openWithPrompt(prompt: string) {
    isOpen.value = true;
    isMinimized.value = false;
    nextTick(() => {
      ai.sendPrompt(prompt);
    });
  },
});
</script>

<template>
  <div class="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
    <!-- Chat panel -->
    <Transition name="scale">
      <div
        v-if="isOpen"
        class="flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        :class="isMinimized ? 'h-12 w-[360px]' : 'h-[520px] w-[360px]'"
      >
        <!-- Header -->
        <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <Sparkles class="h-4 w-4 text-primary" />
          <span class="flex-1 text-sm font-medium">AI Architect</span>
          <Button
            variant="ghost" size="sm" class="h-7 w-7 p-0"
            title="Re-layout diagram"
            :disabled="diagrams.nodes.length === 0"
            @click="ai.reLayout(props.fitView)"
          >
            <LayoutDashboard class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm" class="h-7 w-7 p-0"
            title="Clear"
            @click="ai.clearMessages()"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="minimize">
            <Minus class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="toggle">
            <X class="h-3.5 w-3.5" />
          </Button>
        </div>

        <!-- Messages -->
        <div v-if="!isMinimized" ref="scrollRef" class="flex-1 overflow-y-auto p-3 space-y-3">
          <!-- Empty state -->
          <div v-if="ai.messages.value.length === 0" class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Sparkles class="h-8 w-8 opacity-50" />
            <p class="text-center text-sm">
              Describe an AWS architecture and I'll generate the diagram for you.
            </p>
            <div class="flex flex-col gap-1.5 text-xs">
              <button
                class="rounded-md border border-border px-3 py-1.5 text-left hover:bg-accent transition-colors"
                @click="inputText = 'Create a serverless API with API Gateway, Lambda, and DynamoDB'"
              >
                Serverless API with Lambda + DynamoDB
              </button>
              <button
                class="rounded-md border border-border px-3 py-1.5 text-left hover:bg-accent transition-colors"
                @click="inputText = 'Web app with CloudFront, ALB, EC2 in a VPC with public/private subnets, and RDS'"
              >
                Web app with CloudFront, ALB, EC2, RDS
              </button>
              <button
                class="rounded-md border border-border px-3 py-1.5 text-left hover:bg-accent transition-colors"
                @click="inputText = 'EKS cluster with ECR, S3 for storage, and CloudWatch monitoring'"
              >
                EKS cluster with ECR + S3 + monitoring
              </button>
            </div>
          </div>

          <!-- Message list -->
          <template v-for="msg in ai.messages.value" :key="msg.id">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div class="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                <!-- Attachment indicator -->
                <div v-if="msg.attachment" class="mb-1 flex items-center gap-1.5 text-xs opacity-80">
                  <Image v-if="msg.attachment.type === 'image'" class="h-3 w-3" />
                  <FileText v-else class="h-3 w-3" />
                  <span>{{ msg.attachment.name }}</span>
                </div>
                <!-- Image thumbnail -->
                <img
                  v-if="msg.attachment?.type === 'image' && msg.attachment.thumbnail"
                  :src="msg.attachment.thumbnail"
                  :alt="msg.attachment.name"
                  class="mb-1.5 max-h-24 rounded border border-primary-foreground/20 object-cover"
                />
                {{ msg.content }}
              </div>
            </div>

            <!-- Assistant message -->
            <div v-else class="flex flex-col gap-2">
              <div
                class="prose prose-sm dark:prose-invert max-w-[95%] rounded-lg bg-muted px-3 py-2 text-sm"
                v-html="renderedContent(msg.content) || '<span class=\'text-muted-foreground\'>...</span>'"
              />

              <!-- Apply commands button -->
              <div v-if="msg.commands?.length && !msg.applied" class="flex items-center gap-2">
                <Button size="sm" class="h-7 gap-1.5 text-xs" @click="applyCommands(msg)">
                  <Sparkles class="h-3 w-3" />
                  Apply {{ msg.commands.length }} commands
                </Button>
              </div>
              <div v-else-if="msg.applied" class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check class="h-3 w-3 text-green-500" />
                Applied to diagram
              </div>
            </div>
          </template>

          <!-- Thinking indicator: visible from send until stream ends -->
          <div v-if="isBusy" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="h-3 w-3 animate-spin" />
            Thinking...
          </div>
        </div>

        <!-- Input -->
        <div v-if="!isMinimized" class="shrink-0 border-t border-border p-2">
          <!-- Pending attachment preview -->
          <div v-if="pendingAttachment" class="mb-2 flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
            <!-- Image thumbnail -->
            <img
              v-if="pendingAttachment.type === 'image' && pendingAttachment.thumbnail"
              :src="pendingAttachment.thumbnail"
              :alt="pendingAttachment.name"
              class="h-8 w-8 rounded border border-border object-cover"
            />
            <Image v-else-if="pendingAttachment.type === 'image'" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <FileText v-else class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate text-xs text-foreground">{{ pendingAttachment.name }}</span>
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              @click="clearAttachment"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="flex items-end gap-1.5">
            <!-- Attach button -->
            <Button
              variant="ghost"
              size="sm"
              class="h-8 w-8 shrink-0 p-0"
              title="Attach image or HTML file"
              :disabled="isBusy"
              @click="openFileDialog"
            >
              <Paperclip class="h-3.5 w-3.5" />
            </Button>
            <input
              ref="fileInputRef"
              type="file"
              class="hidden"
              accept="image/*,.html,.htm"
              @change="handleFileSelect"
            />

            <textarea
              ref="inputRef"
              v-model="inputText"
              rows="1"
              class="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Describe your architecture..."
              :disabled="isBusy"
              @keydown="onKeydown"
            />
            <Button
              v-if="ai.isStreaming.value"
              size="sm"
              variant="destructive"
              class="h-8 w-8 shrink-0 p-0"
              @click="ai.abort()"
            >
              <Square class="h-3.5 w-3.5" />
            </Button>
            <Button
              v-else
              size="sm"
              class="h-8 w-8 shrink-0 p-0"
              :disabled="!canSend"
              @click="sendMessage"
            >
              <Send class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toggle button -->
    <Button
      v-if="!isOpen"
      class="h-11 w-11 rounded-full shadow-lg"
      @click="toggle"
    >
      <Sparkles class="h-5 w-5" />
    </Button>
  </div>
</template>

<style scoped>
.scale-enter-active,
.scale-leave-active {
  transition: all 0.2s ease;
  transform-origin: bottom right;
}
.scale-enter-from,
.scale-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
