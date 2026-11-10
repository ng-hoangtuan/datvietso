<script setup lang="ts">
import { ref, watch } from 'vue'
import type { UnifiedAsset } from '@/stores/useAssetStore'

interface Props {
  modelValue: boolean
  asset: UnifiedAsset | null
  mode: 'ALLOCATE' | 'REVOKE'
  allocationIdToRevoke?: string | null
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  allocationIdToRevoke: null,
  loading: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (
    e: 'confirmAllocate',
    data: {
      assetId: string
      employeeName: string
      employeeEmail: string
      department: string
      note: string
    }
  ): void
  (
    e: 'confirmRevoke',
    data: {
      assetId: string
      allocationId: string
      reason: string
    }
  ): void
}>()

const formRef = ref<any>(null)

// Allocate form fields
const employeeName = ref('')
const employeeEmail = ref('')
const department = ref('Phòng Kỹ Thuật (Tech)')
const note = ref('')

// Revoke form fields
const revokeReason = ref('Thu hồi do chuyển đổi dự án / luân chuyển công tác')
const selectedAllocationId = ref('')

const departments = [
  'Phòng Kỹ Thuật (Tech)',
  'Phòng Sản Phẩm & Thiết Kế (UI/UX)',
  'Phòng Kinh Doanh & Marketing',
  'Phòng Nhân Sự & Hành Chính (HR)',
  'Ban Lãnh Đạo & Điều Hành',
]

const revokeReasons = [
  'Thu hồi do chuyển đổi dự án / luân chuyển công tác',
  'Nhân sự nghỉ việc (Offboarding)',
  'Thiết bị cần bảo hành / sửa chữa định kỳ',
  'Hết hạn thời gian dự án',
  'Thu hồi theo yêu cầu bảo mật',
]

watch(
  () => props.modelValue,
  (val) => {
    if (val && props.asset) {
      employeeName.value = ''
      employeeEmail.value = ''
      note.value = ''

      if (props.mode === 'REVOKE') {
        const activeAllocations = props.asset.allocations?.filter(a => a.status === 'ACTIVE') || []
        if (props.allocationIdToRevoke) {
          selectedAllocationId.value = props.allocationIdToRevoke
        } else if (activeAllocations.length > 0) {
          selectedAllocationId.value = activeAllocations[0].id
        }
      }
    }
  }
)

const rules = {
  required: (v: any) => !!v || 'Vui lòng không để trống',
}

const handleSubmit = async () => {
  const { valid } = await formRef.value?.validate()
  if (!valid) return
  if (!props.asset) return

  if (props.mode === 'ALLOCATE') {
    emit('confirmAllocate', {
      assetId: props.asset.id,
      employeeName: employeeName.value,
      employeeEmail: employeeEmail.value,
      department: department.value,
      note: note.value,
    })
  } else {
    emit('confirmRevoke', {
      assetId: props.asset.id,
      allocationId: selectedAllocationId.value,
      reason: revokeReason.value,
    })
  }
}

const handleClose = () => {
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="props.modelValue" @update:model-value="handleClose" max-width="560px" persistent>
    <v-card v-if="props.asset" class="rounded-lg">
      <v-card-title class="d-flex align-center justify-space-between px-6 pt-5 pb-3">
        <div class="d-flex align-center gap-2">
          <v-avatar :color="props.mode === 'ALLOCATE' ? 'success' : 'warning'" variant="tonal" size="36">
            <v-icon :icon="props.mode === 'ALLOCATE' ? 'ri-user-shared-line' : 'ri-arrow-go-back-line'" size="20" />
          </v-avatar>
          <div>
            <div class="text-h6 font-weight-bold">
              {{ props.mode === 'ALLOCATE' ? 'Cấp phát tài sản' : 'Thu hồi tài sản' }}
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ props.asset.name }} ({{ props.asset.code }})
            </div>
          </div>
        </div>
        <v-btn icon="ri-close-line" variant="text" size="small" @click="handleClose" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-6">
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <!-- Trường hợp CẤP PHÁT -->
          <template v-if="props.mode === 'ALLOCATE'">
            <v-alert
              v-if="props.asset.assetKind === 'DIGITAL' && props.asset.digitalMeta?.totalSeats"
              color="info"
              variant="tonal"
              density="compact"
              class="mb-4"
              icon="ri-information-line"
            >
              Tài nguyên số dạng multi-seat: Hiện còn
              <strong>{{ (props.asset.digitalMeta.totalSeats || 0) - (props.asset.digitalMeta.usedSeats || 0) }}</strong>
              ghế trống trên tổng số {{ props.asset.digitalMeta.totalSeats }} ghế.
            </v-alert>

            <v-row dense>
              <v-col cols="12">
                <v-text-field
                  v-model="employeeName"
                  label="Họ và tên nhân sự *"
                  placeholder="VD: Trần Thanh Tuyền"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-user-line"
                />
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="employeeEmail"
                  label="Email công ty nhân sự *"
                  placeholder="VD: tuyen.tt@datvietso.vn"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-mail-line"
                />
              </v-col>

              <v-col cols="12">
                <v-select
                  v-model="department"
                  :items="departments"
                  label="Phòng ban trực thuộc *"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-community-line"
                />
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="note"
                  label="Ghi chú cấp phát"
                  placeholder="VD: Cấp phục vụ công việc phát triển dự án Q4"
                  variant="outlined"
                  density="comfortable"
                  rows="2"
                  prepend-inner-icon="ri-file-text-line"
                />
              </v-col>
            </v-row>
          </template>

          <!-- Trường hợp THU HỒI -->
          <template v-else>
            <v-row dense>
              <v-col cols="12">
                <v-select
                  v-model="selectedAllocationId"
                  :items="props.asset.allocations?.filter(a => a.status === 'ACTIVE') || []"
                  item-title="employeeName"
                  item-value="id"
                  label="Chọn nhân sự cần thu hồi *"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-user-unfollow-line"
                >
                  <template #item="{ item, props: itemProps }">
                    <v-list-item
                      v-bind="itemProps"
                      :title="item.raw.employeeName"
                      :subtitle="`${item.raw.employeeEmail} (${item.raw.department})`"
                    />
                  </template>
                </v-select>
              </v-col>

              <v-col cols="12">
                <v-combobox
                  v-model="revokeReason"
                  :items="revokeReasons"
                  label="Lý do thu hồi *"
                  variant="outlined"
                  density="comfortable"
                  :rules="[rules.required]"
                  prepend-inner-icon="ri-question-line"
                />
              </v-col>
            </v-row>
          </template>
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-6 py-4 justify-end gap-2">
        <v-btn variant="outlined" color="grey" @click="handleClose">
          Hủy bỏ
        </v-btn>
        <v-btn
          :color="props.mode === 'ALLOCATE' ? 'success' : 'warning'"
          :loading="props.loading"
          @click="handleSubmit"
        >
          {{ props.mode === 'ALLOCATE' ? 'Xác nhận cấp phát' : 'Xác nhận thu hồi' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-2 { gap: 8px; }
</style>

