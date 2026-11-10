<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChatStore, type GroupRole } from '@/stores/useChatStore'

const store = useChatStore()

// Các mục đang mở (dạng sổ xuống giống Zalo, có thể mở nhiều mục cùng lúc)
type SectionKey = 'members' | 'media' | 'files' | 'links'
const openSections = ref<Record<SectionKey, boolean>>({
  members: true,
  media: true,
  files: false,
  links: false,
})

const toggleSection = (key: SectionKey) => {
  openSections.value[key] = !openSections.value[key]
}

const isAddMemberDialogOpen = ref(false)
const selectedNewMemberIds = ref<string[]>([])

// Giới hạn số ảnh hiển thị ban đầu, bấm "Xem tất cả" để mở rộng
const showAllMedia = ref(false)
const MEDIA_PREVIEW_LIMIT = 6

// Reset trạng thái khi đổi cuộc trò chuyện
watch(() => store.activeRoomId, () => {
  showAllMedia.value = false
})

// Lọc các tin nhắn media/files/links trong phòng hiện tại
const sharedMedia = computed(() => {
  return store.activeMessages.filter(m =>
    !m.isDeleted && m.type === 'media'
    && (m.metadata?.mimetype?.startsWith('image/') || m.metadata?.mimetype?.startsWith('video/')),
  )
})

const visibleMedia = computed(() => {
  return showAllMedia.value ? sharedMedia.value : sharedMedia.value.slice(0, MEDIA_PREVIEW_LIMIT)
})

const sharedFiles = computed(() => {
  return store.activeMessages.filter(m =>
    !m.isDeleted && m.type === 'media'
    && !m.metadata?.mimetype?.startsWith('image/') && !m.metadata?.mimetype?.startsWith('video/'),
  )
})

const sharedLinks = computed(() => {
  return store.activeMessages.filter(m =>
    !m.isDeleted && (m.type === 'location' || (m.type === 'text' && (m.content.includes('http://') || m.content.includes('https://')))),
  )
})

// Danh sách contact chưa có trong nhóm
const availableContactsToAdd = computed(() => {
  const currentMemberIds = new Set(store.activeRoom.members.map(m => String(m.userId)))
  return store.contactList.filter(c => !currentMemberIds.has(String(c.userId)))
})

// Xử lý thêm thành viên mới
const handleAddMembers = () => {
  if (selectedNewMemberIds.value.length === 0) return

  const toAdd = store.contactList.filter(c => selectedNewMemberIds.value.includes(c.userId))
  store.addMembersToCurrentGroup(toAdd)
  selectedNewMemberIds.value = []
  isAddMemberDialogOpen.value = false
}

// Quyền hạn hiện tại của tôi trong nhóm
const isOwner = computed(() => store.activeRoom.myRole === 'owner')
const isAdmin = computed(() => store.activeRoom.myRole === 'admin')
const canManageMembers = computed(() => isOwner.value || isAdmin.value)

// Helper màu sắc vai trò
const getRoleColor = (role?: GroupRole) => {
  switch (role) {
    case 'owner': return 'error'
    case 'admin': return 'primary'
    default: return 'secondary'
  }
}

const getRoleText = (role?: GroupRole) => {
  switch (role) {
    case 'owner': return 'Trưởng nhóm'
    case 'admin': return 'Phó nhóm'
    default: return 'Thành viên'
  }
}

const openUrl = (url?: string) => {
  if (url) window.open(url, '_blank')
}
</script>

<template>
  <div class="user-profile-right-wrapper border-s d-flex flex-column bg-surface">
    <!-- Header Drawer -->
    <div class="px-3 py-2 border-b d-flex align-center justify-space-between flex-shrink-0">
      <span class="text-subtitle-2 font-weight-bold">Thông tin hội thoại</span>
      <v-btn
        icon="ri-close-line"
        variant="text"
        size="small"
        @click="store.isProfileRightOpen = false"
      />
    </div>

    <!-- Nội dung cuộn bên trong panel -->
    <div class="profile-scroll-area">
      <!-- Thông tin tổng quan Avatar & Tên -->
      <div class="pa-4 text-center border-b">
        <v-avatar size="56" class="mb-2">
          <v-img :src="store.activeRoom.avatar" />
        </v-avatar>
        <div class="text-body-1 font-weight-bold text-truncate px-2">
          {{ store.activeRoom.name }}
        </div>
        <div v-if="store.activeRoom.isGroup" class="text-caption text-medium-emphasis">
          {{ store.activeRoom.members.length }} thành viên
        </div>
      </div>

      <!-- ===== MỤC 1: THÀNH VIÊN NHÓM ===== -->
      <div v-if="store.activeRoom.isGroup" class="border-b">
        <div class="section-header" @click="toggleSection('members')">
          <span class="section-title">Thành viên nhóm</span>
          <span class="d-flex align-center gap-1">
            <span class="text-caption text-medium-emphasis">{{ store.activeRoom.members.length }}</span>
            <v-icon :icon="openSections.members ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" size="20" />
          </span>
        </div>

        <v-expand-transition>
          <div v-show="openSections.members" class="section-body">
            <!-- Nút thêm thành viên mới nếu là Owner hoặc Admin -->
            <v-btn
              v-if="canManageMembers"
              color="primary"
              variant="tonal"
              block
              size="small"
              prepend-icon="ri-user-add-line"
              class="mb-2 text-none"
              @click="isAddMemberDialogOpen = true"
            >
              Thêm thành viên
            </v-btn>

            <div
              v-for="member in store.activeRoom.members"
              :key="member.userId"
              class="member-row d-flex align-center"
            >
              <!-- Avatar + Online dot (Task 1.2) -->
              <div class="position-relative mr-2 flex-shrink-0">
                <v-avatar size="32">
                  <v-img :src="member.avatar || 'https://cdn.vuetifyjs.com/images/john.jpg'" />
                </v-avatar>
                <span
                  class="status-indicator-mini"
                  :class="store.isUserOnline(member.userId) ? 'online' : 'offline'"
                />
              </div>

              <div class="flex-grow-1 overflow-hidden">
                <div class="text-body-2 font-weight-medium text-truncate">
                  {{ member.name }}
                  <span v-if="String(member.userId) === String(store.currentUser.userId)" class="text-caption text-disabled">(Tôi)</span>
                </div>
                <v-chip size="x-small" :color="getRoleColor(member.role)" variant="tonal" class="font-weight-medium mt-1">
                  {{ getRoleText(member.role) }}
                </v-chip>
              </div>

              <!-- Menu phân quyền / nhường quyền (Task 1.4: Chỉ Owner) -->
              <v-menu v-if="isOwner && String(member.userId) !== String(store.currentUser.userId)" location="bottom end">
                <template #activator="{ props: menuProps }">
                  <v-btn
                    v-bind="menuProps"
                    icon="ri-more-2-line"
                    size="x-small"
                    variant="text"
                    color="grey"
                  />
                </template>
                <v-list density="compact">
                  <!-- Bổ nhiệm phó nhóm -->
                  <v-list-item
                    v-if="member.role === 'member'"
                    prepend-icon="ri-shield-user-line"
                    title="Bổ nhiệm làm Phó nhóm"
                    @click="store.changeMemberRole(member.userId, 'admin')"
                  />
                  <!-- Miễn nhiệm phó nhóm -->
                  <v-list-item
                    v-if="member.role === 'admin'"
                    prepend-icon="ri-user-unfollow-line"
                    title="Miễn nhiệm Phó nhóm"
                    @click="store.changeMemberRole(member.userId, 'member')"
                  />
                  <!-- Nhường quyền trưởng nhóm -->
                  <v-list-item
                    prepend-icon="ri-vip-crown-line"
                    title="Nhường quyền Trưởng nhóm"
                    class="text-warning"
                    @click="store.changeMemberRole(member.userId, 'owner')"
                  />
                  <v-divider class="my-1" />
                  <!-- Xóa khỏi nhóm -->
                  <v-list-item
                    prepend-icon="ri-delete-bin-line"
                    title="Xóa khỏi nhóm"
                    class="text-error"
                    @click="store.removeMemberFromGroup(member.userId)"
                  />
                </v-list>
              </v-menu>
            </div>
          </div>
        </v-expand-transition>
      </div>

      <!-- ===== MỤC 2: ẢNH / VIDEO (Task 3.2) ===== -->
      <div class="border-b">
        <div class="section-header" @click="toggleSection('media')">
          <span class="section-title">Ảnh/Video</span>
          <span class="d-flex align-center gap-1">
            <span class="text-caption text-medium-emphasis">{{ sharedMedia.length }}</span>
            <v-icon :icon="openSections.media ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" size="20" />
          </span>
        </div>

        <v-expand-transition>
          <div v-show="openSections.media" class="section-body">
            <div v-if="sharedMedia.length > 0">
              <div class="media-grid">
                <div
                  v-for="m in visibleMedia"
                  :key="m.id"
                  class="media-cell"
                  @click="openUrl(m.metadata?.fileUrl)"
                >
                  <img
                    v-if="m.metadata?.mimetype?.startsWith('image/')"
                    :src="m.metadata?.fileUrl"
                    :alt="m.metadata?.filename"
                  >
                  <template v-else>
                    <video :src="m.metadata?.fileUrl" muted preload="metadata" />
                    <span class="video-badge">
                      <v-icon icon="ri-play-fill" size="16" color="white" />
                    </span>
                  </template>
                </div>
              </div>
              <v-btn
                v-if="sharedMedia.length > MEDIA_PREVIEW_LIMIT"
                block
                variant="tonal"
                color="secondary"
                size="small"
                class="mt-2 text-none"
                @click="showAllMedia = !showAllMedia"
              >
                {{ showAllMedia ? 'Thu gọn' : 'Xem tất cả' }}
              </v-btn>
            </div>
            <div v-else class="empty-text">
              Chưa có ảnh/video được chia sẻ
            </div>
          </div>
        </v-expand-transition>
      </div>

      <!-- ===== MỤC 3: FILE (Task 3.2) ===== -->
      <div class="border-b">
        <div class="section-header" @click="toggleSection('files')">
          <span class="section-title">File</span>
          <span class="d-flex align-center gap-1">
            <span class="text-caption text-medium-emphasis">{{ sharedFiles.length }}</span>
            <v-icon :icon="openSections.files ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" size="20" />
          </span>
        </div>

        <v-expand-transition>
          <div v-show="openSections.files" class="section-body">
            <div
              v-for="f in sharedFiles"
              :key="f.id"
              class="item-row d-flex align-center"
            >
              <v-avatar color="primary" variant="tonal" size="34" rounded="lg" class="mr-2 flex-shrink-0">
                <v-icon icon="ri-file-text-line" size="18" />
              </v-avatar>
              <div class="flex-grow-1 overflow-hidden">
                <div class="text-body-2 font-weight-medium text-truncate" :title="f.metadata?.filename || f.content">
                  {{ f.metadata?.filename || f.content }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ f.metadata?.fileSize || 'Tệp tin' }} • {{ f.time }}
                </div>
              </div>
              <v-btn
                icon="ri-download-line"
                size="x-small"
                variant="text"
                :href="f.metadata?.fileUrl"
                download
              />
            </div>

            <div v-if="sharedFiles.length === 0" class="empty-text">
              Chưa có file được chia sẻ
            </div>
          </div>
        </v-expand-transition>
      </div>

      <!-- ===== MỤC 4: LINK & VỊ TRÍ (Task 3.2) ===== -->
      <div class="border-b">
        <div class="section-header" @click="toggleSection('links')">
          <span class="section-title">Link</span>
          <span class="d-flex align-center gap-1">
            <span class="text-caption text-medium-emphasis">{{ sharedLinks.length }}</span>
            <v-icon :icon="openSections.links ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'" size="20" />
          </span>
        </div>

        <v-expand-transition>
          <div v-show="openSections.links" class="section-body">
            <div
              v-for="l in sharedLinks"
              :key="l.id"
              class="item-row d-flex align-center"
            >
              <v-avatar color="info" variant="tonal" size="34" rounded="lg" class="mr-2 flex-shrink-0">
                <v-icon :icon="l.type === 'location' ? 'ri-map-pin-line' : 'ri-links-line'" size="18" />
              </v-avatar>
              <div class="flex-grow-1 overflow-hidden">
                <div class="text-body-2 font-weight-medium text-truncate" :title="l.content">
                  {{ l.content }}
                </div>
                <div class="text-caption text-medium-emphasis text-truncate">
                  {{ l.senderName }} • {{ l.time }}
                </div>
              </div>
              <v-btn
                v-if="l.type === 'location' && l.metadata?.lat"
                icon="ri-external-link-line"
                size="x-small"
                variant="text"
                :href="`https://maps.google.com/?q=${l.metadata.lat},${l.metadata.lng}`"
                target="_blank"
              />
            </div>

            <div v-if="sharedLinks.length === 0" class="empty-text">
              Chưa có link được chia sẻ
            </div>
          </div>
        </v-expand-transition>
      </div>
    </div>

    <!-- Dialog thêm thành viên mới vào nhóm -->
    <v-dialog v-model="isAddMemberDialogOpen" max-width="480px">
      <v-card class="rounded-lg">
        <v-card-title class="px-5 pt-4 pb-2 text-h6 font-weight-bold">
          Thêm thành viên vào nhóm
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <v-autocomplete
            v-model="selectedNewMemberIds"
            :items="availableContactsToAdd"
            item-title="name"
            item-value="userId"
            multiple
            chips
            closable-chips
            label="Chọn nhân sự cần thêm"
            placeholder="Tìm kiếm theo tên..."
            variant="outlined"
            density="comfortable"
          >
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps" :subtitle="item.raw.email" />
            </template>
          </v-autocomplete>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-5 py-3 justify-end gap-2">
          <v-btn variant="outlined" color="grey" @click="isAddMemberDialogOpen = false">
            Hủy
          </v-btn>
          <v-btn
            color="primary"
            :disabled="selectedNewMemberIds.length === 0"
            @click="handleAddMembers"
          >
            Thêm vào nhóm
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.user-profile-right-wrapper {
  width: 320px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Chỉ phần nội dung bên trong panel được cuộn, không làm dài trang */
.profile-scroll-area {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}

/* Custom Slim Scrollbar (Item 5) */
.profile-scroll-area::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.profile-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}
.profile-scroll-area::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 4px;
}
.profile-scroll-area::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.28);
}
.profile-scroll-area {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.16) transparent;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
}
.section-header:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}
.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.section-body {
  padding: 0 12px 10px;
}

.member-row,
.item-row {
  padding: 5px 4px;
  border-radius: 6px;
}
.member-row:hover,
.item-row:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}

/* Lưới ảnh/video 3 cột vuông giống Zalo */
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.media-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  background-color: rgba(var(--v-theme-on-surface), 0.08);
}
.media-cell img,
.media-cell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.video-badge {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.25);
}

.empty-text {
  text-align: center;
  padding: 10px 0;
  font-size: 0.775rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }

.status-indicator-mini {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid rgb(var(--v-theme-surface));
}
.status-indicator-mini.online { background-color: #28c76f; }
.status-indicator-mini.offline { background-color: #a8aaae; }
</style>
