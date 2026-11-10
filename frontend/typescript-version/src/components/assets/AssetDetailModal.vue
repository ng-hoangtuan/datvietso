<script setup lang="ts">
import { ref } from 'vue'
import type { UnifiedAsset, AssetStatus } from '@/stores/useAssetStore'

interface Props {
  modelValue: boolean
  asset: UnifiedAsset | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'allocate', asset: UnifiedAsset): void
  (e: 'revoke', asset: UnifiedAsset, allocationId: string): void
  (e: 'edit', asset: UnifiedAsset): void
}>()

const showSecret = ref(false)
const copied = ref(false)

const copyToClipboard = (text?: string) => {
  if (!text) return
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

const getStatusColor = (status: AssetStatus) => {
  switch (status) {
    case 'ACTIVE': return 'success'
    case 'AVAILABLE': return 'info'
    case 'PENDING_ACTIVATION': return 'primary'
    case 'MAINTENANCE': return 'warning'
    case 'EXPIRED':
    case 'LIQUIDATED': return 'error'
    default: return 'grey'
  }
}

const getStatusText = (status: AssetStatus) => {
  switch (status) {
    case 'ACTIVE': return 'Đang sử dụng'
    case 'AVAILABLE': return 'Sẵn sàng cấp phát'
    case 'PENDING_ACTIVATION': return 'Chờ kích hoạt'
    case 'MAINTENANCE': return 'Đang bảo trì'
    case 'EXPIRED': return 'Hết hạn bản quyền'
    case 'SUSPENDED': return 'Tạm khóa'
    case 'REVOKED': return 'Đã thu hồi'
    case 'LIQUIDATED': return 'Đã thanh lý'
    default: return status
  }
}

const handleClose = () => {
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="props.modelValue" @update:model-value="handleClose" max-width="750px" scrollable>
    <v-card v-if="props.asset" class="rounded-lg">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between px-6 pt-5 pb-3">
        <div class="d-flex align-center gap-3">
          <v-avatar :color="props.asset.assetKind === 'DIGITAL' ? 'info' : 'primary'" variant="tonal" size="44">
            <v-icon :icon="props.asset.assetKind === 'DIGITAL' ? 'ri-cloud-line' : 'ri-computer-line'" size="24" />
          </v-avatar>
          <div>
            <div class="d-flex align-center gap-2">
              <span class="text-h6 font-weight-bold">{{ props.asset.name }}</span>
              <v-chip size="x-small" :color="getStatusColor(props.asset.status)" variant="tonal" class="font-weight-medium">
                {{ getStatusText(props.asset.status) }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              Mã: <strong>{{ props.asset.code }}</strong> | Danh mục: {{ props.asset.category }}
            </div>
          </div>
        </div>
        <v-btn icon="ri-close-line" variant="text" size="small" @click="handleClose" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-6" style="max-height: 70vh;">
        <!-- Digital Asset Specific Details -->
        <template v-if="props.asset.assetKind === 'DIGITAL' && props.asset.digitalMeta">
          <div class="text-subtitle-2 font-weight-bold text-info mb-3 d-flex align-center">
            <v-icon icon="ri-shield-keyhole-line" size="18" class="mr-2" />
            CHI TIẾT TÀI NGUYÊN SỐ & BẢN QUYỀN
          </div>

          <v-row dense class="mb-4">
            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Nhà cung cấp (Provider)</div>
                <div class="text-body-1 font-weight-bold text-primary mt-1">
                  {{ props.asset.digitalMeta.provider }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Mô hình định danh</div>
                <div class="text-body-1 font-weight-bold mt-1 text-capitalize">
                  {{ props.asset.digitalMeta.digitalType }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6" v-if="props.asset.digitalMeta.username">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Tài khoản / Username</div>
                <div class="text-body-1 font-weight-medium mt-1">
                  {{ props.asset.digitalMeta.username }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6" v-if="props.asset.digitalMeta.recoveryEmail">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Email khôi phục quản trị</div>
                <div class="text-body-1 font-weight-medium mt-1">
                  {{ props.asset.digitalMeta.recoveryEmail }}
                </div>
              </div>
            </v-col>

            <!-- Key / Credential Box -->
            <v-col cols="12" v-if="props.asset.digitalMeta.licenseKey">
              <div class="info-block pa-3 rounded border bg-grey-lighten-4 dark:bg-grey-darken-4">
                <div class="d-flex align-center justify-space-between">
                  <div class="text-caption text-medium-emphasis">License Key / Secret</div>
                  <div class="d-flex gap-1">
                    <v-btn
                      size="x-small"
                      variant="text"
                      :icon="showSecret ? 'ri-eye-off-line' : 'ri-eye-line'"
                      @click="showSecret = !showSecret"
                    />
                    <v-btn
                      size="x-small"
                      variant="text"
                      :icon="copied ? 'ri-check-line' : 'ri-file-copy-line'"
                      :color="copied ? 'success' : 'default'"
                      @click="copyToClipboard(props.asset.digitalMeta.licenseKey)"
                    />
                  </div>
                </div>
                <div class="text-body-1 font-family-monospace font-weight-bold mt-1">
                  {{ showSecret ? props.asset.digitalMeta.licenseKey : '••••••••••••••••••••••••••••' }}
                </div>
              </div>
            </v-col>

            <!-- Multi-seat progress -->
            <v-col cols="12" sm="6" v-if="props.asset.digitalMeta.totalSeats">
              <div class="info-block pa-3 rounded border">
                <div class="d-flex justify-space-between text-caption text-medium-emphasis mb-1">
                  <span>Sử dụng ghế (Seat Utilization)</span>
                  <span class="font-weight-bold">
                    {{ props.asset.digitalMeta.usedSeats || 0 }} / {{ props.asset.digitalMeta.totalSeats }} Seats
                  </span>
                </div>
                <v-progress-linear
                  :model-value="((props.asset.digitalMeta.usedSeats || 0) / props.asset.digitalMeta.totalSeats) * 100"
                  color="info"
                  height="8"
                  rounded
                />
              </div>
            </v-col>

            <v-col cols="12" sm="6" v-if="props.asset.digitalMeta.expiresAt">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Thời hạn bản quyền</div>
                <div class="text-body-1 font-weight-bold mt-1" :class="props.asset.status === 'EXPIRED' ? 'text-error' : 'text-success'">
                  {{ props.asset.digitalMeta.expiresAt }}
                </div>
              </div>
            </v-col>
          </v-row>
        </template>

        <!-- Physical Asset Specific Details -->
        <template v-else-if="props.asset.physicalMeta">
          <div class="text-subtitle-2 font-weight-bold text-primary mb-3 d-flex align-center">
            <v-icon icon="ri-computer-line" size="18" class="mr-2" />
            CHI TIẾT THIẾT BỊ VẬT LÝ
          </div>

          <v-row dense class="mb-4">
            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Số Serial (S/N)</div>
                <div class="text-body-1 font-weight-bold mt-1">
                  {{ props.asset.physicalMeta.serialNumber || 'Chưa cập nhật' }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Model / Đời máy</div>
                <div class="text-body-1 font-weight-medium mt-1">
                  {{ props.asset.physicalMeta.model || 'Chưa cập nhật' }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Vị trí lưu trữ</div>
                <div class="text-body-1 font-weight-medium mt-1">
                  {{ props.asset.physicalMeta.location || 'Chưa cập nhật' }}
                </div>
              </div>
            </v-col>

            <v-col cols="12" sm="6">
              <div class="info-block pa-3 rounded border">
                <div class="text-caption text-medium-emphasis">Tình trạng vật lý</div>
                <div class="text-body-1 font-weight-medium mt-1">
                  {{ props.asset.physicalMeta.condition || 'Bình thường' }}
                </div>
              </div>
            </v-col>
          </v-row>
        </template>

        <!-- Allocation History Section -->
        <div class="text-subtitle-2 font-weight-bold text-high-emphasis mb-3 d-flex align-center justify-space-between">
          <div class="d-flex align-center">
            <v-icon icon="ri-history-line" size="18" class="mr-2" />
            LỊCH SỬ CẤP PHÁT CHO NHÂN SỰ ({{ props.asset.allocations?.length || 0 }})
          </div>
          <v-btn
            size="small"
            color="success"
            variant="tonal"
            prepend-icon="ri-user-shared-line"
            @click="emit('allocate', props.asset)"
          >
            Cấp phát mới
          </v-btn>
        </div>

        <v-card variant="outlined" class="rounded">
          <v-table density="compact">
            <thead>
              <tr>
                <th>Nhân sự</th>
                <th>Phòng ban</th>
                <th>Ngày cấp</th>
                <th>Trạng thái</th>
                <th class="text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alloc in props.asset.allocations" :key="alloc.id">
                <td>
                  <div class="font-weight-medium">{{ alloc.employeeName }}</div>
                  <div class="text-caption text-medium-emphasis">{{ alloc.employeeEmail }}</div>
                </td>
                <td>{{ alloc.department }}</td>
                <td>{{ alloc.allocatedAt }}</td>
                <td>
                  <v-chip size="x-small" :color="alloc.status === 'ACTIVE' ? 'success' : 'grey'" variant="tonal">
                    {{ alloc.status === 'ACTIVE' ? 'Đang dùng' : 'Đã thu hồi' }}
                  </v-chip>
                </td>
                <td class="text-right">
                  <v-btn
                    v-if="alloc.status === 'ACTIVE'"
                    size="x-small"
                    color="warning"
                    variant="text"
                    prepend-icon="ri-arrow-go-back-line"
                    @click="emit('revoke', props.asset, alloc.id)"
                  >
                    Thu hồi
                  </v-btn>
                  <span v-else class="text-caption text-disabled">
                    {{ alloc.revokedAt }}
                  </span>
                </td>
              </tr>
              <tr v-if="!props.asset.allocations || props.asset.allocations.length === 0">
                <td colspan="5" class="text-center py-4 text-medium-emphasis text-caption">
                  Chưa có lịch sử cấp phát nào cho tài sản này.
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-6 py-4 justify-space-between">
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="ri-pencil-line"
          @click="emit('edit', props.asset)"
        >
          Sửa thông tin
        </v-btn>
        <v-btn color="grey-darken-1" variant="outlined" @click="handleClose">
          Đóng
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.info-block {
  background-color: rgba(var(--v-theme-surface), 0.6);
}
.font-family-monospace {
  font-family: monospace, monospace;
}
</style>

