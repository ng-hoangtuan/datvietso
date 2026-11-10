<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChatStore, type ChatUser } from '@/stores/useChatStore'

interface Props {
  modelValue: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'groupCreated', group: any): void
}>()

const store = useChatStore()

const groupName = ref('')
const groupAvatar = ref('https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png')
const selectedUserIds = ref<string[]>([])
const errorMessage = ref('')

// Avatar mẫu để người dùng chọn nhanh
const avatarPresets = [
  'https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png',
  'https://cdn.vuetifyjs.com/images/cards/house.jpg',
  'https://cdn.vuetifyjs.com/images/cards/road.jpg',
  'https://cdn.vuetifyjs.com/images/cards/plane.jpg',
]

// Các contact khả dụng (loại trừ chính tôi vì tôi mặc định là Owner)
const availableContacts = computed(() => {
  return store.contactList.filter(c => c.userId !== store.currentUser.userId)
})

// Tổng số thành viên của nhóm dự kiến (Tôi + những người được chọn)
const totalGroupMembersCount = computed(() => {
  return 1 + selectedUserIds.value.length
})

// Ràng buộc Task 1.3: Tối thiểu 3 thành viên
const isValidMemberCount = computed(() => {
  return totalGroupMembersCount.value >= 3
})

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      groupName.value = ''
      groupAvatar.value = avatarPresets[0]
      selectedUserIds.value = []
      errorMessage.value = ''
    }
  }
)

const handleClose = () => {
  emit('update:modelValue', false)
}

const handleCreateGroup = () => {
  errorMessage.value = ''

  if (!groupName.value.trim()) {
    errorMessage.value = 'Vui lòng nhập tên nhóm chat!'
    return
  }

  // Task 1.3 Validation: Tối thiểu 3 thành viên
  if (!isValidMemberCount.value) {
    errorMessage.value = 'Nhóm chat bắt buộc phải có tối thiểu 3 thành viên (Bạn + ít nhất 2 người khác)!'
    return
  }

  try {
    const selectedUsers: ChatUser[] = store.contactList.filter(c => selectedUserIds.value.includes(c.userId))
    const newGroup = store.createGroup(groupName.value, groupAvatar.value, selectedUsers)
    emit('groupCreated', newGroup)
    emit('update:modelValue', false)
  } catch (err: any) {
    errorMessage.value = err.message || 'Lỗi khi tạo nhóm'
  }
}
</script>

<template>
  <v-dialog :model-value="props.modelValue" @update:model-value="handleClose" max-width="540px" persistent>
    <v-card class="rounded-lg">
      <!-- Header -->
      <v-card-title class="d-flex align-center justify-space-between px-6 pt-5 pb-3">
        <div class="d-flex align-center gap-2">
          <v-avatar color="primary" variant="tonal" size="38">
            <v-icon icon="ri-group-line" size="22" />
          </v-avatar>
          <div>
            <div class="text-h6 font-weight-bold">Tạo nhóm trò chuyện mới</div>
            <div class="text-caption text-medium-emphasis">
              Yêu cầu tối thiểu 3 thành viên để kích hoạt nhóm
            </div>
          </div>
        </div>
        <v-btn icon="ri-close-line" variant="text" size="small" @click="handleClose" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-6">
        <!-- Error Alert -->
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          closable
          @click:close="errorMessage = ''"
        >
          {{ errorMessage }}
        </v-alert>

        <!-- 1. Tên nhóm -->
        <v-text-field
          v-model="groupName"
          label="Tên nhóm chat *"
          placeholder="VD: Nhóm Dự Án Web Realtime"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="ri-team-line"
          class="mb-4"
        />

        <!-- 2. Chọn ảnh đại diện nhóm -->
        <div class="mb-4">
          <label class="text-caption font-weight-bold text-medium-emphasis d-block mb-2">
            CHỌN ẢNH ĐẠI DIỆN NHÓM
          </label>
          <div class="d-flex align-center gap-3">
            <v-avatar
              v-for="url in avatarPresets"
              :key="url"
              size="48"
              class="cursor-pointer preset-avatar"
              :class="{ 'selected-avatar': groupAvatar === url }"
              @click="groupAvatar = url"
            >
              <v-img :src="url" />
            </v-avatar>
          </div>
        </div>

        <!-- 3. Ràng buộc thành viên (Task 1.3) -->
        <div class="mb-2">
          <div class="d-flex align-center justify-space-between mb-2">
            <label class="text-caption font-weight-bold text-medium-emphasis">
              CHỌN THÀNH VIÊN THAM GIA
            </label>
            <v-chip
              size="x-small"
              :color="isValidMemberCount ? 'success' : 'warning'"
              variant="tonal"
              class="font-weight-bold"
            >
              {{ totalGroupMembersCount }}/3 thành viên tối thiểu
            </v-chip>
          </div>

          <v-alert
            v-if="!isValidMemberCount"
            color="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
            icon="ri-error-warning-line"
          >
            Vui lòng chọn thêm ít nhất <strong>{{ 3 - totalGroupMembersCount }}</strong> thành viên nữa để thỏa mãn điều kiện tạo nhóm.
          </v-alert>

          <!-- Danh sách Checkbox thành viên -->
          <v-card variant="outlined" class="rounded max-h-48 overflow-y-auto pa-2">
            <!-- Thành viên mặc định: Tôi (Owner) -->
            <v-list-item class="px-2 py-1 bg-surface-variant rounded mb-1">
              <template #prepend>
                <v-avatar size="32" class="mr-2">
                  <v-img :src="store.currentUser.avatar" />
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-bold">
                {{ store.currentUser.name }} (Bạn)
              </v-list-item-title>
              <template #append>
                <v-chip size="x-small" color="error" variant="tonal">Trưởng nhóm</v-chip>
              </template>
            </v-list-item>

            <!-- Các contact khác -->
            <v-list-item
              v-for="contact in availableContacts"
              :key="contact.userId"
              class="px-2 py-1 rounded cursor-pointer"
              @click="selectedUserIds.includes(contact.userId)
                ? selectedUserIds = selectedUserIds.filter(id => id !== contact.userId)
                : selectedUserIds.push(contact.userId)"
            >
              <template #prepend>
                <v-checkbox
                  v-model="selectedUserIds"
                  :value="contact.userId"
                  density="compact"
                  hide-details
                  class="mr-2"
                  @click.stop
                />
                <v-avatar size="32" class="mr-2">
                  <v-img :src="contact.avatar || 'https://cdn.vuetifyjs.com/images/john.jpg'" />
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ contact.name }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ contact.email }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-card>
        </div>
      </v-card-text>

      <v-divider />

      <!-- Footer Buttons -->
      <v-card-actions class="px-6 py-4 justify-end gap-2">
        <v-btn variant="outlined" color="grey" @click="handleClose">
          Hủy bỏ
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!isValidMemberCount || !groupName.trim()"
          @click="handleCreateGroup"
        >
          <v-icon icon="ri-check-line" class="mr-1" />
          Khởi tạo nhóm
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }

.preset-avatar {
  border: 2px solid transparent;
  transition: all 0.2s;
}
.preset-avatar:hover {
  transform: scale(1.08);
}
.selected-avatar {
  border-color: #7367f0 !important;
  box-shadow: 0 0 8px rgba(115, 103, 240, 0.4);
}
.max-h-48 {
  max-height: 200px;
}
</style>

