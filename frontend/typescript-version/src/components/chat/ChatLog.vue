<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import {
  useChatStore,
  REACTION_EMOJI,
  type ChatMessage,
  type ReactionType,
} from '@/stores/useChatStore'
import { API_BASE, authHeader } from '@/utils/api'

const store = useChatStore()

const messageText = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const messagesContainerRef = ref<HTMLDivElement | null>(null)
const isUploading = ref(false)

// Mention Autocomplete State (Task 4.1)
const showMentionPopup = ref(false)
const mentionFilter = ref('')
const mentionIndex = ref(-1)
const mentionActive = ref(0)

const REACTION_LIST = Object.keys(REACTION_EMOJI) as ReactionType[]

onMounted(() => {
  // Thông báo mention cần quyền Notification — xin một lần khi mở trang chat
  store.requestNotificationPermission()
})

/** Chỉ gợi ý người trong nhóm, bỏ chính mình; lọc theo chữ sau dấu @. */
const mentionMatches = computed(() => {
  const q = mentionFilter.value.trim()

  return store.mentionCandidates
    .filter(m => !q || m.name.toLowerCase().includes(q))
    .slice(0, 6)
})

// --- Cuộn xuống đáy -------------------------------------------------------
//
// Không dùng `scrollTop = scrollHeight` một lần rồi thôi. Hai lý do:
//
//  1. CSS để `scroll-behavior: smooth` nên lệnh đó chạy thành animation. Nếu
//     nội dung cao thêm GIỮA CHỪNG animation (icon của nút vừa render, ảnh vừa
//     tải xong) thì nó dừng ở mốc cũ — hụt mất phần dưới. Thẻ vị trí dính nặng
//     nhất vì là bong bóng cao nhất: tiêu đề + nội dung + địa chỉ + nút.
//  2. Một `nextTick` chỉ đảm bảo Vue đã cập nhật DOM, không đảm bảo ảnh/video/
//     icon đã có kích thước thật.
//
// Cách làm: cuộn tức thì (behavior auto), lặp lại ở frame kế tiếp, và dùng
// ResizeObserver để ghim lại mỗi khi nội dung cao thêm.
const contentRef = ref<HTMLDivElement | null>(null)

/** Còn cách đáy dưới ngần này px thì coi như người dùng đang theo dõi tin mới. */
const NEAR_BOTTOM_PX = 80

/** Đang bám đáy hay đang đọc lại tin cũ. Đọc tin cũ thì đừng kéo họ xuống. */
let stickToBottom = true

const atBottom = () => {
  const el = messagesContainerRef.value
  if (!el) return true

  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

/** Ghim xuống đáy ngay lập tức, bỏ qua smooth của CSS. */
const pinToBottom = () => {
  const el = messagesContainerRef.value
  if (!el) return

  el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
}

const scrollToBottom = () => {
  stickToBottom = true
  nextTick(() => {
    pinToBottom()
    // Lần hai sau khi trình duyệt vẽ xong: bắt những gì cao thêm trong frame này
    requestAnimationFrame(pinToBottom)
  })
}

const onScroll = () => { stickToBottom = atBottom() }

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const el = messagesContainerRef.value
  el?.addEventListener('scroll', onScroll, { passive: true })

  // Nội dung cao thêm (ảnh tải xong, icon render, thẻ vị trí giãn ra) thì ghim
  // lại đáy — nhưng chỉ khi người dùng đang ở đáy, không giật họ khỏi tin cũ.
  if (contentRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => { if (stickToBottom) pinToBottom() })
    resizeObserver.observe(contentRef.value)
  }
})

onUnmounted(() => {
  messagesContainerRef.value?.removeEventListener('scroll', onScroll)
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(() => store.activeMessages.length, () => {
  // Tin mới của người khác mà mình đang đọc tin cũ thì giữ nguyên vị trí
  if (stickToBottom) scrollToBottom()
})

watch(() => store.activeRoomId, () => {
  messageText.value = ''
  showMentionPopup.value = false
  scrollToBottom()
})

// Xử lý Typing debounce
let typingTimeout: any = null

const handleInput = () => {
  const text = messageText.value
  store.emitTyping()

  if (typingTimeout) clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => { store.emitStopTyping() }, 2000)

  // Mention (Task 4.1): chỉ mở popup khi @ là ký tự bắt đầu hoặc sau khoảng trắng,
  // và phần sau @ chưa chứa khoảng trắng kép (tên có thể có 1 dấu cách).
  const lastAt = text.lastIndexOf('@')
  const canOpen = lastAt !== -1 && (lastAt === 0 || /\s/.test(text[lastAt - 1]))

  if (canOpen) {
    mentionIndex.value = lastAt
    mentionFilter.value = text.slice(lastAt + 1).toLowerCase()
    mentionActive.value = 0
    showMentionPopup.value = true
  }
  else {
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
  mentionFilter.value = ''
}

/** Enter khi popup @ đang mở thì chọn người, không gửi tin. */
const handleEnter = () => {
  if (showMentionPopup.value && mentionMatches.value.length > 0) {
    selectMentionMember(mentionMatches.value[mentionActive.value]?.name || mentionMatches.value[0].name)

    return
  }
  handleSend()
}

const moveMention = (delta: number) => {
  if (!showMentionPopup.value || mentionMatches.value.length === 0) return

  const n = mentionMatches.value.length
  mentionActive.value = (mentionActive.value + delta + n) % n
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
const triggerFileInput = () => { fileInputRef.value?.click() }

const handleFileUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  isUploading.value = true
  try {
    // Gửi lần lượt từng tệp được chọn (input có multiple)
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)

      let uploaded: any = null
      try {
        // Upload giờ bắt buộc đăng nhập ở server — thiếu header này là 401
        const res = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          headers: authHeader(),
          body: formData,
        })
        uploaded = await res.json().catch(() => null)
        if (!res.ok) {
          store.lastError = (uploaded && uploaded.error) || 'Không tải được tệp lên'
          continue
        }
      }
      catch (err) {
        store.lastError = 'Không tải được tệp lên server'
        continue
      }

      if (!uploaded?.url) continue

      // URL phải là của server: blob: local chỉ sống trong tab này, người khác
      // mở ra sẽ thấy ảnh hỏng — nên nếu upload lỗi thì KHÔNG gửi tin.
      store.sendMessage(file.name, 'media', {
        fileUrl: uploaded.url,
        filename: uploaded.filename || file.name,
        mimetype: uploaded.mimetype || file.type,
        fileSize: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      })
    }
  }
  finally {
    isUploading.value = false
    target.value = ''
    scrollToBottom()
  }
}

// Gửi Vị trí hiện tại qua GPS Geolocation (Task 3.1)
const handleShareLocation = () => {
  if (!navigator.geolocation) {
    store.lastError = 'Trình duyệt của bạn không hỗ trợ định vị GPS!'

    return
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      store.sendMessage(
        `Vị trí hiện tại: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        'location',
        { lat, lng, address: `Tọa độ GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` },
      )
      scrollToBottom()
    },
    err => {
      // Không gửi vị trí giả: một toạ độ bịa đặt gửi vào nhóm còn tệ hơn là không gửi
      store.lastError = err.code === err.PERMISSION_DENIED
        ? 'Bạn đã từ chối quyền truy cập vị trí'
        : 'Không lấy được vị trí hiện tại'
    },
    { enableHighAccuracy: true, timeout: 10000 },
  )
}

// Sao chép tin nhắn
const copyMessage = (content: string) => { navigator.clipboard.writeText(content) }

/**
 * Tách nội dung thành các đoạn để tô sáng @tên và link.
 * Dùng mảng đoạn + v-for thay vì v-html, để nội dung người dùng gửi không bao giờ
 * được trình duyệt hiểu là HTML.
 */
const segments = (msg: ChatMessage) => {
  const text = msg.content || ''
  const names = store.activeRoom.members
    .map(m => m.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // tên dài trước, tránh khớp "Lan" trong "Mai Lan"

  const out: { text: string; kind: 'text' | 'mention' | 'link' }[] = []
  let i = 0

  const myName = store.currentUser.name

  while (i < text.length) {
    if (text[i] === '@') {
      const rest = text.slice(i + 1)
      const hit = names.find(n => rest.toLowerCase().startsWith(n.toLowerCase()))
        || (/^(all|everyone|tatca)\b/i.test(rest) ? rest.match(/^(all|everyone|tatca)/i)![0] : null)

      if (hit) {
        out.push({ text: `@${text.slice(i + 1, i + 1 + hit.length)}`, kind: 'mention' })
        i += hit.length + 1
        continue
      }
    }

    const linkMatch = text.slice(i).match(/^https?:\/\/[^\s]+/i)
    if (linkMatch) {
      out.push({ text: linkMatch[0], kind: 'link' })
      i += linkMatch[0].length
      continue
    }

    const last = out[out.length - 1]
    if (last && last.kind === 'text') last.text += text[i]
    else out.push({ text: text[i], kind: 'text' })
    i += 1
  }

  return { parts: out, mentionsMe: text.toLowerCase().includes(`@${(myName || '').toLowerCase()}`) }
}

/** Gom reactions theo loại: 👍 2, ❤️ 1 — thay vì hiện từng người một. */
const groupedReactions = (msg: ChatMessage) => {
  const map = new Map<string, { reaction: ReactionType; count: number; mine: boolean }>()
  for (const r of msg.reactions || []) {
    const cur = map.get(r.reaction) || { reaction: r.reaction, count: 0, mine: false }
    cur.count += 1
    if (String(r.userId) === String(store.currentUser.userId)) cur.mine = true
    map.set(r.reaction, cur)
  }

  return [...map.values()]
}

const partner = computed(() =>
  store.activeRoom.members.find(m => String(m.userId) !== String(store.currentUser.userId)))

const partnerOnline = computed(() => store.isUserOnline(partner.value?.userId || ''))
</script>

<template>
  <div class="chat-log-wrapper d-flex flex-column h-100 position-relative">
    <!-- 1. Header Khung Chat -->
    <div class="pa-3 border-b d-flex align-center justify-space-between bg-surface chat-header">
      <div class="d-flex align-center">
        <!-- Avatar -->
        <div class="position-relative mr-3">
          <v-avatar size="42" :color="store.hasActiveRoom ? undefined : 'grey-lighten-2'">
            <v-img v-if="store.activeRoom.avatar" :src="store.activeRoom.avatar" />
            <v-icon v-else icon="ri-chat-3-line" />
          </v-avatar>
          <span
            v-if="store.hasActiveRoom && !store.activeRoom.isGroup"
            class="status-indicator"
            :class="partnerOnline ? 'online' : 'offline'"
          />
        </div>

        <div>
          <h4 class="text-subtitle-1 font-weight-bold mb-0 d-flex align-center gap-2">
            {{ store.activeRoom.name }}
            <v-chip v-if="store.activeRoom.isGroup" size="x-small" color="primary" variant="tonal">
              {{ store.activeRoom.members.length }} thành viên
            </v-chip>
          </h4>

          <span
            v-if="store.hasActiveRoom && !store.activeRoom.isGroup"
            class="text-caption d-flex align-center"
            :class="partnerOnline ? 'text-success' : 'text-medium-emphasis'"
          >
            <v-icon icon="ri-circle-fill" size="8" class="mr-1" />
            {{ partnerOnline ? 'Đang hoạt động' : 'Offline' }}
          </span>

          <span v-else-if="store.activeRoom.isGroup" class="text-caption text-medium-emphasis">
            {{ store.activeRoom.members.map(m => m.name).slice(0, 3).join(', ') }}{{ store.activeRoom.members.length > 3 ? '...' : '' }}
          </span>
        </div>
      </div>

      <!-- Action Buttons & Menu 3 dots -->
      <div class="d-flex align-center gap-1">
        <!-- Đã bỏ hai nút gọi thoại / gọi video của template gốc: chúng không
             gắn handler nào, bấm vào không có gì xảy ra. Nút chết trên màn hình
             làm người dùng tưởng tính năng hỏng. Khi nào làm gọi thật thì thêm
             lại kèm xử lý. -->
        <!-- Nút 3 chấm mở Right Drawer Profile/Group -->
        <v-tooltip text="Thông tin cuộc trò chuyện / Nhóm" location="bottom">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon="ri-more-2-fill"
              variant="text"
              size="small"
              :disabled="!store.hasActiveRoom"
              :color="store.isProfileRightOpen ? 'primary' : 'default'"
              @click="store.isProfileRightOpen = !store.isProfileRightOpen"
            />
          </template>
        </v-tooltip>
      </div>
    </div>

    <!-- 2. Danh Sách Tin Nhắn (Scrollable) -->
    <div ref="messagesContainerRef" class="chat-messages-scroll-area flex-grow-1 pa-4 overflow-y-auto d-flex flex-column">
      <!-- Spacer đẩy tin nhắn xuống đáy khi có ít tin nhắn -->
      <div class="flex-grow-1" style="min-height: 0;" />

      <!-- Bọc nội dung để ResizeObserver biết khi nào nó cao thêm (ảnh tải
           xong, icon render) mà ghim lại đáy — xem scrollToBottom() ở trên. -->
      <div ref="contentRef">

      <!-- Phân trang: chỉ tải 50 tin mới nhất, còn lại tải theo yêu cầu -->
      <div v-if="store.hasMoreMessages" class="text-center mb-4">
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :loading="store.loadingOlder"
          prepend-icon="ri-history-line"
          @click="store.loadOlderMessages()"
        >
          Xem tin nhắn cũ hơn
        </v-btn>
      </div>

      <!-- Chưa chọn / chưa có cuộc trò chuyện nào -->
      <div v-if="!store.hasActiveRoom" class="text-center text-medium-emphasis py-10">
        <v-icon icon="ri-chat-smile-3-line" size="48" class="mb-2 opacity-50" />
        <div class="text-body-2">
          Chọn một cuộc trò chuyện ở cột bên trái, hoặc tìm đồng nghiệp để nhắn tin 1-1.
        </div>
      </div>

      <template v-for="msg in store.activeMessages" :key="msg.id">
        <!-- Tin hệ thống: tạo nhóm, thêm/xóa thành viên, đổi vai trò, đổi tên nhóm.
             Server sinh ra chứ không phải người dùng gửi, nên hiện giữa khung. -->
        <div v-if="msg.isSystem || msg.type === 'system'" class="text-center my-3">
          <v-chip size="small" variant="tonal" color="secondary" class="system-chip">
            <v-icon icon="ri-information-line" size="14" start />
            {{ msg.content }}
            <span class="text-caption ml-2 opacity-70">{{ msg.time }}</span>
          </v-chip>
        </div>

        <div
          v-else
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
                  msg.isDeleted ? 'bubble-deleted font-italic'
                  : msg.isMe ? 'bubble-me rounded-be-0' : 'bubble-other rounded-bs-0',
                  !msg.isMe && !msg.isDeleted && segments(msg).mentionsMe ? 'bubble-mentions-me' : '',
                  msg.failed ? 'bubble-failed' : '',
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
                  <div class="text-body-2 mb-1">{{ msg.content }}</div>
                  <div v-if="msg.metadata?.address" class="text-caption mb-2 opacity-80">
                    {{ msg.metadata.address }}
                  </div>
                  <v-btn
                    v-if="msg.metadata?.lat && msg.metadata?.lng"
                    size="x-small"
                    variant="outlined"
                    :color="msg.isMe ? 'white' : 'primary'"
                    :href="`https://maps.google.com/?q=${msg.metadata.lat},${msg.metadata.lng}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    prepend-icon="ri-external-link-line"
                  >
                    Mở trên Google Maps
                  </v-btn>
                </div>

                <!-- Tin nhắn Media (Ảnh, Video, File) (Task 3.1) -->
                <div v-else-if="msg.type === 'media' || msg.type === 'file'" class="media-card">
                  <!-- Trường hợp là Ảnh -->
                  <div v-if="msg.attachmentKind === 'image' || msg.metadata?.mimetype?.startsWith('image/')" class="mb-1">
                    <a :href="msg.metadata?.fileUrl" target="_blank" rel="noopener noreferrer">
                      <v-img
                        :src="msg.metadata?.fileUrl"
                        max-width="260"
                        max-height="220"
                        cover
                        class="rounded cursor-pointer"
                      />
                    </a>
                    <div
                      class="text-caption mt-1 text-truncate"
                      style="max-width: 250px;"
                      :title="msg.metadata?.filename || msg.content"
                    >
                      {{ msg.metadata?.filename || msg.content }}
                    </div>
                  </div>

                  <!-- Trường hợp là Video -->
                  <div v-else-if="msg.attachmentKind === 'video' || msg.metadata?.mimetype?.startsWith('video/')" class="mb-1">
                    <video :src="msg.metadata?.fileUrl" controls style="max-width: 260px; border-radius: 6px;" />
                    <div
                      class="text-caption mt-1 text-truncate"
                      style="max-width: 250px;"
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
                      <div class="text-body-2 font-weight-medium text-truncate">
                        {{ msg.metadata?.filename || msg.content }}
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ msg.metadata?.fileSize || 'Tệp đính kèm' }}
                      </div>
                    </div>
                    <v-btn
                      icon="ri-download-2-line"
                      size="x-small"
                      variant="text"
                      :href="msg.metadata?.fileUrl"
                      target="_blank"
                      download
                    />
                  </div>
                </div>

                <!-- Tin nhắn Văn bản: tô sáng @tên và link (Task 4.1) -->
                <div v-else class="text-body-1 message-text">
                  <template v-for="(part, i) in segments(msg).parts" :key="i">
                    <span v-if="part.kind === 'mention'" class="mention-tag">{{ part.text }}</span>
                    <a
                      v-else-if="part.kind === 'link'"
                      :href="part.text"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="message-link"
                    >{{ part.text }}</a>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </div>

                <!-- Cảm xúc đã thả, gom theo loại -->
                <div v-if="groupedReactions(msg).length > 0" class="reaction-row d-flex gap-1 mt-2">
                  <v-chip
                    v-for="r in groupedReactions(msg)"
                    :key="r.reaction"
                    size="x-small"
                    :variant="r.mine ? 'flat' : 'tonal'"
                    :color="r.mine ? 'primary' : 'default'"
                    class="reaction-chip"
                    @click="store.toggleReaction(msg.id, r.reaction)"
                  >
                    {{ REACTION_EMOJI[r.reaction] }} {{ r.count }}
                  </v-chip>
                </div>
              </div>

              <!-- Action Menu cho từng tin nhắn -->
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
                  <!-- Thả cảm xúc (messages.reactions trong MongoDB) -->
                  <v-list-item v-if="!msg.isDeleted" class="px-2">
                    <div class="d-flex gap-1">
                      <v-btn
                        v-for="r in REACTION_LIST"
                        :key="r"
                        size="x-small"
                        variant="text"
                        class="reaction-pick"
                        @click="store.toggleReaction(msg.id, r)"
                      >
                        {{ REACTION_EMOJI[r] }}
                      </v-btn>
                    </div>
                  </v-list-item>
                  <v-divider v-if="!msg.isDeleted" />
                  <v-list-item
                    prepend-icon="ri-file-copy-line"
                    title="Sao chép"
                    @click="copyMessage(msg.content)"
                  />
                  <!-- Chỉ xóa được tin của mình — server kiểm tra lại điều này -->
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

            <!-- Thời gian gửi + trạng thái gửi -->
            <span class="text-caption text-medium-emphasis mt-1 mx-1 d-flex align-center gap-1" style="font-size: 11px;">
              {{ msg.time }}
              <v-icon v-if="msg.pending" icon="ri-time-line" size="11" />
              <v-tooltip v-if="msg.failed" text="Gửi không thành công" location="top">
                <template #activator="{ props: tipProps }">
                  <v-icon v-bind="tipProps" icon="ri-error-warning-line" size="11" color="error" />
                </template>
              </v-tooltip>
            </span>
          </div>
        </div>
      </template>
      </div>
    </div>

    <!-- Trạng thái "Đang soạn tin..." (Task 2.2: Typing Indicator) -->
    <div v-if="store.typingDisplayText" class="typing-indicator-bar px-4 py-1 bg-surface border-t d-flex align-center gap-2">
      <div class="typing-dots">
        <span />
        <span />
        <span />
      </div>
      <span class="text-caption text-primary font-italic font-weight-medium">
        {{ store.typingDisplayText }}
      </span>
    </div>

    <!-- Mention Popup Autocomplete (@name) (Task 4.1) -->
    <v-card
      v-if="showMentionPopup && mentionMatches.length > 0"
      elevation="4"
      class="mention-popup rounded-lg border position-absolute"
    >
      <div class="pa-2 text-caption font-weight-bold border-b text-medium-emphasis d-flex justify-space-between">
        <span>ĐỀ CẬP THÀNH VIÊN (@)</span>
        <span class="opacity-60">↑↓ Enter</span>
      </div>
      <v-list density="compact" class="py-0" max-height="180" style="overflow-y: auto;">
        <v-list-item
          v-for="(member, i) in mentionMatches"
          :key="member.userId"
          :active="i === mentionActive"
          class="cursor-pointer"
          @click="selectMentionMember(member.name)"
        >
          <template #prepend>
            <div class="position-relative mr-2">
              <v-avatar size="24">
                <v-img :src="member.avatar || 'https://cdn.vuetifyjs.com/images/john.jpg'" />
              </v-avatar>
              <span
                class="status-indicator status-dot-sm"
                :class="store.isUserOnline(member.userId) ? 'online' : 'offline'"
              />
            </div>
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
      >

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
              :loading="isUploading"
              :disabled="!store.hasActiveRoom"
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
              :disabled="!store.hasActiveRoom"
              @click="handleShareLocation"
            />
          </template>
        </v-tooltip>

        <!-- Ô nhập Text -->
        <v-text-field
          v-model="messageText"
          :placeholder="store.hasActiveRoom ? 'Nhập tin nhắn (Gõ @ để nhắc tên)...' : 'Chọn một cuộc trò chuyện để bắt đầu'"
          :disabled="!store.hasActiveRoom"
          variant="solo-filled"
          flat
          density="compact"
          hide-details
          class="flex-grow-1 mx-2"
          @input="handleInput"
          @keydown.enter.prevent="handleEnter"
          @keydown.down.prevent="moveMention(1)"
          @keydown.up.prevent="moveMention(-1)"
          @keydown.esc="showMentionPopup = false"
        />

        <!-- Nút Gửi -->
        <v-btn
          color="primary"
          icon="ri-send-plane-fill"
          size="small"
          :disabled="!messageText.trim() || !store.hasActiveRoom"
          @click="handleSend"
        />
      </div>
    </div>

    <!-- Lỗi từ server / kết nối: hiện rõ thay vì chỉ log ra console -->
    <v-snackbar
      :model-value="!!store.lastError"
      color="error"
      location="top"
      :timeout="4000"
      @update:model-value="store.lastError = ''"
    >
      {{ store.lastError }}
    </v-snackbar>
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
  /* KHÔNG đặt scroll-behavior: smooth ở đây. Việc cuộn xuống đáy do JS điều
     khiển; smooth biến mỗi lần gán scrollTop thành animation có đích cố định,
     nội dung cao thêm giữa chừng là cuộn hụt. */
  min-height: 0;
}

/* Custom Slim Scrollbar */
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

/* Màu background người gửi (Tôi): Tím Materio, chữ trắng, bóng nhẹ */
.bubble-me {
  background-color: #7367f0 !important;
  color: #ffffff !important;
  box-shadow: 0 2px 6px rgba(115, 103, 240, 0.25);
}
.bubble-me .message-text {
  color: #ffffff !important;
}

/* Màu background người khác: nền sáng, viền tinh tế, chữ tối tương phản cao */
.bubble-other {
  background-color: #ffffff !important;
  color: #2e384d !important;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.bubble-other .message-text {
  color: #2e384d !important;
}

/* Tin có @tôi: viền vàng để thấy ngay khi cuộn (Task 4.1) */
.bubble-mentions-me {
  border-left: 3px solid #ff9f43 !important;
  background-color: #fff8f0 !important;
}

.bubble-failed {
  opacity: 0.65;
  border: 1px dashed #ea5455 !important;
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
.v-theme--dark .bubble-mentions-me {
  background-color: #3a3222 !important;
}

.message-group:hover .message-actions-btn {
  opacity: 1 !important;
}
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }

/* @tên được tô sáng trong nội dung */
.mention-tag {
  font-weight: 700;
  color: #7367f0;
  background-color: rgba(115, 103, 240, 0.12);
  border-radius: 4px;
  padding: 0 3px;
}
.bubble-me .mention-tag {
  color: #ffffff;
  background-color: rgba(255, 255, 255, 0.22);
}
.message-link {
  color: inherit;
  text-decoration: underline;
  word-break: break-all;
}

.reaction-chip {
  cursor: pointer;
}
.reaction-pick {
  min-width: 30px !important;
  font-size: 1rem;
}

.system-chip {
  max-width: 90%;
  height: auto !important;
  white-space: normal;
  padding-block: 4px;
}

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
.status-dot-sm {
  width: 8px;
  height: 8px;
  border-width: 1.5px;
}

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
  width: 260px;
  z-index: 20;
  background-color: rgb(var(--v-theme-surface));
}
</style>
