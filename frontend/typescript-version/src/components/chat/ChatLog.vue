<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useChatStore, type ChatMessage } from '@/stores/useChatStore'

const store = useChatStore()

const messageText = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const messagesContainerRef = ref<HTMLDivElement | null>(null)

// Mention Autocomplete State (Task 4.1)
const showMentionPopup = ref(false)
const mentionFilter = ref('')
const mentionIndex = ref(-1)

// Cuộn xuống tin nhắn mới nhất
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainerRef.value) {
      messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
    }
  })
}

// Watchers
watch(
  () => store.activeMessages.length,
  () => {
    scrollToBottom()
  }
)

watch(
  () => store.activeRoomId,
  () => {
    scrollToBottom()
  }
)

// Xử lý Typing debounce
let typingTimeout: any = null
const handleInput = (e: any) => {
  const text = messageText.value
  store.emitTyping()

  if (typingTimeout) clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => {
    store.emitStopTyping()
  }, 2000)

  // Kiểm tra ký tự @ cho tính năng Mention (Task 4.1)
  const lastAt = text.lastIndexOf('@')
  if (lastAt !== -1 && (lastAt === 0 || text[lastAt - 1] === ' ')) {
    mentionIndex.value = lastAt
    mentionFilter.value = text.slice(lastAt + 1).toLowerCase()
    showMentionPopup.value = true
  } else {
    showMentionPopup.value = false
  }
}

// Chọn một thành viên từ popup Mention
const selectMentionMember = (name: string) => {
  if (mentionIndex.value !== -1) {
    const before = messageText.value.slice(0, mentionIndex.value)
    messageText.value = `${before}@${name} `
  }
  showMentionPopup.value = false
}

// Gửi tin nhắn Text
const handleSend = () => {
  if (!messageText.value.trim()) return

  store.sendMessage(messageText.value, 'text')
  messageText.value = ''
  store.emitStopTyping()
  showMentionPopup.value = false
  scrollToBottom()
}

// Đính kèm tệp tin / hình ảnh / video (Task 3.1)
const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleFileUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  const file = files[0]
  let fileUrl = URL.createObjectURL(file)

  // Tải lên backend REST API /api/upload để lưu trữ và chia sẻ file thật
  try {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('http://localhost:5000/api/upload', {
      method: 'POST',
      body: formData,
    })
    if (res.ok) {
      const data = await res.json()
      if (data.url) fileUrl = data.url
    }
  } catch (err) {
    console.warn('Cannot upload to backend API, using client blob URL', err)
  }

  store.sendMessage(
    file.name,
    'media',
    {
      fileUrl,
      filename: file.name,
      mimetype: file.type,
      fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
    }
  )

  // Reset input
  target.value = ''
  scrollToBottom()
}

// Gửi Vị trí hiện tại qua GPS Geolocation (Task 3.1)
const handleShareLocation = () => {
  if (!navigator.geolocation) {
    alert('Trình duyệt của bạn không hỗ trợ định vị GPS!')
    return
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      store.sendMessage(
        `Vị trí hiện tại: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        'location',
        {
          lat,
          lng,
          address: `Tọa độ GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        }
      )
      scrollToBottom()
    },
    (err) => {
      // Fallback demo vị trí nếu user từ chối permission
      console.warn('Geolocation permission denied or error, using mock company location', err)
      store.sendMessage(
        'Văn phòng Đất Việt Số',
        'location',
        {
          lat: 21.028511,
          lng: 105.854444,
          address: 'Tòa nhà văn phòng Đất Việt Số, Hà Nội',
        }
      )
      scrollToBottom()
    }
  )
}

// Sao chép tin nhắn
const copyMessage = (content: string) => {
  navigator.clipboard.writeText(content)
}
</script>

<template>
  <div class="chat-log-wrapper d-flex flex-column h-100 position-relative">
    <!-- 1. Header Khung Chat -->
    <div class="pa-3 border-b d-flex align-center justify-space-between bg-surface chat-header">
      <div class="d-flex align-center">
        <!-- Avatar -->
        <div class="position-relative mr-3">
          <v-avatar size="42">
            <v-img :src="store.activeRoom.avatar" />
          </v-avatar>
          <span
            v-if="!store.activeRoom.isGroup"
            class="status-indicator"
            :class="store.isUserOnline(store.activeRoom.members.find(m => String(m.userId) !== String(store.currentUser.userId))?.userId || '') ? 'online' : 'offline'"
          />
        </div>

        <div>
          <h4 class="text-subtitle-1 font-weight-bold mb-0 d-flex align-center gap-2">
            {{ store.activeRoom.name }}
            <v-chip v-if="store.activeRoom.isGroup" size="x-small" color="primary" variant="tonal">
              {{ store.activeRoom.members.length }} thành viên
            </v-chip>
          </h4>

          <span v-if="!store.activeRoom.isGroup" class="text-caption d-flex align-center" :class="store.isUserOnline(store.activeRoom.members.find(m => String(m.userId) !== String(store.currentUser.userId))?.userId || '') ? 'text-success' : 'text-medium-emphasis'">
            <v-icon icon="ri-circle-fill" size="8" class="mr-1" />
            {{ store.isUserOnline(store.activeRoom.members.find(m => String(m.userId) !== String(store.currentUser.userId))?.userId || '') ? 'Đang hoạt động' : 'Offline' }}
          </span>

          <span v-else class="text-caption text-medium-emphasis">
            {{ store.activeRoom.members.map(m => m.name).slice(0, 3).join(', ') }}{{ store.activeRoom.members.length > 3 ? '...' : '' }}
          </span>
        </div>
      </div>

      <!-- Action Buttons & Menu 3 dots -->
      <div class="d-flex align-center gap-1">
        <v-btn icon="ri-phone-line" variant="text" size="small" color="grey" />
        <v-btn icon="ri-vidicon-line" variant="text" size="small" color="grey" />
        <!-- Nút 3 chấm mở Right Drawer Profile/Group -->
        <v-tooltip text="Thông tin cuộc trò chuyện / Nhóm" location="bottom">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon="ri-more-2-fill"
              variant="text"
              size="small"
              :color="store.isProfileRightOpen ? 'primary' : 'default'"
              @click="store.isProfileRightOpen = !store.isProfileRightOpen"
            />
          </template>
        </v-tooltip>
      </div>
    </div>

    <!-- 2. Danh Sách Tin Nhắn (Scrollable) -->
    <div ref="messagesContainerRef" class="chat-messages-scroll-area flex-grow-1 pa-4 overflow-y-auto d-flex flex-column">
      <!-- Spacer đẩy tin nhắn xuống đáy khi có ít tin nhắn (tin nhắn đầu tiên nằm dưới) -->
      <div class="flex-grow-1" style="min-height: 0;" />

      <div
        v-for="msg in store.activeMessages"
        :key="msg.id"
        class="message-group mb-4 d-flex"
        :class="msg.isMe ? 'justify-end' : 'justify-start'"
      >
        <!-- Avatar người gửi (nếu không phải là tôi) -->
        <v-avatar v-if="!msg.isMe" size="32" class="mr-2 mt-1 flex-shrink-0">
          <v-img :src="msg.senderAvatar || 'https://cdn.vuetifyjs.com/images/john.jpg'" />
        </v-avatar>

        <div class="message-content-box d-flex flex-column" :class="msg.isMe ? 'align-end' : 'align-start'">
          <!-- Tên người gửi nếu là tin nhắn nhóm -->
          <span v-if="!msg.isMe && store.activeRoom.isGroup" class="text-caption font-weight-bold text-medium-emphasis mb-1 ml-1">
            {{ msg.senderName }}
          </span>

          <div class="d-flex align-center message-bubble-row" :class="msg.isMe ? 'flex-row-reverse' : 'flex-row'">
            <!-- Bong bóng tin nhắn -->
            <div
              class="message-bubble pa-3 rounded-lg position-relative"
              :class="[
                msg.isDeleted ? 'bubble-deleted font-italic' :
                msg.isMe ? 'bubble-me rounded-be-0' : 'bubble-other rounded-bs-0'
              ]"
            >
              <!-- Tin nhắn đã xóa -->
              <div v-if="msg.isDeleted" class="d-flex align-center gap-1">
                <v-icon icon="ri-forbid-line" size="14" />
                <span>{{ msg.content }}</span>
              </div>

              <!-- Tin nhắn Vị Trí (Task 3.1) -->
              <div v-else-if="msg.type === 'location'" class="location-card">
                <div class="d-flex align-center gap-2 mb-2 font-weight-bold">
                  <v-icon icon="ri-map-pin-2-fill" color="error" size="20" />
                  <span>Vị trí được chia sẻ</span>
                </div>
                <div class="text-body-2 mb-2">{{ msg.content }}</div>
                <v-btn
                  v-if="msg.metadata?.lat && msg.metadata?.lng"
                  size="x-small"
                  variant="outlined"
                  :color="msg.isMe ? 'white' : 'primary'"
                  :href="`https://maps.google.com/?q=${msg.metadata.lat},${msg.metadata.lng}`"
                  target="_blank"
                  prepend-icon="ri-external-link-line"
                >
                  Mở trên Google Maps
                </v-btn>
              </div>

              <!-- Tin nhắn Media (Ảnh, Video, File) (Task 3.1) -->
              <div v-else-if="msg.type === 'media'" class="media-card">
                <!-- Trường hợp là Ảnh -->
                <div v-if="msg.metadata?.mimetype?.startsWith('image/')" class="mb-1">
                  <v-img
                    :src="msg.metadata.fileUrl"
                    max-width="260"
                    max-height="220"
                    cover
                    class="rounded cursor-pointer"
                  />
                  <div
                    class="text-caption mt-1 text-truncate"
                    style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                    :title="msg.metadata?.filename || msg.content"
                  >
                    {{ msg.metadata?.filename || msg.content }}
                  </div>
                </div>

                <!-- Trường hợp là Video -->
                <div v-else-if="msg.metadata?.mimetype?.startsWith('video/')" class="mb-1">
                  <video :src="msg.metadata.fileUrl" controls style="max-width: 260px; border-radius: 6px;" />
                  <div
                    class="text-caption mt-1 text-truncate"
                    style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                    :title="msg.metadata?.filename || msg.content"
                  >
                    {{ msg.metadata?.filename || msg.content }}
                  </div>
                </div>

                <!-- Trường hợp là File / Document -->
                <div v-else class="d-flex align-center gap-2 file-attachment pa-2 rounded border">
                  <v-avatar color="primary" variant="tonal" size="36">
                    <v-icon icon="ri-file-text-line" size="20" />
                  </v-avatar>
                  <div class="flex-grow-1 text-truncate" style="max-width: 160px;">
                    <div class="text-body-2 font-weight-medium text-truncate">{{ msg.metadata?.filename || msg.content }}</div>
                    <div class="text-caption text-medium-emphasis">{{ msg.metadata?.fileSize || 'Tệp đính kèm' }}</div>
                  </div>
                  <v-btn
                    icon="ri-download-2-line"
                    size="x-small"
                    variant="text"
                    :href="msg.metadata?.fileUrl"
                    download
                  />
                </div>
              </div>

              <!-- Tin nhắn Văn bản thuần túy -->
              <div v-else class="text-body-1 message-text">
                {{ msg.content }}
              </div>
            </div>

            <!-- Action Menu cho từng tin nhắn (Task 2.1: Xóa tin nhắn) -->
            <v-menu location="top">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon="ri-more-line"
                  size="x-small"
                  variant="text"
                  color="grey"
                  class="message-actions-btn opacity-0 ml-1 mr-1"
                />
              </template>
              <v-list density="compact" elevation="2">
                <v-list-item
                  prepend-icon="ri-file-copy-line"
                  title="Sao chép"
                  @click="copyMessage(msg.content)"
                />
                <!-- Chỉ cho phép xóa nếu là tin nhắn của mình và chưa xóa -->
                <v-list-item
                  v-if="msg.isMe && !msg.isDeleted"
                  prepend-icon="ri-delete-bin-line"
                  title="Xóa tin nhắn"
                  class="text-error"
                  @click="store.deleteMessage(msg.id)"
                />
              </v-list>
            </v-menu>
          </div>

          <!-- Thời gian gửi -->
          <span class="text-caption text-medium-emphasis mt-1 mx-1" style="font-size: 11px;">
            {{ msg.time }}
          </span>
        </div>
      </div>
    </div>

    <!-- Trạng thái "Đang soạn tin..." (Task 2.2: Typing Indicator) -->
    <div v-if="store.typingDisplayText" class="typing-indicator-bar px-4 py-1 bg-surface border-t d-flex align-center gap-2">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span class="text-caption text-primary font-italic font-weight-medium">
        {{ store.typingDisplayText }}
      </span>
    </div>

    <!-- Mention Popup Autocomplete (@name) (Task 4.1) -->
    <v-card
      v-if="showMentionPopup"
      elevation="4"
      class="mention-popup rounded-lg border position-absolute"
    >
      <div class="pa-2 text-caption font-weight-bold border-b text-medium-emphasis">
        ĐỀ CẬP THÀNH VIÊN (@)
      </div>
      <v-list density="compact" class="py-0" max-height="160" style="overflow-y: auto;">
        <v-list-item
          v-for="member in store.activeRoom.members.filter(m => m.name.toLowerCase().includes(mentionFilter))"
          :key="member.userId"
          class="cursor-pointer"
          @click="selectMentionMember(member.name)"
        >
          <template #prepend>
            <v-avatar size="24" class="mr-2">
              <v-img :src="member.avatar || 'https://cdn.vuetifyjs.com/images/john.jpg'" />
            </v-avatar>
          </template>
          <v-list-item-title class="text-body-2 font-weight-medium">
            {{ member.name }}
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- 3. Ô Nhập & Gửi Tin Nhắn -->
    <div class="pa-3 border-t bg-surface chat-input-bar">
      <!-- Hidden file input -->
      <input
        ref="fileInputRef"
        type="file"
        class="d-none"
        multiple
        @change="handleFileUpload"
      />

      <div class="d-flex align-center gap-1">
        <!-- Đính kèm File/Media (Task 3.1) -->
        <v-tooltip text="Đính kèm ảnh / video / tài liệu" location="top">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon="ri-attachment-line"
              variant="text"
              color="grey"
              size="small"
              @click="triggerFileInput"
            />
          </template>
        </v-tooltip>

        <!-- Chia sẻ Vị trí GPS (Task 3.1) -->
        <v-tooltip text="Chia sẻ vị trí hiện tại" location="top">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon="ri-map-pin-line"
              variant="text"
              color="grey"
              size="small"
              @click="handleShareLocation"
            />
          </template>
        </v-tooltip>

        <!-- Ô nhập Text -->
        <v-text-field
          v-model="messageText"
          placeholder="Nhập tin nhắn (Gõ @ để nhắc tên)..."
          variant="solo-filled"
          flat
          density="compact"
          hide-details
          class="flex-grow-1 mx-2"
          @input="handleInput"
          @keydown.enter.prevent="handleSend"
        />

        <!-- Nút Gửi -->
        <v-btn
          color="primary"
          icon="ri-send-plane-fill"
          size="small"
          :disabled="!messageText.trim()"
          @click="handleSend"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-log-wrapper {
  background-color: rgba(var(--v-theme-on-surface), 0.02);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.chat-messages-scroll-area {
  scroll-behavior: smooth;
  min-height: 0;
}

/* Custom Slim Scrollbar (Item 5) */
.chat-messages-scroll-area::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.chat-messages-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}
.chat-messages-scroll-area::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 4px;
}
.chat-messages-scroll-area::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.28);
}
.chat-messages-scroll-area {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.16) transparent;
}

.message-bubble {
  max-width: 480px;
  word-break: break-word;
  font-size: 0.9375rem;
  line-height: 1.5;
}

/* Item 2: Màu background người gửi (Tôi): Tím Materio (#7367f0), chữ trắng tinh nét, bóng nhẹ */
.bubble-me {
  background-color: #7367f0 !important;
  color: #ffffff !important;
  box-shadow: 0 2px 6px rgba(115, 103, 240, 0.25);
}
.bubble-me .message-text {
  color: #ffffff !important;
}

/* Item 2: Màu background người khác: Nền trắng sạch sáng, viền tinh tế, chữ tối tương phản cao dễ đọc */
.bubble-other {
  background-color: #ffffff !important;
  color: #2e384d !important;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.bubble-other .message-text {
  color: #2e384d !important;
}

.bubble-deleted {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
}

/* Dark theme */
.v-theme--dark .bubble-other {
  background-color: #2b2c40 !important;
  color: #dbdce0 !important;
  border-color: #3b3d56;
}
.v-theme--dark .bubble-other .message-text {
  color: #dbdce0 !important;
}
.message-group:hover .message-actions-btn {
  opacity: 1 !important;
}
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }

/* Status Dot */
.status-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-surface));
}
.status-indicator.online { background-color: #28c76f; }
.status-indicator.offline { background-color: #a8aaae; }

/* Typing animation */
.typing-dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: #7367f0;
  border-radius: 50%;
  margin-right: 3px;
  animation: typing 1.4s infinite ease-in-out both;
}
.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* Mention popup */
.mention-popup {
  bottom: 60px;
  left: 20px;
  width: 240px;
  z-index: 20;
  background-color: rgb(var(--v-theme-surface));
}
</style>

