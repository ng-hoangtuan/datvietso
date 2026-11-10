<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type {
  UnifiedAsset,
  AssetKind,
  AssetStatus,
  DigitalType,
} from '@/stores/useAssetStore'

interface Props {
  modelValue: boolean
  assetToEdit?: UnifiedAsset | null
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  assetToEdit: null,
  loading: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', assetData: Omit<UnifiedAsset, 'id' | 'updatedAt'>): void
}>()

const formRef = ref<any>(null)
const showSecret = ref(false)

// State form chính
const formData = ref({
  assetKind: 'PHYSICAL' as AssetKind,
  code: '',
  name: '',
  category: '',
  status: 'AVAILABLE' as AssetStatus,
  manager: '',

  // Physical Fields
  physicalMeta: {
    serialNumber: '',
    model: '',
    location: '',
    condition: 'Mới 100%',
  },

  // Digital Fields
  digitalMeta: {
    provider: 'Google Workspace',
    digitalType: 'account' as DigitalType,
    username: '',
    licenseKey: '',
    recoveryEmail: '',
    accessRole: 'Member',
    totalSeats: 1,
    usedSeats: 0,
    expiresAt: '',
    costMonthly: 0,
    storageUrl: '',
  },
})

// Danh sách gợi ý
const physicalCategoryOptions = [
  'Thiết bị IT',
  'Máy trạm / Laptop',
  'Màn hình hiển thị',
  'Thiết bị mạng & Server',
  'Thiết bị văn phòng',
  'Nội thất văn phòng',
  'Khác',
]

const digitalCategoryOptions = [
  'Tài khoản dịch vụ (SaaS)',
  'Phần mềm bản quyền',
  'Cloud Infrastructure',
  'Mã nguồn & Repository',
  'Thiết kế & Đồ họa',
  'Tên miền & SSL',
  'Khác',
]

const providerList = [
  'Google Workspace',
  'Microsoft 365',
  'AWS',
  'GitLab',
  'GitHub',
  'JetBrains',
  'Figma',
  'Adobe Creative Cloud',
  'Notion',
  'Slack',
  'Khác',
]

const digitalTypeOptions = [
  { title: 'Tài khoản cá nhân (1 User - 1 Account)', value: 'account' },
  { title: 'Bản quyền chia sẻ nhiều ghế (Multi-seat License)', value: 'license' },
  { title: 'Tài khoản dùng chung (Shared Account)', value: 'shared-account' },
  { title: 'Tài khoản Đám mây / Cloud IAM', value: 'cloud-credential' },
]

const statusOptions = [
  { title: 'Sẵn sàng cấp phát (Available)', value: 'AVAILABLE' },
  { title: 'Đang sử dụng (Active)', value: 'ACTIVE' },
  { title: 'Chờ kích hoạt (Pending)', value: 'PENDING_ACTIVATION' },
  { title: 'Đang bảo trì (Maintenance)', value: 'MAINTENANCE' },
  { title: 'Hết hạn bản quyền (Expired)', value: 'EXPIRED' },
  { title: 'Tạm khóa (Suspended)', value: 'SUSPENDED' },
  { title: 'Đã thanh lý (Liquidated)', value: 'LIQUIDATED' },
]

const conditionOptions = [
  'Mới 100%',
  'Đang hoạt động tốt (90-99%)',
  'Đã qua sử dụng (70-89%)',
  'Cần bảo trì / Sửa chữa',
  'Hỏng hóc',
]

const accessRoleOptions = [
  'Owner / Root',
  'Administrator',
  'Developer',
  'Editor',
  'Member / User',
  'Viewer / Read-only',
]

const isEditMode = computed(() => !!props.assetToEdit)

// Watchers
watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      if (props.assetToEdit) {
        formData.value = {
          assetKind: props.assetToEdit.assetKind,
          code: props.assetToEdit.code,
          name: props.assetToEdit.name,
          category: props.assetToEdit.category,
          status: props.assetToEdit.status,
          manager: props.assetToEdit.manager || '',
          physicalMeta: {
            serialNumber: props.assetToEdit.physicalMeta?.serialNumber || '',
            model: props.assetToEdit.physicalMeta?.model || '',
            location: props.assetToEdit.physicalMeta?.location || '',
            condition: props.assetToEdit.physicalMeta?.condition || 'Mới 100%',
          },
          digitalMeta: {
            provider: props.assetToEdit.digitalMeta?.provider || 'Google Workspace',
            digitalType: props.assetToEdit.digitalMeta?.digitalType || 'account',
            username: props.assetToEdit.digitalMeta?.username || '',
            licenseKey: props.assetToEdit.digitalMeta?.licenseKey || '',
            recoveryEmail: props.assetToEdit.digitalMeta?.recoveryEmail || '',
            accessRole: props.assetToEdit.digitalMeta?.accessRole || 'Member',
            totalSeats: props.assetToEdit.digitalMeta?.totalSeats || 1,
            usedSeats: props.assetToEdit.digitalMeta?.usedSeats || 0,
            expiresAt: props.assetToEdit.digitalMeta?.expiresAt || '',
            costMonthly: props.assetToEdit.digitalMeta?.costMonthly || 0,
            storageUrl: props.assetToEdit.digitalMeta?.storageUrl || '',
          },
        }
      } else {
        // Reset form khi tạo mới
        const randomCode = formData.value.assetKind === 'DIGITAL'
          ? `TS-DIG-${Math.floor(100 + Math.random() * 900)}`
          : `TS-PHY-${Math.floor(100 + Math.random() * 900)}`

        formData.value = {
          assetKind: 'PHYSICAL',
          code: randomCode,
          name: '',
          category: 'Thiết bị IT',
          status: 'AVAILABLE',
          manager: '',
          physicalMeta: {
            serialNumber: '',
            model: '',
            location: 'Văn phòng chính',
            condition: 'Mới 100%',
          },
          digitalMeta: {
            provider: 'Google Workspace',
            digitalType: 'account',
            username: '',
            licenseKey: '',
            recoveryEmail: '',
            accessRole: 'Member',
            totalSeats: 1,
            usedSeats: 0,
            expiresAt: '',
            costMonthly: 0,
            storageUrl: '',
          },
        }
      }
    }
  }
)

// Đổi tiền tố mã khi đổi assetKind
const handleKindChange = (kind: AssetKind) => {
  if (!isEditMode.value) {
    formData.value.code = kind === 'DIGITAL'
      ? `TS-DIG-${Math.floor(100 + Math.random() * 900)}`
      : `TS-PHY-${Math.floor(100 + Math.random() * 900)}`

    formData.value.category = kind === 'DIGITAL' ? 'Tài khoản dịch vụ (SaaS)' : 'Thiết bị IT'
  }
}

// Rules
const rules = {
  required: (v: any) => !!v || 'Trường này là bắt buộc',
  positiveNumber: (v: any) => Number(v) >= 1 || 'Phải lớn hơn hoặc bằng 1',
}

// Submit
const handleSave = async () => {
  const { valid } = await formRef.value?.validate()
  if (!valid) return

  const payload: Omit<UnifiedAsset, 'id' | 'updatedAt'> = {
    assetKind: formData.value.assetKind,
    code: formData.value.code,
    name: formData.value.name,
    category: formData.value.category,
    status: formData.value.status,
    manager: formData.value.manager,
  }

  if (formData.value.assetKind === 'PHYSICAL') {
    payload.physicalMeta = { ...formData.value.physicalMeta }
  } else {
    payload.digitalMeta = { ...formData.value.digitalMeta }
  }

  emit('save', payload)
}

const handleClose = () => {
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="props.modelValue" @update:model-value="handleClose" max-width="800px" persistent scrollable>
    <v-card class="rounded-lg">
      <!-- Header Dialog -->
      <v-card-title class="d-flex align-center justify-space-between px-6 pt-5 pb-3">
        <div class="d-flex align-center gap-2">
          <v-avatar :color="formData.assetKind === 'DIGITAL' ? 'info' : 'primary'" variant="tonal" size="36">
            <v-icon :icon="formData.assetKind === 'DIGITAL' ? 'ri-cloud-line' : 'ri-computer-line'" size="20" />
          </v-avatar>
          <div>
            <div class="text-h6 font-weight-bold">
              {{ isEditMode ? 'Chỉnh sửa tài sản' : 'Thêm mới tài sản' }}
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ formData.assetKind === 'DIGITAL' ? 'Quản lý tài nguyên số, bản quyền, Cloud & Account' : 'Quản lý thiết bị phần cứng & tài sản vật lý' }}
            </div>
          </div>
        </div>
        <v-btn icon="ri-close-line" variant="text" size="small" @click="handleClose" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-6" style="max-height: 70vh;">
        <v-form ref="formRef" @submit.prevent="handleSave">
          <!-- Phân loại tài sản (Tabs / Button Group) -->
          <div class="mb-5">
            <label class="text-caption font-weight-bold text-medium-emphasis d-block mb-2">LOẠI TÀI SẢN (ASSET KIND)</label>
            <v-btn-toggle
              v-model="formData.assetKind"
              mandatory
              color="primary"
              variant="outlined"
              divided
              class="w-100 kind-toggle"
              :disabled="isEditMode"
              @update:model-value="handleKindChange"
            >
              <v-btn value="PHYSICAL" class="flex-grow-1 py-3 text-none">
                <v-icon icon="ri-computer-line" class="mr-2" />
                Thiết bị Hữu hình (Physical)
              </v-btn>
              <v-btn value="DIGITAL" class="flex-grow-1 py-3 text-none">
                <v-icon icon="ri-cloud-line" class="mr-2" />
                Tài nguyên Số / Bản quyền (Digital)
              </v-btn>
            </v-btn-toggle>
          </div>

          <!-- Section 1: Thông tin chung -->
          <div class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center text-primary">
            <v-icon icon="ri-information-line" size="18" class="mr-2" />
            1. THÔNG TIN CƠ BẢN
          </div>

          <v-row dense>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="formData.code"
                label="Mã tài sản *"
                placeholder="VD: TS-PHY-001"
                variant="outlined"
                density="comfortable"
                :rules="[rules.required]"
                prepend-inner-icon="ri-barcode-line"
              />
            </v-col>

            <v-col cols="12" sm="8">
              <v-text-field
                v-model="formData.name"
                label="Tên tài sản *"
                :placeholder="formData.assetKind === 'DIGITAL' ? 'VD: JetBrains All Products Pack hoặc AWS Production' : 'VD: MacBook Pro 16 M3 Max'"
                variant="outlined"
                density="comfortable"
                :rules="[rules.required]"
                prepend-inner-icon="ri-article-line"
              />
            </v-col>

            <v-col cols="12" sm="4">
              <v-select
                v-model="formData.category"
                :items="formData.assetKind === 'DIGITAL' ? digitalCategoryOptions : physicalCategoryOptions"
                label="Danh mục tài sản *"
                variant="outlined"
                density="comfortable"
                :rules="[rules.required]"
                prepend-inner-icon="ri-folder-line"
              />
            </v-col>

            <v-col cols="12" sm="4">
              <v-select
                v-model="formData.status"
                :items="statusOptions"
                item-title="title"
                item-value="value"
                label="Trạng thái *"
                variant="outlined"
                density="comfortable"
                :rules="[rules.required]"
                prepend-inner-icon="ri-pulse-line"
              />
            </v-col>

            <v-col cols="12" sm="4">
              <v-text-field
                v-model="formData.manager"
                label="Người phụ trách / Lead"
                placeholder="VD: Nguyễn Hoàng Tuấn"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="ri-user-star-line"
              />
            </v-col>
          </v-row>

          <v-divider class="my-4" />

          <!-- Section 2A: Thuộc tính Digital Asset -->
          <template v-if="formData.assetKind === 'DIGITAL'">
            <div class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center text-info">
              <v-icon icon="ri-shield-keyhole-line" size="18" class="mr-2" />
              2. THUỘC TÍNH TÀI NGUYÊN SỐ & BẢN QUYỀN
            </div>

            <v-row dense>
              <v-col cols="12" sm="6">
                <v-combobox
                  v-model="formData.digitalMeta.provider"
                  :items="providerList"
                  label="Nhà cung cấp / Nền tảng (Provider) *"
                  placeholder="Chọn hoặc nhập tên Provider"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-global-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.digitalMeta.digitalType"
                  :items="digitalTypeOptions"
                  item-title="title"
                  item-value="value"
                  label="Mô hình tài nguyên *"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-node-tree"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.digitalMeta.username"
                  label="Username / Email định danh"
                  placeholder="VD: tuan.nh@company.com hoặc aws-admin"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-mail-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.digitalMeta.recoveryEmail"
                  label="Email khôi phục quản trị"
                  placeholder="VD: it-security@company.com"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-mail-lock-line"
                />
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="formData.digitalMeta.licenseKey"
                  :type="showSecret ? 'text' : 'password'"
                  label="License Key / API Secret / Password khởi tạo"
                  placeholder="Nhập khóa bản quyền hoặc chuỗi chứng thực"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-key-2-line"
                  :append-inner-icon="showSecret ? 'ri-eye-off-line' : 'ri-eye-line'"
                  @click:append-inner="showSecret = !showSecret"
                  hint="Dữ liệu nhạy cảm được che giấu theo mặc định"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="4">
                <v-combobox
                  v-model="formData.digitalMeta.accessRole"
                  :items="accessRoleOptions"
                  label="Vai trò / Quyền hạn (Role)"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-shield-user-line"
                />
              </v-col>

              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="formData.digitalMeta.totalSeats"
                  type="number"
                  min="1"
                  label="Tổng số ghế (Total Seats)"
                  placeholder="1 nếu là tài khoản đơn"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.positiveNumber]"
                  prepend-inner-icon="ri-group-line"
                />
              </v-col>

              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="formData.digitalMeta.expiresAt"
                  type="date"
                  label="Ngày hết hạn bản quyền"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-calendar-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="formData.digitalMeta.costMonthly"
                  type="number"
                  label="Chi phí định kỳ (VND / Tháng)"
                  placeholder="VD: 500000"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-money-dollar-circle-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.digitalMeta.storageUrl"
                  label="Link quản trị / Console URL"
                  placeholder="https://console.aws.amazon.com/..."
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-external-link-line"
                />
              </v-col>
            </v-row>
          </template>

          <!-- Section 2B: Thuộc tính Physical Asset -->
          <template v-else>
            <div class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center text-primary">
              <v-icon icon="ri-computer-line" size="18" class="mr-2" />
              2. THUỘC TÍNH THIẾT BỊ HỮU HÌNH
            </div>

            <v-row dense>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.physicalMeta.serialNumber"
                  label="Số Serial Number (S/N) *"
                  placeholder="VD: C02G9988MD6R"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-qr-code-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.physicalMeta.model"
                  label="Model / Đời thiết bị"
                  placeholder="VD: MacBook Pro 16 inch 2023"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-cpu-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="formData.physicalMeta.location"
                  label="Vị trí lưu trữ / Bàn làm việc"
                  placeholder="VD: Tầng 4 - Phòng Kỹ thuật"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-map-pin-line"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="formData.physicalMeta.condition"
                  :items="conditionOptions"
                  label="Tình trạng vật lý"
                  variant="outlined"
                  density="comfortable"
                  prepend-inner-icon="ri-survey-line"
                />
              </v-col>
            </v-row>
          </template>
        </v-form>
      </v-card-text>

      <v-divider />

      <!-- Footer Buttons -->
      <v-card-actions class="px-6 py-4 justify-end gap-2">
        <v-btn variant="outlined" color="grey" @click="handleClose">
          Hủy bỏ
        </v-btn>
        <v-btn color="primary" :loading="props.loading" @click="handleSave">
          <v-icon :icon="isEditMode ? 'ri-save-line' : 'ri-check-line'" class="mr-1" />
          {{ isEditMode ? 'Cập nhật tài sản' : 'Lưu tài sản mới' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
.kind-toggle .v-btn {
  height: 48px;
  font-weight: 600;
}
</style>
