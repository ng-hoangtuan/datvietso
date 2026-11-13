<script setup lang="ts">
import { useChatStore, type ChatRoom } from '@/stores/useChatStore'

const emit = defineEmits<{
  (e: 'openCreateGroup'): void
}>()

const store = useChatStore()

/**
 * Dòng xem trước dưới tên phòng.
 *
 * `lastMessage` là snapshot do server tính sẵn (conversations.lastMessage) nên có
 * sẵn senderId/senderName — không phải đi đọc collection messages để biết ai gửi.
 */
const preview = (room: ChatRoom) => {
  const lm = room.lastMessage
  if (!lm) return 'Chưa có tin nhắn'

  const body = lm.type === 'media'
    ? '[Tệp đính kèm]'
    : lm.type === 'location'
      ? '[Vị trí]'
      : lm.content

  // Tin hệ thống đứng một mình, không gắn tên người gửi
  if (lm.type === 'system' || lm.senderId === 'system') return body

  if (String(lm.senderId) === String(store.currentUser.userId)) return `Bạn: ${body}`

  // Chat 1-1 thì tên phòng đã là tên người kia, thêm tên nữa chỉ gây rối
  return room.isGroup && lm.senderName ? `${lm.senderName}: ${body}` : body
}

const partnerId = (room: ChatRoom) =>
  room.partnerId
  || room.members.find(m => String(m.userId) !== String(store.currentUser.userId))?.userId
  || ''
</script>

<template>
  <div class="chat-sidebar-wrapper d-flex flex-column h-100 border-e">
    <!-- Header: Tìm kiếm & Nút Tạo Nhóm -->
    <div class="pa-3 border-b bg-surface">
      <div class="d-flex align-center gap-2 mb-2">
        <v-text-field
          v-model="store.searchKeyword"
          placeholder="Tìm trò chuyện hoặc người dùng..."
          prepend-inner-icon="ri-search-line"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="flex-grow-1"
        />
        <v-tooltip text="Tạo nhóm chat mới" location="bottom">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              color="primary"
              icon="ri-group-line"
              variant="tonal"
              size="small"
              @click="emit('openCreateGroup')"
            />
          </template>
        </v-tooltip>
      </div>

      <!-- Trạng thái kết nối realtime: mất socket thì tin nhắn không gửi được,
           người dùng cần biết ngay thay vì gõ xong mới thấy lỗi -->
      <div
        v-if="!store.isConnected"
        class="d-flex align-center gap-1 text-caption text-warning font-weight-medium"
      >
        <v-icon icon="ri-wifi-off-line" size="14" />
        Đang kết nối lại tới server chat...
      </div>
    </div>

    <!-- Danh sách Cuộc trò chuyện & Kết quả tìm kiếm người dùng (1-1) -->
    <div class="conversation-list flex-grow-1 overflow-y-auto">
      <v-list lines="two" class="pa-0">

        <!-- TRƯỜNG HỢP: ĐANG TÌM KIẾM - Hiển thị cả Người dùng để nhắn tin 1-1 -->
        <template v-if="store.searchKeyword.trim()">
          <!-- Nhóm 1: Kết quả Người dùng / Đồng nghiệp -->
          <v-list-subheader class="font-weight-bold text-uppercase text-caption text-primary px-3 pt-2">
            <v-icon icon="ri-user-search-line" size="14" class="mr-1" />
            Người dùng / Đồng nghiệp ({{ store.matchingUsersForDirectChat.length }})
          </v-list-subheader>

          <v-list-item
            v-for="user in store.matchingUsersForDirectChat"
            :key="`user-${user.userId}`"
            class="py-2 px-3 border-b cursor-pointer transition-all user-result-item"
            @click="store.openDirectChatWithUser(user)"
          >
            <template #prepend>
              <div class="position-relative mr-3">
                <v-avatar size="38">
                  <v-img :src="user.avatar" alt="avatar" />
                </v-avatar>
                <span
                  class="status-indicator"
                  :class="store.isUserOnline(user.userId) ? 'online' : 'offline'"
                />
              </div>
            </template>

            <v-list-item-title class="font-weight-bold text-body-2 d-flex align-center justify-space-between">
              <span class="text-truncate">{{ user.name }}</span>
              <v-chip size="x-small" color="primary" variant="tonal" class="ml-1">
                {{ user.employeeCode || 'DVS' }}
              </v-chip>
            </v-list-item-title>

            <v-list-item-subtitle class="text-caption text-medium-emphasis text-truncate mt-1">
              {{ user.position || user.department || user.email }}
            </v-list-item-subtitle>

            <template #append>
              <v-tooltip text="Bắt đầu nhắn tin trực tiếp 1-1" location="left">
                <template #activator="{ props: tipProps }">
                  <v-btn
                    v-bind="tipProps"
                    icon="ri-message-3-line"
                    variant="tonal"
                    color="primary"
                    size="x-small"
                    @click.stop="store.openDirectChatWithUser(user)"
                  />
                </template>
              </v-tooltip>
            </template>
          </v-list-item>

          <div
            v-if="store.matchingUsersForDirectChat.length === 0"
            class="px-4 py-2 text-caption text-medium-emphasis font-italic"
          >
            Không tìm thấy người dùng nào phù hợp.
          </div>

          <!-- Nhóm 2: Cuộc trò chuyện / Nhóm chat -->
          <v-list-subheader class="font-weight-bold text-uppercase text-caption text-medium-emphasis px-3 pt-3">
            <v-icon icon="ri-chat-1-line" size="14" class="mr-1" />
            Cuộc trò chuyện ({{ store.sortedAndFilteredRooms.length }})
          </v-list-subheader>
        </template>

        <!-- Danh sách phòng chat (Ghim lên đầu) -->
        <v-list-item
          v-for="room in store.sortedAndFilteredRooms"
          :key="room.id"
          :active="String(store.activeRoomId) === String(room.id)"
          active-color="primary"
          class="py-3 px-3 border-b cursor-pointer transition-all room-item"
          @click="store.selectRoom(room.id)"
        >
          <!-- Avatar kèm Badge Trạng thái Online/Offline (Task 1.2) -->
          <template #prepend>
            <div class="position-relative mr-3">
              <v-avatar size="44">
                <v-img :src="room.avatar" alt="avatar" />
              </v-avatar>

              <!-- Nếu là Direct Chat: kiểm tra người đối diện có online không -->
              <span
                v-if="!room.isGroup"
                class="status-indicator"
                :class="store.isUserOnline(partnerId(room)) ? 'online' : 'offline'"
              />

              <!-- Nếu là Group Chat: hiển thị icon nhóm nhỏ ở góc -->
              <span v-else class="group-badge">
                <v-icon icon="ri-team-line" size="10" color="white" />
              </span>
            </div>
          </template>

          <!-- Tên phòng & Thời gian & Icon Ghim (Task 2.3) -->
          <v-list-item-title class="font-weight-bold d-flex justify-space-between align-center">
            <div class="d-flex align-center gap-1 text-truncate">
              <!-- Biểu tượng Ghim nếu phòng được ghim -->
              <v-icon
                v-if="room.isPinned"
                icon="ri-pushpin-2-fill"
                size="14"
                color="primary"
                class="flex-shrink-0"
              />
              <span class="text-truncate text-body-2 font-weight-bold">{{ room.name }}</span>
            </div>
            <span class="text-caption text-medium-emphasis flex-shrink-0 ml-1">
              {{ room.lastMessage?.time || '' }}
            </span>
          </v-list-item-title>

          <!-- Tin nhắn gần nhất & Badge chưa đọc / được nhắc tên -->
          <v-list-item-subtitle class="d-flex justify-space-between align-center mt-1">
            <span
              class="text-truncate text-caption"
              :class="room.unreadCount > 0 ? 'font-weight-bold text-high-emphasis' : 'text-medium-emphasis'"
              style="max-width: 160px;"
            >
              {{ preview(room) }}
            </span>

            <div class="d-flex align-center gap-1">
              <!-- Nút toggle Pin nhanh khi hover (Task 2.3) -->
              <v-btn
                icon
                size="x-small"
                variant="text"
                :color="room.isPinned ? 'primary' : 'grey'"
                class="pin-btn"
                @click.stop="store.togglePinRoom(room.id)"
              >
                <v-icon :icon="room.isPinned ? 'ri-pushpin-2-fill' : 'ri-pushpin-line'" size="14" />
              </v-btn>

              <!-- Badge có người nhắc tên mình (Task 4.1) — đứng trước số chưa đọc -->
              <v-tooltip :text="`${room.mentionCount} tin nhắc đến bạn`" location="left">
                <template #activator="{ props: tipProps }">
                  <v-chip
                    v-if="room.mentionCount > 0"
                    v-bind="tipProps"
                    color="warning"
                    size="x-small"
                    class="font-weight-bold px-1"
                  >
                    @{{ room.mentionCount }}
                  </v-chip>
                </template>
              </v-tooltip>

              <!-- Số tin chưa đọc (bền qua F5: lastReadAt lưu trong DB) -->
              <v-chip
                v-if="room.unreadCount > 0"
                color="error"
                size="x-small"
                class="font-weight-bold"
              >
                {{ room.unreadCount > 99 ? '99+' : room.unreadCount }}
              </v-chip>
            </div>
          </v-list-item-subtitle>
        </v-list-item>

        <div
          v-if="store.sortedAndFilteredRooms.length === 0 && (!store.searchKeyword.trim() || store.matchingUsersForDirectChat.length === 0)"
          class="text-center py-8 text-medium-emphasis text-caption"
        >
          Không tìm thấy cuộc trò chuyện hoặc người dùng nào.
        </div>
      </v-list>
    </div>
  </div>
</template>

<style scoped>
.chat-sidebar-wrapper {
  background-color: rgb(var(--v-theme-surface));
  min-height: 0;
  overflow: hidden;
}
.conversation-list {
  min-height: 0;
}
.room-item:hover,
.user-result-item:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }

/* Status Indicator Dot (Task 1.2) */
.status-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-surface));
}
.status-indicator.online {
  background-color: #28c76f; /* Xanh lá */
}
.status-indicator.offline {
  background-color: #a8aaae; /* Xám */
}

.group-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #7367f0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid rgb(var(--v-theme-surface));
}

.pin-btn {
  opacity: 0.6;
}
.room-item:hover .pin-btn {
  opacity: 1;
}

/* Custom Slim Scrollbar */
.conversation-list::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.conversation-list::-webkit-scrollbar-track {
  background: transparent;
}
.conversation-list::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 4px;
}
.conversation-list::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.28);
}
.conversation-list {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.16) transparent;
}
</style>

