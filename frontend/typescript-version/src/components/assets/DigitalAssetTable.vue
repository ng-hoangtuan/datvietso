<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  useAssetStore,
  PACKAGING_LABEL, PACKAGING_COLOR,
  DIGITAL_STATUS_LABEL, DIGITAL_STATUS_COLOR,
  type DigitalAsset,
} from '@/stores/useAssetStore'
import RevealSecretDialog from './RevealSecretDialog.vue'

/**
 * Tab 2 — Bản quyền & Tài khoản số (đặc tả mục 5.2).
 *
 * Hiển thị theo cây cha-con (M365 Tenant → các gói con), thanh tiến độ seat,
 * badge loại gói và cảnh báo hết hạn.
 */
const store = useAssetStore()

const expanded = ref<Record<string, boolean>>({})
const secretTarget = ref<{ asset: DigitalAsset; keyId?: string | null } | null>(null)
const secretOpen = ref(false)
const keysDialog = ref<DigitalAsset | null>(null)
const error = ref('')

onMounted(() => { if (store.digitalAssets.length === 0) store.fetchDigital() })

const vnd = (n: number, cur = 'VND') =>
  (cur === 'USD' ? `$${new Intl.NumberFormat('en-US').format(n || 0)}`
    : `${new Intl.NumberFormat('vi-VN').format(n || 0)} ₫`)

const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

const toggle = (id: string) => { expanded.value[id] = !expanded.value[id] }

/** Cây đã lọc: nếu con khớp bộ lọc thì cha vẫn hiện để giữ ngữ cảnh. */
const tree = computed(() => store.digitalTree)

const seatPercent = (d: DigitalAsset) => {
  if (d.totalSeats === null || d.totalSeats === 0) return 0

  return Math.round((d.usedSeats / d.totalSeats) * 100)
}

const seatColor = (d: DigitalAsset) => {
  const p = seatPercent(d)
  if (d.totalSeats === null) return 'info'
  if (p >= 100) return 'error'
  if (p >= 80) return 'warning'

  return 'success'
}

const expiryChip = (d: DigitalAsset) => {
  if (!d.expiryDate) return null
  if (d.status === 'expired' || (d.daysToExpiry !== null && d.daysToExpiry < 0)) {
    return { color: 'error', text: `Hết hạn ${dmy(d.expiryDate)}` }
  }
  if (d.daysToExpiry !== null && d.daysToExpiry <= 7) {
    return { color: 'error', text: `Còn ${d.daysToExpiry} ngày` }
  }
  if (d.daysToExpiry !== null && d.daysToExpiry <= 30) {
    return { color: 'warning', text: `Còn ${d.daysToExpiry} ngày` }
  }

  return { color: 'default', text: dmy(d.expiryDate) }
}

const openSecret = (asset: DigitalAsset, keyId?: string | null) => {
  secretTarget.value = { asset, keyId }
  secretOpen.value = true
}

const newKeys = ref('')
const addingKeys = ref(false)

const submitKeys = async () => {
  if (!keysDialog.value) return

  const keys = newKeys.value.split('\n').map(k => k.trim()).filter(Boolean)
  if (keys.length === 0) return

  addingKeys.value = true
  error.value = ''
  try {
    await store.addKeys(keysDialog.value.id, keys)
    keysDialog.value = null
    newKeys.value = ''
  }
  catch (e: any) {
    error.value = e?.message || 'Không nhập được key'
  }
  finally {
    addingKeys.value = false
  }
}

const clearRotationFlag = async (d: DigitalAsset) => {
  error.value = ''
  try {
    await store.updateDigital(d.id, { clearPasswordRotationFlag: true })
  }
  catch (e: any) {
    error.value = e?.message || 'Không cập nhật được'
  }
}
</script>

<template>
  <div>
    <!-- Bộ lọc -->
    <div class="d-flex flex-wrap gap-3 mb-4 align-center">
      <v-text-field
        v-model="store.digitalFilter.search"
        placeholder="Tìm theo tên gói, nhà cung cấp..."
        prepend-inner-icon="ri-search-line"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 300px;"
        @update:model-value="store.fetchDigital()"
      />
      <v-select
        v-model="store.digitalFilter.bindingTarget"
        :items="[
          { title: 'Mọi kiểu gắn', value: 'ALL' },
          { title: 'Gắn theo người', value: 'user' },
          { title: 'Gắn theo máy', value: 'device' },
        ]"
        density="compact" variant="outlined" hide-details style="max-width: 180px;"
        @update:model-value="store.fetchDigital()"
      />
      <v-select
        v-model="store.digitalFilter.status"
        :items="[
          { title: 'Mọi trạng thái', value: 'ALL' },
          ...Object.entries(DIGITAL_STATUS_LABEL).map(([value, title]) => ({ title, value })),
        ]"
        density="compact" variant="outlined" hide-details style="max-width: 170px;"
        @update:model-value="store.fetchDigital()"
      />
      <v-spacer />
      <span class="text-caption text-medium-emphasis">{{ store.digitalAssets.length }} gói</span>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <div v-if="store.isLoading" class="text-center py-10">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="tree.length === 0" class="text-center py-10 text-medium-emphasis">
      <v-icon icon="ri-key-2-line" size="40" class="mb-2 opacity-50" />
      <div class="text-body-2">Chưa có bản quyền hoặc tài khoản số nào</div>
    </div>

    <!-- Cây tài sản số -->
    <template v-else>
      <template v-for="node in tree" :key="node.id">
        <v-card variant="outlined" class="mb-3 rounded-lg overflow-hidden">
          <!-- Dòng cha -->
          <div class="pa-3 d-flex align-center gap-3 flex-wrap" :class="node.isContainerOnly ? 'container-row' : ''">
            <v-btn
              v-if="node.children && node.children.length"
              :icon="expanded[node.id] !== false ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'"
              size="x-small" variant="text"
              @click="toggle(node.id)"
            />
            <v-avatar size="34" :color="PACKAGING_COLOR[node.packagingType]" variant="tonal">
              <v-icon :icon="node.isContainerOnly ? 'ri-building-line' : 'ri-key-2-line'" size="18" />
            </v-avatar>

            <div class="flex-grow-1 overflow-hidden" style="min-width: 200px;">
              <div class="d-flex align-center gap-2 flex-wrap">
                <span class="text-body-2 font-weight-bold">{{ node.name }}</span>
                <v-chip size="x-small" :color="PACKAGING_COLOR[node.packagingType]" variant="tonal">
                  {{ PACKAGING_LABEL[node.packagingType] }}
                </v-chip>
                <v-chip v-if="node.isContainerOnly" size="x-small" variant="outlined">
                  Cổng quản trị
                </v-chip>
                <v-chip
                  v-else size="x-small" variant="outlined"
                  :prepend-icon="node.bindingTarget === 'device' ? 'ri-computer-line' : 'ri-user-line'"
                >
                  {{ node.bindingTarget === 'device' ? 'Theo máy' : 'Theo người' }}
                </v-chip>
                <!-- Quy tắc 4: cờ đỏ sau khi thu hồi khỏi tài khoản dùng chung -->
                <v-chip
                  v-if="node.requiresPasswordRotation"
                  size="x-small" color="error" variant="flat" prepend-icon="ri-alarm-warning-line"
                >
                  Cần đổi mật khẩu
                </v-chip>
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ node.provider }}
                <template v-if="node.physicalStorageLocation"> · 📦 {{ node.physicalStorageLocation }}</template>
                <template v-if="node.loginIdentifier"> · {{ node.loginIdentifier }}</template>
              </div>
            </div>

            <!-- Thanh seat -->
            <div v-if="!node.isContainerOnly" style="width: 150px;">
              <div class="d-flex justify-space-between text-caption mb-1">
                <span>{{ node.usedSeats }}/{{ node.totalSeats === null ? '∞' : node.totalSeats }}</span>
                <span class="text-disabled">chỗ</span>
              </div>
              <v-progress-linear
                :model-value="node.totalSeats === null ? 8 : seatPercent(node)"
                :color="seatColor(node)" height="6" rounded
              />
            </div>

            <v-chip
              v-if="expiryChip(node)"
              size="small" :color="expiryChip(node)!.color" variant="tonal" prepend-icon="ri-calendar-line"
            >
              {{ expiryChip(node)!.text }}
            </v-chip>

            <v-chip size="small" :color="DIGITAL_STATUS_COLOR[node.status]" variant="tonal">
              {{ DIGITAL_STATUS_LABEL[node.status] }}
            </v-chip>

            <div class="d-flex gap-1">
              <v-tooltip v-if="node.hasSecret && store.canManage" text="Xem mật khẩu / key dùng chung" location="top">
                <template #activator="{ props: tp }">
                  <v-btn v-bind="tp" icon="ri-eye-line" size="x-small" variant="text" color="warning" @click="openSecret(node)" />
                </template>
              </v-tooltip>
              <v-tooltip v-if="node.requiresPasswordRotation && store.canManage" text="Đã đổi mật khẩu, hạ cờ" location="top">
                <template #activator="{ props: tp }">
                  <v-btn v-bind="tp" icon="ri-shield-check-line" size="x-small" variant="text" color="success" @click="clearRotationFlag(node)" />
                </template>
              </v-tooltip>
              <v-tooltip
                v-if="node.fulfillmentMethod === 'discrete_key_pool' && store.canManage"
                text="Nhập thêm key vào kho" location="top"
              >
                <template #activator="{ props: tp }">
                  <v-btn v-bind="tp" icon="ri-add-box-line" size="x-small" variant="text" @click="keysDialog = node" />
                </template>
              </v-tooltip>
            </div>
          </div>

          <!-- Kho key rời -->
          <div v-if="node.keyPool.length > 0" class="px-3 pb-3">
            <v-divider class="mb-2" />
            <div class="text-caption text-medium-emphasis mb-2">
              Kho key: {{ node.keyStats.available }} trống ·
              {{ node.keyStats.assigned }} đã cấp ·
              {{ node.keyStats.burned }} đã cháy
            </div>
            <div class="d-flex flex-wrap gap-1">
              <v-chip
                v-for="k in node.keyPool"
                :key="k.keyId"
                size="small"
                :color="k.status === 'available' ? 'success' : k.status === 'assigned' ? 'primary' : 'error'"
                variant="tonal"
                :append-icon="k.status === 'available' && store.canManage ? 'ri-eye-line' : undefined"
                @click="k.status === 'available' && store.canManage ? openSecret(node, k.keyId) : null"
              >
                {{ k.label || k.keyId.slice(-6) }}
              </v-chip>
            </div>
          </div>

          <!-- Gói con -->
          <template v-if="node.children && node.children.length && expanded[node.id] !== false">
            <v-divider />
            <div
              v-for="child in node.children"
              :key="child.id"
              class="pa-3 pl-10 d-flex align-center gap-3 flex-wrap child-row"
            >
              <v-avatar size="28" :color="PACKAGING_COLOR[child.packagingType]" variant="tonal">
                <v-icon icon="ri-subtract-line" size="14" />
              </v-avatar>
              <div class="flex-grow-1 overflow-hidden" style="min-width: 180px;">
                <div class="d-flex align-center gap-2 flex-wrap">
                  <span class="text-body-2 font-weight-medium">{{ child.name }}</span>
                  <v-chip
                    size="x-small" variant="outlined"
                    :prepend-icon="child.bindingTarget === 'device' ? 'ri-computer-line' : 'ri-user-line'"
                  >
                    {{ child.bindingTarget === 'device' ? 'Theo máy' : 'Theo người' }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ vnd(child.cost, child.currency) }} /
                  {{ child.billingCycle === 'yearly' ? 'năm' : child.billingCycle === 'monthly' ? 'tháng' : 'một lần' }}
                </div>
              </div>
              <div style="width: 150px;">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>{{ child.usedSeats }}/{{ child.totalSeats === null ? '∞' : child.totalSeats }}</span>
                  <span class="text-disabled">chỗ</span>
                </div>
                <v-progress-linear
                  :model-value="child.totalSeats === null ? 8 : seatPercent(child)"
                  :color="seatColor(child)" height="6" rounded
                />
              </div>
              <v-chip v-if="expiryChip(child)" size="small" :color="expiryChip(child)!.color" variant="tonal">
                {{ expiryChip(child)!.text }}
              </v-chip>
              <v-chip size="small" :color="DIGITAL_STATUS_COLOR[child.status]" variant="tonal">
                {{ DIGITAL_STATUS_LABEL[child.status] }}
              </v-chip>
            </div>
          </template>
        </v-card>
      </template>
    </template>

    <!-- Nhập thêm key -->
    <v-dialog :model-value="!!keysDialog" max-width="520" @update:model-value="keysDialog = null">
      <v-card v-if="keysDialog" class="rounded-lg">
        <v-card-title class="px-5 pt-4 pb-2 text-h6 font-weight-bold">
          Nhập thêm key — {{ keysDialog.name }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-5">
          <v-textarea
            v-model="newKeys"
            label="Mỗi dòng một key"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX&#10;YYYYY-YYYYY-YYYYY-YYYYY-YYYYY"
            variant="outlined"
            rows="5"
            hide-details
          />
          <v-alert type="info" variant="tonal" density="compact" class="mt-3">
            <div class="text-caption">
              Key được mã hoá AES-256 ngay khi lưu. Tổng số chỗ của kho sẽ tăng theo số key nhập vào.
            </div>
          </v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-5 py-3 justify-end gap-2">
          <v-btn variant="outlined" color="grey" @click="keysDialog = null">Hủy</v-btn>
          <v-btn color="primary" :loading="addingKeys" @click="submitKeys">Nhập kho</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <RevealSecretDialog
      v-model="secretOpen"
      :asset="secretTarget?.asset || null"
      :key-id="secretTarget?.keyId || null"
    />
  </div>
</template>

<style scoped>
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.container-row { background-color: rgba(var(--v-theme-on-surface), 0.03); }
.child-row { background-color: rgba(var(--v-theme-on-surface), 0.015); }
.child-row + .child-row { border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06); }
</style>
