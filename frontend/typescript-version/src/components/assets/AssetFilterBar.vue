<script setup lang="ts">
import { useAssetStore, type AssetKind } from '@/stores/useAssetStore'

const store = useAssetStore()

const statusOptions = [
  { title: 'Tất cả trạng thái', value: 'ALL' },
  { title: 'Sẵn sàng cấp phát', value: 'AVAILABLE' },
  { title: 'Đang sử dụng', value: 'ACTIVE' },
  { title: 'Đang bảo trì', value: 'MAINTENANCE' },
  { title: 'Chờ kích hoạt', value: 'PENDING_ACTIVATION' },
  { title: 'Hết hạn bản quyền', value: 'EXPIRED' },
  { title: 'Tạm khóa', value: 'SUSPENDED' },
]

const kindOptions: { title: string; value: 'ALL' | AssetKind }[] = [
  { title: 'Tất cả phân loại', value: 'ALL' },
  { title: 'Thiết bị Hữu hình (Physical)', value: 'PHYSICAL' },
  { title: 'Tài nguyên Số (Digital)', value: 'DIGITAL' },
]
</script>

<template>
  <v-card class="pa-4 rounded-lg mb-4" border>
    <v-row dense class="align-center">
      <!-- Search Input -->
      <v-col cols="12" md="4">
        <v-text-field
          v-model="store.searchQuery"
          placeholder="Tìm theo mã, tên, provider, nhân sự..."
          prepend-inner-icon="ri-search-line"
          density="compact"
          variant="outlined"
          hide-details
          clearable
        />
      </v-col>

      <!-- Phân loại -->
      <v-col cols="12" sm="6" md="3">
        <v-select
          v-model="store.selectedKind"
          :items="kindOptions"
          item-title="title"
          item-value="value"
          label="Phân loại tài sản"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="ri-filter-line"
        />
      </v-col>

      <!-- Trạng thái -->
      <v-col cols="12" sm="6" md="3">
        <v-select
          v-model="store.selectedStatus"
          :items="statusOptions"
          item-title="title"
          item-value="value"
          label="Trạng thái"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="ri-pulse-line"
        />
      </v-col>

      <!-- Provider (nếu xem Digital) -->
      <v-col cols="12" sm="6" md="2" v-if="store.selectedKind !== 'PHYSICAL'">
        <v-select
          v-model="store.selectedProvider"
          :items="store.providerOptions"
          label="Provider"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="ri-global-line"
        />
      </v-col>
    </v-row>
  </v-card>
</template>

