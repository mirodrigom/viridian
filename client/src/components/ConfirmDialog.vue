<script setup lang="ts">
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const { isOpen, title, description, handleConfirm, handleCancel } = useConfirmDialog();
</script>

<template>
  <Dialog :open="isOpen" @update:open="(v) => { if (!v) handleCancel() }">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" size="sm" @click="handleCancel">Cancel</Button>
        <Button variant="destructive" size="sm" @click="handleConfirm">Confirm</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
