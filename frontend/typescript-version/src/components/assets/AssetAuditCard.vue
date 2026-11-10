<script setup lang="ts">
import type { AssetAuditLog } from '@/stores/useAssetStore'

interface Props {
  logs?: AssetAuditLog[]
}

const props = withDefaults(defineProps<Props>(), {
  logs: () => [],
})

const getActionColor = (action: AssetAuditLog['action']) => {
  switch (action) {
    case 'CREATE': return 'success'
    case 'UPDATE': return 'info'
    case 'ALLOCATE': return 'primary'
    case 'REVOKE': return 'warning'
    case 'STATUS_CHANGE': return 'secondary'
    default: return 'grey'
  }
}

const getActionIcon = (action: AssetAuditLog['action']) => {
  switch (action) {
    case 'CREATE': return 'ri-add-circle-line'
    case 'UPDATE': return 'ri-edit-line'
    case 'ALLOCATE': return 'ri-user-shared-line'
    case 'REVOKE': return 'ri-arrow-go-back-line'
    case 'STATUS_CHANGE': return 'ri-refresh-line'
    default: return 'ri-history-line'
  }
}
</script>

<template>
  <v-card class="rounded-lg pa-4" border>
    <div class="d-flex align-center justify-space-between mb-4">
      <div class="d-flex align-center gap-2">
        <v-icon icon="ri-history-line" color="primary" />
        <span class="text-subtitle-1 font-weight-bold">Nhật ký hoạt động (Audit Trail)</span>
      </div>
      <v-chip size="x-small" color="primary" variant="tonal">
        {{ props.logs.length }} sự kiện
      </v-chip>
    </div>

    <v-timeline density="compact" side="end" truncate-line="both">
      <v-timeline-item
        v-for="log in props.logs"
        :key="log.id"
        :dot-color="getActionColor(log.action)"
        size="x-small"
      >
        <template #icon>
          <v-icon :icon="getActionIcon(log.action)" size="12" />
        </template>
        <div class="d-flex justify-space-between align-center">
          <span class="text-body-2 font-weight-bold">{{ log.actorName }}</span>
          <span class="text-caption text-medium-emphasis">{{ log.timestamp }}</span>
        </div>
        <div class="text-caption text-high-emphasis mt-1">
          {{ log.details }}
        </div>
      </v-timeline-item>
    </v-timeline>

    <div v-if="props.logs.length === 0" class="text-center py-6 text-caption text-disabled">
      Chưa có ghi chép nhật ký nào cho tài sản này.
    </div>
  </v-card>
</template>

<style scoped>
.gap-2 { gap: 8px; }
</style>

