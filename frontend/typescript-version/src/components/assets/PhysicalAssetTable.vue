<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  useAssetStore,
  CATEGORY_LABEL, CONDITION_LABEL,
  PHYSICAL_STATUS_COLOR, PHYSICAL_STATUS_LABEL,
  ASSIGNMENT_STATUS_COLOR, ASSIGNMENT_STATUS_LABEL,
  type PhysicalAsset, type PhysicalAssetDetail,
} from '@/stores/useAssetStore'

/** Tab 1 — Thiết bị vật lý (đặc tả mục 5.2). */
const store = useAssetStore()

const detail = ref<PhysicalAssetDetail | null>(null)
const detailOpen = ref(false)
const revokeTarget = ref<any | null>(null)
const revokeForm = ref({ returnToStatus: 'available', condition: '', returnConditionNote: '', revokeReason: '' })
const busy = ref(false)
const error = ref('')

const headers = [
  { title: 'Mã / Thiết bị', key: 'assetCode', width: '28%' },
  { title: 'Loại', key: 'category', width: '12%' },
  { title: 'Người đang giữ', key: 'currentHolderName', width: '20%' },
  { title: 'Tình trạng', key: 'condition', width: '12%' },
  { title: 'Trạng thái', key: 'status', width: '14%' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]

onMounted(() => { if (store.physicalAssets.length === 0) store.fetchPhysical() })

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n || 0)
const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

/** Bảo hành còn bao lâu — hết hạn thì tô đỏ để IT thấy ngay. */
const warranty = (d?: string | null) => {
  if (!d) return null
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)

  return { days, expired: days < 0, soon: days >= 0 && days <= 60 }
}

const openDetail = async (item: PhysicalAsset) => {
  detailOpen.value = true
  detail.value = null
  detail.value = await store.fetchPhysicalDetail(item.id)
}

/** Phiếu bàn giao đang mở của máy — cần id phiếu để thu hồi. */
const openHandover = async (item: PhysicalAsset) => {
  error.value = ''
  const rows = await store.fetchAssignments({
    physicalAssetId: item.id, type: 'physical_handover', status: 'OPEN',
  })
  if (!rows || rows.length === 0) {
    error.value = `Không tìm thấy phiếu bàn giao đang mở của ${item.assetCode}`

    return
  }
  revokeTarget.value = { asset: item, assignment: rows[0] }
  revokeForm.value = {
    returnToStatus: 'available',
    condition: item.condition,
    returnConditionNote: '',
    revokeReason: '',
  }
}

const doRevoke = async () => {
  if (!revokeTarget.value) return

  busy.value = true
  error.value = ''
  try {
    await store.revoke(revokeTarget.value.assignment.id, {
      returnToStatus: revokeForm.value.returnToStatus,
      condition: revokeForm.value.condition || undefined,
      returnConditionNote: revokeForm.value.returnConditionNote || undefined,
      revokeReason: revokeForm.value.revokeReason || undefined,
    })
    revokeTarget.value = null
  }
  catch (e: any) {
    error.value = e?.message || 'Thu hồi không thành công'
  }
  finally {
    busy.value = false
  }
}

const remove = async (item: PhysicalAsset) => {
  error.value = ''
  try {
    await store.deletePhysical(item.id)
  }
  catch (e: any) {
    error.value = e?.message || 'Không xóa được'
  }
}

const emptyText = computed(() =>
  (store.physicalFilter.search || store.physicalFilter.status !== 'ALL'
    ? 'Không có thiết bị nào khớp bộ lọc'
    : 'Chưa có thiết bị nào trong kho'))
</script>

<template>
  <div>
    <!-- Bộ lọc -->
    <div class="d-flex flex-wrap gap-3 mb-4 align-center">
      <v-text-field
        v-model="store.physicalFilter.search"
        placeholder="Tìm theo mã, tên, serial, người giữ..."
        prepend-inner-icon="ri-search-line"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 320px;"
        @update:model-value="store.fetchPhysical()"
      />
      <v-select
        v-model="store.physicalFilter.status"
        :items="[
          { title: 'Mọi trạng thái', value: 'ALL' },
          { title: 'Trong kho', value: 'available' },
          { title: 'Đang sử dụng', value: 'assigned' },
          { title: 'Đang bảo trì', value: 'maintenance' },
          { title: 'Thất lạc', value: 'lost' },
          { title: 'Đã thanh lý', value: 'retired' },
        ]"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 180px;"
        @update:model-value="store.fetchPhysical()"
      />
      <v-select
        v-model="store.physicalFilter.category"
        :items="[
          { title: 'Mọi loại', value: 'ALL' },
          ...Object.entries(CATEGORY_LABEL).map(([value, title]) => ({ title, value })),
        ]"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 170px;"
        @update:model-value="store.fetchPhysical()"
      />
      <v-spacer />
      <span class="text-caption text-medium-emphasis">
        {{ store.physicalAssets.length }} thiết bị
      </span>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="store.physicalAssets"
      :loading="store.isLoading"
      density="comfortable"
      items-per-page="25"
      class="asset-table"
    >
      <template #item.assetCode="{ item }">
        <div class="py-1">
          <div class="d-flex align-center gap-2">
            <span class="font-weight-bold text-body-2">{{ item.assetCode }}</span>
            <!-- Quy tắc 1: Windows OEM đi theo máy suốt vòng đời -->
            <v-tooltip v-if="item.bundledOemLicense.hasOem" :text="item.bundledOemLicense.osName || 'Windows OEM'">
              <template #activator="{ props: tp }">
                <v-chip v-bind="tp" size="x-small" color="success" variant="tonal" prepend-icon="ri-windows-fill">
                  OEM
                </v-chip>
              </template>
            </v-tooltip>
          </div>
          <div class="text-caption text-medium-emphasis">{{ item.name }}</div>
          <div class="text-caption text-disabled">SN: {{ item.serialNumber }}</div>
        </div>
      </template>

      <template #item.category="{ item }">
        <span class="text-body-2">{{ CATEGORY_LABEL[item.category] || item.category }}</span>
      </template>

      <template #item.currentHolderName="{ item }">
        <div v-if="item.currentHolderName" class="d-flex align-center gap-2">
          <v-avatar size="26" color="primary" variant="tonal">
            <span class="text-caption">{{ item.currentHolderName.charAt(0) }}</span>
          </v-avatar>
          <div>
            <div class="text-body-2">{{ item.currentHolderName }}</div>
            <div class="text-caption text-disabled">từ {{ dmy(item.assignedAt) }}</div>
          </div>
        </div>
        <span v-else class="text-caption text-disabled">—</span>
      </template>

      <template #item.condition="{ item }">
        <span class="text-body-2">{{ CONDITION_LABEL[item.condition] }}</span>
        <div v-if="warranty(item.warrantyExpiry)" class="text-caption">
          <span v-if="warranty(item.warrantyExpiry)!.expired" class="text-error">Hết bảo hành</span>
          <span v-else-if="warranty(item.warrantyExpiry)!.soon" class="text-warning">
            BH còn {{ warranty(item.warrantyExpiry)!.days }}n
          </span>
          <span v-else class="text-disabled">BH {{ dmy(item.warrantyExpiry) }}</span>
        </div>
      </template>

      <template #item.status="{ item }">
        <v-chip :color="PHYSICAL_STATUS_COLOR[item.status]" size="small" variant="tonal">
          {{ PHYSICAL_STATUS_LABEL[item.status] }}
        </v-chip>
      </template>

      <template #item.actions="{ item }">
        <div class="d-flex justify-end gap-1">
          <v-tooltip text="Lịch sử luân chuyển" location="top">
            <template #activator="{ props: tp }">
              <v-btn v-bind="tp" icon="ri-history-line" size="x-small" variant="text" @click="openDetail(item)" />
            </template>
          </v-tooltip>

          <v-tooltip v-if="item.status === 'assigned' && store.canManage" text="Thu hồi" location="top">
            <template #activator="{ props: tp }">
              <v-btn v-bind="tp" icon="ri-logout-box-line" size="x-small" variant="text" color="warning" @click="openHandover(item)" />
            </template>
          </v-tooltip>

          <v-menu v-if="store.canManage" location="bottom end">
            <template #activator="{ props: mp }">
              <v-btn v-bind="mp" icon="ri-more-2-line" size="x-small" variant="text" />
            </template>
            <v-list density="compact">
              <v-list-item
                prepend-icon="ri-delete-bin-line"
                title="Xóa thiết bị"
                class="text-error"
                @click="remove(item)"
              />
            </v-list>
          </v-menu>
        </div>
      </template>

      <template #no-data>
        <div class="text-center py-8 text-medium-emphasis">
          <v-icon icon="ri-computer-line" size="40" class="mb-2 opacity-50" />
          <div class="text-body-2">{{ emptyText }}</div>
        </div>
      </template>
    </v-data-table>

    <!-- Lịch sử luân chuyển của một máy -->
    <v-dialog v-model="detailOpen" max-width="700">
      <v-card class="rounded-lg">
        <v-card-title class="px-5 pt-4 pb-2 d-flex align-center justify-space-between">
          <span class="text-h6 font-weight-bold">Lịch sử luân chuyển</span>
          <v-btn icon="ri-close-line" variant="text" size="small" @click="detailOpen = false" />
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-5">
          <div v-if="!detail" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <template v-else>
            <div class="mb-4">
              <div class="text-subtitle-1 font-weight-bold">{{ detail.assetCode }} — {{ detail.name }}</div>
              <div class="text-caption text-medium-emphasis">
                SN {{ detail.serialNumber }} · {{ detail.specs || 'chưa ghi cấu hình' }}
                · mua {{ dmy(detail.purchaseDate) }} · {{ vnd(detail.cost) }} ₫
              </div>
              <v-chip
                v-if="detail.bundledOemLicense.hasOem"
                size="small" color="success" variant="tonal" class="mt-2"
                prepend-icon="ri-windows-fill"
              >
                {{ detail.bundledOemLicense.osName }} — gắn theo máy, không chiếm chỗ kho
              </v-chip>
            </div>

            <v-divider class="mb-3" />

            <div v-if="detail.history.length === 0" class="text-center py-4 text-medium-emphasis text-body-2">
              Chưa có phiếu cấp phát nào
            </div>
            <v-timeline v-else side="end" density="compact" truncate-line="both">
              <v-timeline-item
                v-for="h in detail.history"
                :key="h.id"
                :dot-color="ASSIGNMENT_STATUS_COLOR[h.status]"
                size="x-small"
              >
                <div class="d-flex align-center gap-2 flex-wrap">
                  <span class="text-body-2 font-weight-medium">{{ h.employeeName }}</span>
                  <v-chip size="x-small" :color="ASSIGNMENT_STATUS_COLOR[h.status]" variant="tonal">
                    {{ ASSIGNMENT_STATUS_LABEL[h.status] }}
                  </v-chip>
                  <v-chip v-if="h.digitalAssetName" size="x-small" variant="outlined">
                    {{ h.digitalAssetName }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ dmy(h.assignedAt) }}<template v-if="h.revokedAt"> → {{ dmy(h.revokedAt) }}</template>
                </div>
                <div v-if="h.handoverConditionNote" class="text-caption">
                  Giao: {{ h.handoverConditionNote }}
                </div>
                <div v-if="h.returnConditionNote" class="text-caption">
                  Nhận lại: {{ h.returnConditionNote }}
                </div>
                <div v-if="h.revokeReason" class="text-caption text-disabled">
                  Lý do: {{ h.revokeReason }}
                </div>
              </v-timeline-item>
            </v-timeline>
          </template>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Thu hồi thiết bị -->
    <v-dialog :model-value="!!revokeTarget" max-width="520" @update:model-value="revokeTarget = null">
      <v-card v-if="revokeTarget" class="rounded-lg">
        <v-card-title class="px-5 pt-4 pb-2 text-h6 font-weight-bold">
          Thu hồi {{ revokeTarget.asset.assetCode }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-5">
          <div class="text-body-2 mb-4">
            Đang thu hồi từ <strong>{{ revokeTarget.assignment.employeeName }}</strong>.
          </div>

          <v-select
            v-model="revokeForm.returnToStatus"
            label="Máy về trạng thái"
            :items="[
              { title: 'Trong kho (sẵn sàng cấp lại)', value: 'available' },
              { title: 'Đưa đi bảo trì', value: 'maintenance' },
              { title: 'Thất lạc', value: 'lost' },
              { title: 'Thanh lý', value: 'retired' },
            ]"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            hide-details
          />
          <v-select
            v-model="revokeForm.condition"
            label="Tình trạng máy khi nhận lại"
            :items="Object.entries(CONDITION_LABEL).map(([value, title]) => ({ title, value }))"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            hide-details
          />
          <v-text-field
            v-model="revokeForm.revokeReason"
            label="Lý do thu hồi"
            placeholder="VD: Đổi máy mới, nghỉ việc, hỏng mainboard"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            hide-details
          />
          <v-textarea
            v-model="revokeForm.returnConditionNote"
            label="Ghi chú tình trạng"
            placeholder="VD: Máy còn tốt, có vết xước nhẹ ở viền dưới"
            variant="outlined"
            rows="2"
            density="comfortable"
            hide-details
          />

          <v-alert type="info" variant="tonal" density="compact" class="mt-3">
            <div class="text-caption">
              Bản quyền cài trên máy (nếu có) <strong>không</strong> bị thu hồi theo.
              Dùng tab Bản quyền để xử lý riêng.
            </div>
          </v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-5 py-3 justify-end gap-2">
          <v-btn variant="outlined" color="grey" @click="revokeTarget = null">Hủy</v-btn>
          <v-btn color="warning" variant="flat" :loading="busy" @click="doRevoke">Thu hồi</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.asset-table :deep(td) { vertical-align: middle; }
</style>
