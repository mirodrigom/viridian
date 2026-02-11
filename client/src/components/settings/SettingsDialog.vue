<script setup lang="ts">
import { useSettingsStore, MODEL_OPTIONS, PERMISSION_OPTIONS } from '@/stores/settings';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const settings = useSettingsStore();

const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Configure your Claude Code Web preferences</DialogDescription>
      </DialogHeader>

      <div class="space-y-5 py-4">
        <!-- Appearance -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Appearance</h4>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Dark Mode</Label>
              <Switch :checked="settings.darkMode" @update:checked="settings.toggleDarkMode" />
            </div>
            <div class="flex items-center justify-between">
              <Label>Editor Font Size</Label>
              <Select :model-value="String(settings.fontSize)" @update:model-value="(v: any) => { settings.fontSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="11">11px</SelectItem>
                  <SelectItem value="12">12px</SelectItem>
                  <SelectItem value="13">13px</SelectItem>
                  <SelectItem value="14">14px</SelectItem>
                  <SelectItem value="16">16px</SelectItem>
                  <SelectItem value="18">18px</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        <!-- Claude Settings -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Claude</h4>
          <div class="space-y-4">
            <div class="space-y-2">
              <Label>Model</Label>
              <Select :model-value="settings.model" @update:model-value="(v: any) => { settings.model = v; settings.save(); }">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
                    {{ m.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label>Permission Mode</Label>
              <Select :model-value="settings.permissionMode" @update:model-value="(v: any) => { settings.permissionMode = v; settings.save(); }">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in PERMISSION_OPTIONS" :key="p.value" :value="p.value">
                    {{ p.icon }} {{ p.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <Label>Max Context Window</Label>
              <Select :model-value="String(settings.maxTokens)" @update:model-value="(v: any) => { settings.maxTokens = Number(v); settings.save(); }">
                <SelectTrigger class="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100000">100k tokens</SelectItem>
                  <SelectItem value="128000">128k tokens</SelectItem>
                  <SelectItem value="200000">200k tokens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        <!-- Editor Settings -->
        <div>
          <h4 class="mb-3 text-xs font-medium uppercase text-muted-foreground">Editor</h4>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Font Size</Label>
              <Select :model-value="String(settings.editorFontSize)" @update:model-value="(v: any) => { settings.editorFontSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="11">11px</SelectItem>
                  <SelectItem value="12">12px</SelectItem>
                  <SelectItem value="13">13px</SelectItem>
                  <SelectItem value="14">14px</SelectItem>
                  <SelectItem value="16">16px</SelectItem>
                  <SelectItem value="18">18px</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex items-center justify-between">
              <Label>Tab Size</Label>
              <Select :model-value="String(settings.editorTabSize)" @update:model-value="(v: any) => { settings.editorTabSize = Number(v); settings.save(); }">
                <SelectTrigger class="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 spaces</SelectItem>
                  <SelectItem value="4">4 spaces</SelectItem>
                  <SelectItem value="8">8 spaces</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex items-center justify-between">
              <Label>Word Wrap</Label>
              <Switch :checked="settings.editorWordWrap" @update:checked="(v: boolean) => { settings.editorWordWrap = v; settings.save(); }" />
            </div>
            <div class="flex items-center justify-between">
              <Label>Line Numbers</Label>
              <Switch :checked="settings.editorShowLineNumbers" @update:checked="(v: boolean) => { settings.editorShowLineNumbers = v; settings.save(); }" />
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
