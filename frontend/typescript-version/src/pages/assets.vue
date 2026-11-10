<script setup lang="ts">
import { ref } from 'vue'
import { useAssetStore, type UnifiedAsset } from '@/stores/useAssetStore'
import AssetTable from '@/components/assets/AssetTable.vue'
import AssetFormModal from '@/components/assets/AssetFormModal.vue'
import AssetDetailModal from '@/components/assets/AssetDetailModal.vue'
import AssetAllocationModal from '@/components/assets/AssetAllocationModal.vue'

const store = useAssetStore()

// State quản lý modals
const isFormModalOpen = ref(false)
const isDetailModalOpen = ref(false)
const isAllocationModalOpen = ref(false)
const allocationMode = ref<'ALLOCATE' | 'REVOKE'>('ALLOCATE')
const allocationIdToRevoke = ref<string | null>(null)

const selectedAsset = ref<UnifiedAsset | null>(null)
const isSubmitting = ref(false)

// Snackbar thông báo
const snackbar = ref({
  show: false,
  text: '',
  color: 'success',
})

const showToast = (text: string, color: 'success' | 'info' | 'warning' | 'error' = 'success') => {
  snackbar.value = {
    show: true,
    text,
    color,
  }
}

// 1. Thao tác Mở Form Tạo Mới / Sửa
const handleOpenCreate = () => {
  selectedAsset.value = null
  isFormModalOpen.value = true
}

const handleOpenEdit = (item: UnifiedAsset) => {
  selectedAsset.value = item
  isDetailModalOpen.value = false
  isFormModalOpen.value = true
}

// 2. Thao tác Xem chi tiết
const handleOpenDetail = (item: UnifiedAsset) => {
  selectedAsset.value = item
  isDetailModalOpen.value = true
}

// 3. Thao tác Cấp phát
const handleOpenAllocate = (item: UnifiedAsset) => {
  selectedAsset.value = item
  allocationMode.value = 'ALLOCATE'
  allocationIdToRevoke.value = null
  isAllocationModalOpen.value = true
}

// 4. Thao tác Thu hồi
const handleOpenRevoke = (item: UnifiedAsset, allocationId?: string) => {
  selectedAsset.value = item
  allocationMode.value = 'REVOKE'
  allocationIdToRevoke.value = allocationId || null
  isAllocationModalOpen.value = true
}

// 5. Thao tác Xóa
const handleDeleteAsset = (item: UnifiedAsset) => {
  if (confirm(`Bạn có chắc chắn muốn xóa tài sản "${item.name}" (${item.code}) không?`)) {
    store.deleteAsset(item.id)
    showToast(`Đã xóa thành công tài sản ${item.code}`, 'warning')
  }
}

// 6. Xử lý lưu Form (Create / Update)
const handleSaveAsset = async (data: Omit<UnifiedAsset, 'id' | 'updatedAt'>) => {
  isSubmitting.value = true
  try {
    if (selectedAsset.value) {
      // Cập nhật
      store.updateAsset(selectedAsset.value.id, data)
      showToast(`Đã cập nhật tài sản ${selectedAsset.value.code} thành công!`)
    } else {
      // Tạo mới
      const created = store.createAsset(data)
      showToast(`Đã thêm mới tài sản ${created.code} thành công!`)
    }
    isFormModalOpen.value = false
  } finally {
    isSubmitting.value = false
  }
}

// 7. Xác nhận Cấp phát từ Modal
const handleConfirmAllocate = (data: {
  assetId: string
  employeeName: string
  employeeEmail: string
  department: string
  note: string
}) => {
  isSubmitting.value = true
  try {
    const success = store.allocateAsset(data.assetId, {
      employeeName: data.employeeName,
      employeeEmail: data.employeeEmail,
      department: data.department,
      note: data.note,
    })

    if (success) {
      showToast(`Đã cấp phát tài sản cho ${data.employeeName} thành công!`)
      isAllocationModalOpen.value = false
      // Cập nhật lại asset đang xem trong detail modal nếu đang mở
      if (selectedAsset.value && selectedAsset.value.id === data.assetId) {
        selectedAsset.value = store.assets.find(a => a.id === data.assetId) || null
      }
    }
  } finally {
    isSubmitting.value = false
  }
}

// 8. Xác nhận Thu hồi từ Modal
const handleConfirmRevoke = (data: {
  assetId: string
  allocationId: string
  reason: string
}) => {
  isSubmitting.value = true
  try {
    const success = store.revokeAllocation(data.assetId, data.allocationId, data.reason)
    if (success) {
      showToast('Đã thu hồi quyền sử dụng tài sản thành công!', 'info')
      isAllocationModalOpen.value = false
      if (selectedAsset.value && selectedAsset.value.id === data.assetId) {
        selectedAsset.value = store.assets.find(a => a.id === data.assetId) || null
      }
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="assets-page-wrapper">
    <!-- Tiêu đề trang -->
    <div class="d-flex align-center justify-space-between mb-4 flex-wrap gap-2">
      <div>
        <h2 class="text-h5 font-weight-bold">Quản lý Tài sản Hợp nhất</h2>
        <p class="text-caption text-medium-emphasis mb-0">
          Quản lý vòng đời toàn diện cho Thiết bị Phần cứng (Physical) và Tài nguyên số / Bản quyền (Digital)
        </p>
      </div>
    </div>

    <!-- Bảng danh sách & Bộ lọc chính -->
    <AssetTable
      @create="handleOpenCreate"
      @edit="handleOpenEdit"
      @view="handleOpenDetail"
      @delete="handleDeleteAsset"
      @allocate="handleOpenAllocate"
      @revoke="handleOpenRevoke"
    />

    <!-- Modal Form Thêm/Sửa -->
    <AssetFormModal
      v-model="isFormModalOpen"
      :asset-to-edit="selectedAsset"
      :loading="isSubmitting"
      @save="handleSaveAsset"
    />

    <!-- Modal Xem Chi Tiết -->
    <AssetDetailModal
      v-model="isDetailModalOpen"
      :asset="selectedAsset"
      @allocate="handleOpenAllocate"
      @revoke="handleOpenRevoke"
      @edit="handleOpenEdit"
    />

    <!-- Modal Cấp phát / Thu hồi -->
    <AssetAllocationModal
      v-model="isAllocationModalOpen"
      :asset="selectedAsset"
      :mode="allocationMode"
      :allocation-id-to-revoke="allocationIdToRevoke"
      :loading="isSubmitting"
      @confirm-allocate="handleConfirmAllocate"
      @confirm-revoke="handleConfirmRevoke"
    />

    <!-- Toast Snackbar -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      location="top right"
      :timeout="3500"
    >
      {{ snackbar.text }}
      <template #actions>
        <v-btn variant="text" size="small" icon="ri-close-line" @click="snackbar.show = false" />
      </template>
    </v-snackbar>
  </div>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>


<style scoped>
.gap-2 {
  gap: 8px;
}
</style>