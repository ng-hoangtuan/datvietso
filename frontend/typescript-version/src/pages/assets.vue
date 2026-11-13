<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAssetStore } from '@/stores/useAssetStore'
import PhysicalAssetTable from '@/components/assets/PhysicalAssetTable.vue'
import DigitalAssetTable from '@/components/assets/DigitalAssetTable.vue'
import EmployeeAssetLookup from '@/components/assets/EmployeeAssetLookup.vue'
import HandoverDrawer from '@/components/assets/HandoverDrawer.vue'

/**
 * Phân hệ Quản lý Tài sản — 3 tab theo đặc tả mục 5.2.
 *
 * Mô hình dữ liệu phía sau là 3 thực thể PhysicalAsset / DigitalAsset /
 * AssetAssignment. Xem Docs/danh-gia-dac-ta-tai-san-so.md để biết những chỗ
 * triển khai lệch khỏi đặc tả và lý do.
 */
const store = useAssetStore()

const tab = ref('physical')
const handoverOpen = ref(false)

onMounted(() => { store.refreshAll() })

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n || 0)
</script>

<template>
  <div>
    <!-- Tiêu đề + hành động chính -->
    <div class="d-flex flex-wrap align-center justify-space-between gap-3 mb-4">
      <div>
        <h4 class="text-h5 font-weight-bold mb-1">Quản lý Tài sản</h4>
        <div class="text-body-2 text-medium-emphasis">
          Thiết bị vật lý, bản quyền phần mềm và tài khoản số
        </div>
      </div>

      <div class="d-flex gap-2">
        <v-btn
          variant="outlined"
          prepend-icon="ri-refresh-line"
          :loading="store.isLoading"
          @click="store.refreshAll()"
        >
          Tải lại
        </v-btn>
        <v-btn
          v-if="store.canManage"
          color="primary"
          prepend-icon="ri-gift-line"
          @click="handoverOpen = true"
        >
          Cấp phát trọn gói
        </v-btn>
      </div>
    </div>

    <!-- Cảnh báo cần xử lý ngay -->
    <v-alert
      v-for="a in store.alerts"
      :key="a.type"
      :type="a.color === 'error' ? 'error' : 'warning'"
      variant="tonal"
      density="comfortable"
      class="mb-3"
      :icon="a.icon"
    >
      <div class="text-body-2">{{ a.text }}</div>
    </v-alert>

    <!-- Thống kê nhanh -->
    <v-row v-if="store.stats" class="mb-2">
      <v-col cols="6" md="3">
        <v-card variant="outlined" class="pa-4 rounded-lg">
          <div class="d-flex align-center gap-3">
            <v-avatar color="primary" variant="tonal" size="40">
              <v-icon icon="ri-computer-line" />
            </v-avatar>
            <div>
              <div class="text-h6 font-weight-bold">{{ store.stats.physical.total }}</div>
              <div class="text-caption text-medium-emphasis">
                thiết bị · {{ store.stats.physical.byStatus.available || 0 }} trong kho
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="outlined" class="pa-4 rounded-lg">
          <div class="d-flex align-center gap-3">
            <v-avatar color="deep-purple" variant="tonal" size="40">
              <v-icon icon="ri-key-2-line" />
            </v-avatar>
            <div>
              <div class="text-h6 font-weight-bold">{{ store.stats.digital.total }}</div>
              <div class="text-caption text-medium-emphasis">
                gói bản quyền · {{ store.stats.digital.byStatus.fully_assigned || 0 }} hết chỗ
              </div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="outlined" class="pa-4 rounded-lg">
          <div class="d-flex align-center gap-3">
            <v-avatar :color="store.stats.expiringIn30Days ? 'warning' : 'success'" variant="tonal" size="40">
              <v-icon icon="ri-calendar-event-line" />
            </v-avatar>
            <div>
              <div class="text-h6 font-weight-bold">{{ store.stats.expiringIn30Days }}</div>
              <div class="text-caption text-medium-emphasis">hết hạn trong 30 ngày</div>
            </div>
          </div>
        </v-card>
      </v-col>
      <v-col cols="6" md="3">
        <v-card variant="outlined" class="pa-4 rounded-lg">
          <div class="d-flex align-center gap-3">
            <v-avatar color="info" variant="tonal" size="40">
              <v-icon icon="ri-money-dollar-circle-line" />
            </v-avatar>
            <div>
              <div class="text-h6 font-weight-bold">{{ vnd(store.stats.monthlyLicenseCost) }} ₫</div>
              <div class="text-caption text-medium-emphasis">chi phí bản quyền / tháng</div>
            </div>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- 3 tab -->
    <v-card class="rounded-lg">
      <v-tabs v-model="tab" color="primary" class="border-b">
        <v-tab value="physical">
          <v-icon icon="ri-computer-line" start />
          Thiết bị vật lý
        </v-tab>
        <v-tab value="digital">
          <v-icon icon="ri-key-2-line" start />
          Bản quyền &amp; Tài khoản số
          <v-chip
            v-if="store.stats?.needPasswordRotation"
            size="x-small" color="error" class="ml-2"
          >
            {{ store.stats.needPasswordRotation }}
          </v-chip>
        </v-tab>
        <v-tab value="employee">
          <v-icon icon="ri-user-search-line" start />
          Tra cứu theo nhân sự
        </v-tab>
      </v-tabs>

      <v-card-text class="pa-4">
        <v-window v-model="tab">
          <v-window-item value="physical">
            <PhysicalAssetTable />
          </v-window-item>
          <v-window-item value="digital">
            <DigitalAssetTable />
          </v-window-item>
          <v-window-item value="employee">
            <EmployeeAssetLookup />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>

    <HandoverDrawer v-model="handoverOpen" />

    <v-snackbar
      :model-value="!!store.lastSuccess"
      color="success"
      location="top"
      :timeout="4000"
      @update:model-value="store.lastSuccess = ''"
    >
      {{ store.lastSuccess }}
    </v-snackbar>

    <v-snackbar
      :model-value="!!store.lastError"
      color="error"
      location="top"
      :timeout="6000"
      @update:model-value="store.lastError = ''"
    >
      {{ store.lastError }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
</style>
