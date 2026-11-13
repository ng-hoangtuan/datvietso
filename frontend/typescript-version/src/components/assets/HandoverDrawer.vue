<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAssetStore, PACKAGING_LABEL, type DigitalAsset } from '@/stores/useAssetStore'
import { API_BASE } from '@/utils/api'
import { vnAutocompleteFilter } from '@/utils/vnSearch'

/**
 * Drawer "Cấp phát trọn gói" — Luồng 2 của đặc tả.
 *
 * Toàn bộ lựa chọn gửi đi trong MỘT request và chạy trong MỘT transaction ở
 * server: hoặc nhân sự nhận đủ máy + key + license, hoặc không có gì thay đổi.
 *
 * Điểm cốt lõi của màn hình này: khi chọn máy CHƯA có Windows OEM, hệ thống
 * phải chủ động gợi ý key Windows đang trống trong kho — đó là lúc dễ quên nhất
 * và cũng là lúc dễ cấp trùng key nhất.
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useAssetStore()

interface Contact { userId: string; name: string; email?: string; department?: string; employeeCode?: string }

const contacts = ref<Contact[]>([])
const employeeId = ref<string | null>(null)
const physicalAssetId = ref<string | null>(null)
const selectedLicenseIds = ref<string[]>([])
const handoverNote = ref('')
const submitting = ref(false)
const error = ref('')

const loadContacts = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/chat/contacts`)
    if (res.ok) contacts.value = await res.json()
  }
  catch (e) { /* danh bạ không tải được thì vẫn nhập tay id được */ }
}

const reset = () => {
  employeeId.value = null
  physicalAssetId.value = null
  selectedLicenseIds.value = []
  handoverNote.value = ''
  error.value = ''
}

watch(() => props.modelValue, v => {
  if (v) {
    reset()
    if (contacts.value.length === 0) loadContacts()
    store.refreshAll()
  }
})

const selectedDevice = computed(() =>
  store.availableDevices.find(d => d.id === physicalAssetId.value) || null)

/** Máy đã kèm Windows OEM thì KHÔNG cần cấp thêm key (Quy tắc 1). */
const deviceHasOem = computed(() => !!selectedDevice.value?.bundledOemLicense.hasOem)

/** Bản quyền gắn theo MÁY — chỉ chọn được khi đã chọn máy (Quy tắc 2). */
const deviceLicenses = computed(() =>
  store.assignableLicenses.filter(l => l.bindingTarget === 'device'))

/** Bản quyền gắn theo NGƯỜI — chọn lúc nào cũng được (Quy tắc 3). */
const userLicenses = computed(() =>
  store.assignableLicenses.filter(l => l.bindingTarget === 'user'))

/**
 * Gợi ý key Windows khi máy chưa có OEM. Đây là bước đặc tả nhấn mạnh:
 * "hệ thống tự kiểm tra nếu Laptop chưa có Windows OEM thì gợi ý ngay danh sách
 * Key Windows FPP/ESD đang trống trong kho".
 */
const suggestedWindowsKeys = computed(() => {
  if (!selectedDevice.value || deviceHasOem.value) return []

  return deviceLicenses.value.filter(l =>
    /windows/i.test(l.name) && ['physical_box_fpp', 'digital_esd'].includes(l.packagingType))
})

const seatText = (l: DigitalAsset) =>
  (l.totalSeats === null ? 'không giới hạn' : `còn ${l.availableSeats}/${l.totalSeats}`)

const canSubmit = computed(() =>
  !!employeeId.value && (!!physicalAssetId.value || selectedLicenseIds.value.length > 0))

/** Chọn license gắn theo máy mà chưa chọn máy -> server sẽ từ chối, chặn sớm ở đây. */
const deviceLicenseWithoutMachine = computed(() =>
  !physicalAssetId.value
  && selectedLicenseIds.value.some(id =>
    store.assignableLicenses.find(l => l.id === id)?.bindingTarget === 'device'))

const close = () => emit('update:modelValue', false)

const submit = async () => {
  error.value = ''
  if (deviceLicenseWithoutMachine.value) {
    error.value = 'Có bản quyền gắn theo máy trong danh sách — phải chọn thiết bị đích trước.'

    return
  }

  submitting.value = true
  try {
    await store.handoverBundle({
      employeeId: employeeId.value!,
      physicalAssetId: physicalAssetId.value,
      digitalAssetIds: selectedLicenseIds.value,
      handoverConditionNote: handoverNote.value || undefined,
    })
    close()
  }
  catch (e: any) {
    error.value = e?.message || 'Cấp phát không thành công'
  }
  finally {
    submitting.value = false
  }
}

const toggleLicense = (id: string) => {
  const i = selectedLicenseIds.value.indexOf(id)
  if (i === -1) selectedLicenseIds.value.push(id)
  else selectedLicenseIds.value.splice(i, 1)
}
</script>

<template>
  <v-navigation-drawer
    :model-value="props.modelValue"
    location="right"
    temporary
    width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="d-flex flex-column h-100">
      <!-- Header -->
      <div class="px-4 py-3 border-b d-flex align-center justify-space-between flex-shrink-0">
        <div>
          <div class="text-subtitle-1 font-weight-bold">Cấp phát trọn gói</div>
          <div class="text-caption text-medium-emphasis">Máy + bản quyền trong một lần</div>
        </div>
        <v-btn icon="ri-close-line" variant="text" size="small" @click="close" />
      </div>

      <div class="flex-grow-1 overflow-y-auto pa-4">
        <!-- 1. Nhân sự -->
        <div class="step-label">
          <v-avatar size="20" color="primary" class="mr-2 text-caption">1</v-avatar>
          Nhân sự nhận
        </div>
        <v-autocomplete
          v-model="employeeId"
          :items="contacts"
          item-title="name"
          item-value="userId"
          placeholder="Tìm theo tên hoặc mã nhân sự..."
          :custom-filter="vnAutocompleteFilter"
          variant="outlined"
          density="comfortable"
          class="mb-5"
          hide-details
        >
          <template #item="{ item, props: ip }">
            <v-list-item v-bind="ip" :subtitle="`${item.raw.employeeCode || ''} · ${item.raw.department || ''}`" />
          </template>
        </v-autocomplete>

        <!-- 2. Thiết bị -->
        <div class="step-label">
          <v-avatar size="20" color="primary" class="mr-2 text-caption">2</v-avatar>
          Thiết bị <span class="text-caption text-medium-emphasis ml-1">(không bắt buộc)</span>
        </div>
        <v-select
          v-model="physicalAssetId"
          :items="store.availableDevices"
          item-value="id"
          :item-title="(d: any) => `${d.assetCode} — ${d.name}`"
          placeholder="Chọn máy đang trong kho"
          variant="outlined"
          density="comfortable"
          clearable
          hide-details
          class="mb-2"
        >
          <template #item="{ item, props: ip }">
            <v-list-item v-bind="ip">
              <template #subtitle>
                <span class="text-caption">
                  {{ item.raw.specs || item.raw.serialNumber }}
                  <v-chip
                    v-if="item.raw.bundledOemLicense.hasOem"
                    size="x-small" color="success" variant="tonal" class="ml-1"
                  >
                    Kèm Win OEM
                  </v-chip>
                </span>
              </template>
            </v-list-item>
          </template>
        </v-select>

        <!-- Quy tắc 1: máy có OEM thì không cấp thêm key Windows -->
        <v-alert
          v-if="selectedDevice && deviceHasOem"
          type="success" variant="tonal" density="compact" class="mb-5"
        >
          <div class="text-caption">
            Máy đã kèm <strong>{{ selectedDevice.bundledOemLicense.osName }}</strong> gắn theo mainboard
            — không cần cấp thêm key Windows.
          </div>
        </v-alert>

        <!-- Gợi ý key Windows khi máy chưa có OEM -->
        <v-alert
          v-else-if="selectedDevice && suggestedWindowsKeys.length > 0"
          type="warning" variant="tonal" density="compact" class="mb-3"
        >
          <div class="text-caption mb-2">
            Máy này <strong>chưa có Windows</strong>. Key đang trống trong kho:
          </div>
          <v-chip
            v-for="k in suggestedWindowsKeys"
            :key="k.id"
            size="small"
            class="mr-1 mb-1"
            :color="selectedLicenseIds.includes(k.id) ? 'primary' : undefined"
            :variant="selectedLicenseIds.includes(k.id) ? 'flat' : 'outlined'"
            @click="toggleLicense(k.id)"
          >
            <v-icon start :icon="selectedLicenseIds.includes(k.id) ? 'ri-check-line' : 'ri-add-line'" size="14" />
            {{ k.name }} ({{ seatText(k) }})
          </v-chip>
        </v-alert>

        <v-alert
          v-else-if="selectedDevice && !deviceHasOem"
          type="info" variant="tonal" density="compact" class="mb-5"
        >
          <div class="text-caption">
            Máy chưa có Windows và kho không còn key FPP/ESD nào trống.
          </div>
        </v-alert>

        <!-- 3. Bản quyền -->
        <div class="step-label mt-4">
          <v-avatar size="20" color="primary" class="mr-2 text-caption">3</v-avatar>
          Bản quyền &amp; tài khoản
        </div>

        <div class="text-caption text-medium-emphasis mb-1 mt-2">
          <v-icon icon="ri-user-line" size="13" /> Gắn theo người — đi theo nhân sự khi đổi máy
        </div>
        <div v-if="userLicenses.length === 0" class="text-caption text-disabled mb-3">
          Không còn gói nào trống
        </div>
        <v-card
          v-for="l in userLicenses"
          :key="l.id"
          :variant="selectedLicenseIds.includes(l.id) ? 'tonal' : 'outlined'"
          :color="selectedLicenseIds.includes(l.id) ? 'primary' : undefined"
          class="license-row mb-2 pa-2 cursor-pointer"
          @click="toggleLicense(l.id)"
        >
          <div class="d-flex align-center gap-2">
            <v-icon
              :icon="selectedLicenseIds.includes(l.id) ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'"
              size="18"
            />
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-body-2 font-weight-medium text-truncate">{{ l.name }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ PACKAGING_LABEL[l.packagingType] }} · {{ seatText(l) }}
              </div>
            </div>
          </div>
        </v-card>

        <div class="text-caption text-medium-emphasis mb-1 mt-4">
          <v-icon icon="ri-computer-line" size="13" /> Gắn theo máy — cần chọn thiết bị ở bước 2
        </div>
        <div v-if="deviceLicenses.length === 0" class="text-caption text-disabled mb-3">
          Không còn key nào trống
        </div>
        <v-card
          v-for="l in deviceLicenses"
          :key="l.id"
          :variant="selectedLicenseIds.includes(l.id) ? 'tonal' : 'outlined'"
          :color="selectedLicenseIds.includes(l.id) ? 'primary' : undefined"
          class="license-row mb-2 pa-2"
          :class="physicalAssetId ? 'cursor-pointer' : 'opacity-50'"
          @click="physicalAssetId && toggleLicense(l.id)"
        >
          <div class="d-flex align-center gap-2">
            <v-icon
              :icon="selectedLicenseIds.includes(l.id) ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'"
              size="18"
            />
            <div class="flex-grow-1 overflow-hidden">
              <div class="text-body-2 font-weight-medium text-truncate">{{ l.name }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ PACKAGING_LABEL[l.packagingType] }} · {{ seatText(l) }}
              </div>
            </div>
          </div>
        </v-card>

        <!-- 4. Ghi chú bàn giao -->
        <div class="step-label mt-5">
          <v-avatar size="20" color="primary" class="mr-2 text-caption">4</v-avatar>
          Tình trạng khi bàn giao
        </div>
        <v-textarea
          v-model="handoverNote"
          placeholder="VD: Máy mới 100%, kèm sạc zin và túi chống sốc"
          variant="outlined"
          rows="2"
          auto-grow
          density="comfortable"
          hide-details
          class="mb-3"
        />

        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-2">
          {{ error }}
        </v-alert>
      </div>

      <!-- Footer -->
      <div class="pa-4 border-t flex-shrink-0">
        <div class="text-caption text-medium-emphasis mb-2">
          <v-icon icon="ri-shield-check-line" size="14" />
          Tất cả chạy trong một giao dịch — lỗi ở bất kỳ bước nào thì không có gì thay đổi.
        </div>
        <div class="d-flex gap-2">
          <v-btn variant="outlined" color="grey" class="flex-grow-1" @click="close">
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            class="flex-grow-1"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submit"
          >
            Cấp phát
          </v-btn>
        </div>
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.step-label {
  display: flex;
  align-items: center;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.license-row {
  transition: all 0.15s;
}
.gap-2 { gap: 8px; }
</style>
