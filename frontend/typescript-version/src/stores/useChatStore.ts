import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { io, Socket } from 'socket.io-client'
import { API_BASE, socketUrl } from '@/utils/api'
import { vnIncludes } from '@/utils/vnSearch'

export type GroupRole = 'owner' | 'admin' | 'member'

/**
 * `file` và `system` khớp enum `messages.type` trong MongoDB (xem backend/db/schema.js):
 *   - `media`  ảnh / video / tệp đính kèm gửi qua /api/upload
 *   - `location` toạ độ GPS (Task 3.1)
 *   - `system` tin do server sinh: tạo nhóm, thêm/xóa thành viên, đổi vai trò,
 *     đổi tên nhóm. Render giữa khung chat, không phải bong bóng của ai.
 */
export type MessageType = 'text' | 'media' | 'location' | 'file' | 'system'

/** Loại đính kèm server tính sẵn lúc ghi, dùng cho panel Bộ sưu tập (Task 3.2). */
export type AttachmentKind = 'image' | 'video' | 'file' | 'link'

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry'

export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  haha: '😂',
  wow: '😮',
  sad: '😢',
  angry: '😡',
}

export interface ChatUser {
  userId: string
  name: string
  avatar?: string
  role?: GroupRole
  email?: string
  employeeCode?: string
  department?: string
  position?: string
}

export interface MessageMetadata {
  fileUrl?: string
  filename?: string
  mimetype?: string
  fileSize?: string
  lat?: number
  lng?: number
  address?: string
}

export interface MessageReaction {
  userId: string
  reaction: ReactionType
  createdAt?: string
}

export interface ChatMessage {
  id: string | number
  conversationId: string | number
  senderId: string
  senderName: string
  senderAvatar?: string
  type: MessageType
  content: string
  metadata?: MessageMetadata
  /** userId của những người bị @ — server tự parse, client không gửi lên. */
  mentions?: string[]
  attachmentKind?: AttachmentKind | null
  reactions?: MessageReaction[]
  isDeleted?: boolean
  isSystem?: boolean
  createdAt?: string
  time: string
  isMe: boolean
  /** Tin đang chờ server xác nhận (optimistic UI), hoặc gửi lỗi. */
  pending?: boolean
  failed?: boolean
}

export interface ChatRoom {
  id: string | number
  type: 'direct' | 'group'
  name: string
  avatar: string
  isGroup: boolean
  isPinned: boolean
  myRole?: GroupRole
  partnerId?: string | null
  createdBy?: string | null
  members: ChatUser[]
  lastMessage?: {
    id?: any
    content: string
    type: MessageType
    senderId?: string
    senderName?: string
    time: string
    createdAt?: string
  } | null
  unreadCount: number
  /** Số tin có @tôi chưa đọc — badge riêng trên sidebar (Task 4.1). */
  mentionCount: number
  lastReadAt?: string | null
  updatedAt?: string
}

export interface AttachmentItem {
  id: string
  kind: AttachmentKind
  type: MessageType
  content: string
  metadata: MessageMetadata
  senderId: string
  senderName: string
  createdAt: string
  time: string
}

export interface MentionAlert {
  conversationId: string
  messageId: string
  conversationName: string | null
  isGroup: boolean
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  createdAt: string
}

const API_CHAT = `${API_BASE}/api/chat`

/** Số tin tải mỗi lần. Backend chặn tối đa 200. */
const PAGE_SIZE = 50

export const useChatStore = defineStore('chat', () => {
  // Lấy user đã đăng nhập từ localStorage / sessionStorage
  const getStoredUser = (): ChatUser => {
    try {
      const saved = localStorage.getItem('dvs_user') || sessionStorage.getItem('dvs_user')
      if (saved) {
        const u = JSON.parse(saved)

        return {
          userId: String(u.id),
          name: u.full_name || u.name,
          avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.full_name || 'User')}`,
          email: u.email,
          employeeCode: u.employee_code || u.employeeCode,
          department: u.department,
          position: u.position,
        }
      }
    }
    catch (e) { /* localStorage có thể bị chặn */ }

    return { userId: '', name: 'Khách', avatar: '' }
  }

  // Current user đăng nhập (tự động nạp theo tài khoản đã đăng nhập)
  const currentUser = ref<ChatUser>(getStoredUser())

  /**
   * Danh bạ nhân sự — nạp từ GET /api/chat/contacts.
   *
   * Bản cũ nhồi sẵn 4 nhân sự giả với userId '1'..'4'. Những id đó không phải
   * ObjectId nên mọi thao tác thật (mở chat 1-1, tạo nhóm) đều bị backend trả 400,
   * mà UI thì trông như đang hoạt động. Để rỗng và báo lỗi kết nối thì đúng hơn.
   */
  const contactList = ref<ChatUser[]>([])

  // Danh sách cuộc trò chuyện
  const chatRooms = ref<ChatRoom[]>([])

  // Phòng chat đang chọn ('' = chưa chọn / chưa có phòng nào)
  const activeRoomId = ref<string | number>('')

  // Tin nhắn theo conversationId: { [convId]: ChatMessage[] }
  const messagesMap = ref<Record<string | number, ChatMessage[]>>({})

  /** Còn tin cũ hơn để tải tiếp không, theo từng phòng (phân trang). */
  const hasMoreMap = ref<Record<string, boolean>>({})
  const loadingOlder = ref(false)

  // Set các userId đang Online
  const onlineUsers = ref<Set<string>>(new Set())

  // Typing state
  const typingMap = ref<Record<string | number, string[]>>({})

  // Search keyword trên sidebar
  const searchKeyword = ref('')

  // Right Drawer Profile/Group Info state
  const isProfileRightOpen = ref(false)

  /** Bộ sưu tập ảnh / video / file / link của phòng đang mở (Task 3.2). */
  const attachments = ref<AttachmentItem[]>([])
  const attachmentCounts = ref<Record<AttachmentKind, number>>({ image: 0, video: 0, file: 0, link: 0 })
  const loadingAttachments = ref(false)

  /** Lỗi gần nhất để UI hiện snackbar, thay cho console.warn im lặng. */
  const lastError = ref('')

  /** Thông báo @ gần nhất, cho popup/âm thanh (Task 4.1). */
  const lastMention = ref<MentionAlert | null>(null)

  // Socket instance
  let socket: Socket | null = null
  const isConnected = ref(false)

  /** Phòng rỗng khi chưa chọn gì — để template không phải kiểm tra null khắp nơi. */
  const EMPTY_ROOM: ChatRoom = {
    id: '',
    type: 'group',
    name: 'Chưa có cuộc trò chuyện',
    avatar: '',
    isGroup: false,
    isPinned: false,
    members: [],
    lastMessage: null,
    unreadCount: 0,
    mentionCount: 0,
  }

  const activeRoom = computed<ChatRoom>(() =>
    chatRooms.value.find(r => String(r.id) === String(activeRoomId.value)) || EMPTY_ROOM)

  /** Có phòng thật đang mở hay không — dùng để bật/tắt ô nhập tin. */
  const hasActiveRoom = computed(() => !!activeRoom.value.id)

  const activeMessages = computed(() => messagesMap.value[activeRoomId.value] || [])

  const hasMoreMessages = computed(() => !!hasMoreMap.value[String(activeRoomId.value)])

  /** Tổng số tin chưa đọc, cho badge trên menu/tab. */
  const totalUnread = computed(() => chatRooms.value.reduce((n, r) => n + (r.unreadCount || 0), 0))
  const totalMentions = computed(() => chatRooms.value.reduce((n, r) => n + (r.mentionCount || 0), 0))

  // Typing users trong phòng hiện tại
  const currentTypingUsers = computed(() =>
    (typingMap.value[String(activeRoomId.value)] || []).filter(name => name !== currentUser.value.name))

  const typingDisplayText = computed(() => {
    const users = currentTypingUsers.value
    if (users.length === 0) return ''
    if (users.length === 1) return `${users[0]} đang soạn tin...`

    return `${users[0]} và ${users.length - 1} người khác đang soạn tin...`
  })

  // 1. Danh sách phòng chat phù hợp từ khóa tìm kiếm (Ghim lên đầu, mới nhất trước)
  const sortedAndFilteredRooms = computed(() => {
    let list = [...chatRooms.value]

    if (searchKeyword.value.trim()) {
      const q = searchKeyword.value.trim()
      list = list.filter(r => vnIncludes(r.name, q))
    }

    list.sort((a, b) => {
      // 1. Ghim lên đầu (Task 2.3)
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1

      // 2. Mới nhất trước. updatedAt là ISO từ server, không phải chuỗi "10:35 AM"
      //    như bản cũ lấy từ lastMessage.time (parse ra NaN nên không sắp xếp được).
      const timeA = new Date(a.updatedAt || 0).getTime()
      const timeB = new Date(b.updatedAt || 0).getTime()

      return timeB - timeA
    })

    return list
  })

  // 2. Danh sách người dùng phù hợp từ khóa tìm kiếm (để nhắn tin trực tiếp 1-1)
  const matchingUsersForDirectChat = computed(() => {
    if (!searchKeyword.value.trim()) return []

    const q = searchKeyword.value.trim()

    // Không phân biệt dấu: gõ "tuan" phải ra "Trần Anh Tuấn"
    return contactList.value.filter(u => {
      if (String(u.userId) === String(currentUser.value.userId)) return false

      return vnIncludes(u.name, q) || vnIncludes(u.email, q)
        || vnIncludes(u.employeeCode, q) || vnIncludes(u.department, q)
    })
  })

  const isUserOnline = (userId: string) => onlineUsers.value.has(String(userId))

  /** Thành viên của phòng đang mở, trừ bản thân — dùng cho popup @mention. */
  const mentionCandidates = computed(() =>
    activeRoom.value.members.filter(m => String(m.userId) !== String(currentUser.value.userId)))

  /** fetch + báo lỗi gọn, thay cho try/catch lặp lại ở mỗi hàm. */
  const request = async (url: string, init?: RequestInit) => {
    try {
      const res = await fetch(url, init)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        lastError.value = (data && data.error) || `Lỗi ${res.status}`

        return null
      }

      return data
    }
    catch (e) {
      lastError.value = 'Không kết nối được tới server chat'

      return null
    }
  }

  const jsonInit = (method: string, body: any): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // Fetch danh bạ nhân viên từ backend
  const fetchContacts = async () => {
    const data = await request(`${API_CHAT}/contacts`)
    if (Array.isArray(data)) contactList.value = data
  }

  // Fetch Conversations từ Backend theo currentUser
  const fetchConversations = async (targetUserId?: string) => {
    const uid = targetUserId || currentUser.value.userId
    if (!uid) return

    const data = await request(`${API_CHAT}/conversations?userId=${uid}`)
    if (!Array.isArray(data)) return

    chatRooms.value = data

    if (data.length > 0) {
      const stillThere = chatRooms.value.some(r => String(r.id) === String(activeRoomId.value))
      if (!activeRoomId.value || !stillThere) {
        // Mở phòng đầu danh sách (đã ghim lên đầu, mới nhất trước)
        await selectRoom(sortedAndFilteredRooms.value[0]?.id ?? data[0].id)
      }
    }
    else {
      activeRoomId.value = ''
    }

    if (socket && isConnected.value) socket.emit('join_rooms', data.map(r => r.id))
  }

  /**
   * Tải lịch sử tin nhắn của một phòng (trang mới nhất).
   *
   * Backend trả `{ messages, hasMore, oldestId }` và chỉ gửi PAGE_SIZE tin cuối —
   * bản cũ nhận cả mảng toàn bộ tin của phòng.
   */
  const fetchMessages = async (convId: string | number) => {
    if (!convId) return

    const data = await request(`${API_CHAT}/messages/${convId}?limit=${PAGE_SIZE}`)
    if (!data || !Array.isArray(data.messages)) return

    messagesMap.value[convId] = data.messages.map(mapApiMessage)
    hasMoreMap.value[String(convId)] = !!data.hasMore
  }

  /** Nạp thêm trang tin cũ hơn (nút "Xem tin nhắn cũ hơn"). */
  const loadOlderMessages = async (convId: string | number = activeRoomId.value) => {
    const key = String(convId)
    const list = messagesMap.value[convId]
    if (!list || list.length === 0 || !hasMoreMap.value[key] || loadingOlder.value) return

    loadingOlder.value = true
    try {
      // Con trỏ là tin CŨ NHẤT đang có; _id tăng dần theo thời gian nên server chỉ
      // cần so sánh _id < before, không dùng OFFSET.
      const data = await request(`${API_CHAT}/messages/${convId}?limit=${PAGE_SIZE}&before=${list[0].id}`)
      if (!data || !Array.isArray(data.messages)) return

      const older = data.messages.map(mapApiMessage)
      messagesMap.value[convId] = [...older, ...list]
      hasMoreMap.value[key] = !!data.hasMore
    }
    finally {
      loadingOlder.value = false
    }
  }

  const mapApiMessage = (m: any): ChatMessage => ({
    ...m,
    isMe: String(m.senderId) === String(currentUser.value.userId),
  })

  /** Bộ sưu tập ảnh / video / tệp / liên kết của phòng (Task 3.2). */
  const fetchAttachments = async (convId: string | number = activeRoomId.value, kind = 'all') => {
    if (!convId) return

    loadingAttachments.value = true
    try {
      const data = await request(`${API_CHAT}/conversations/${convId}/attachments?kind=${kind}`)
      if (!data) return

      attachments.value = data.items || []
      attachmentCounts.value = data.counts || { image: 0, video: 0, file: 0, link: 0 }
    }
    finally {
      loadingAttachments.value = false
    }
  }

  /**
   * Đánh dấu đã đọc. Mốc `lastReadAt` nằm trong conversations.members[] nên badge
   * sống qua F5 và đồng bộ sang thiết bị khác — bản cũ chỉ gán unreadCount = 0
   * trong state nên tải lại trang là badge quay về.
   */
  const markRoomRead = async (convId: string | number) => {
    const room = chatRooms.value.find(r => String(r.id) === String(convId))
    if (!room || (room.unreadCount === 0 && room.mentionCount === 0)) return

    room.unreadCount = 0
    room.mentionCount = 0

    if (socket && isConnected.value) {
      socket.emit('mark_read', { conversation_id: convId, user_id: currentUser.value.userId })

      return
    }
    await request(`${API_CHAT}/conversations/${convId}/read`,
      jsonInit('POST', { userId: currentUser.value.userId }))
  }

  // Nhắn tin trực tiếp 1-1 với một người dùng (Direct Chat)
  const openDirectChatWithUser = async (targetUser: ChatUser) => {
    // 1. Phòng direct với người này đã có trong danh sách chưa?
    const existing = chatRooms.value.find(
      r => !r.isGroup && r.members.some(m => String(m.userId) === String(targetUser.userId)),
    )
    if (existing) {
      await selectRoom(existing.id)
      searchKeyword.value = ''

      return existing
    }

    // 2. Gọi backend API POST /api/chat/direct
    const data = await request(`${API_CHAT}/direct`, jsonInit('POST', {
      currentUserId: currentUser.value.userId,
      targetUserId: targetUser.userId,
    }))
    if (!data) return null

    await fetchConversations()
    await selectRoom(data.conversationId)
    searchKeyword.value = ''

    return chatRooms.value.find(r => String(r.id) === String(data.conversationId)) || null
  }

  // Âm thanh thông báo
  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime)
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.3)
    }
    catch (e) {
      // AudioContext bị chặn trước tương tác đầu tiên của người dùng
    }
  }

  /** Xin quyền Notification một lần, để thông báo mention hiện được popup. */
  const requestNotificationPermission = () => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default')
        Notification.requestPermission()
    }
    catch (e) { /* Safari cũ */ }
  }

  // Khởi tạo Socket.io với Auto-reconnect
  const initSocket = () => {
    fetchContacts()
    fetchConversations()

    if (socket) return

    try {
      socket = io(socketUrl(), {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        transports: ['websocket', 'polling'],
      })

      socket.on('connect', () => {
        isConnected.value = true

        // user_online TRƯỚC join_rooms: server chỉ cho vào phòng mà mình là thành
        // viên, và nó cần biết socket này của ai (socket.data.userId).
        socket?.emit('user_online', currentUser.value.userId)

        if (chatRooms.value.length > 0) socket?.emit('join_rooms', chatRooms.value.map(r => r.id))
        else if (activeRoomId.value) socket?.emit('join_room', activeRoomId.value)
      })

      socket.on('disconnect', () => {
        isConnected.value = false
      })

      socket.on('active_users', (userIds: string[]) => {
        onlineUsers.value = new Set(userIds.map(String))
      })

      socket.on('user_status_change', ({ userId, status }: { userId: string; status: 'online' | 'offline' }) => {
        const next = new Set(onlineUsers.value)
        if (status === 'online') next.add(String(userId))
        else next.delete(String(userId))
        onlineUsers.value = next
      })

      // Phòng mới xuất hiện (tin đầu tiên của chat 1-1, hoặc được thêm vào nhóm)
      socket.on('direct_chat_created', () => { fetchConversations() })
      socket.on('group_created', () => { fetchConversations() })
      socket.on('members_updated', () => { fetchConversations() })
      socket.on('role_changed', () => { fetchConversations() })

      socket.on('member_removed', ({ conversationId, userId }: any) => {
        if (String(userId) === String(currentUser.value.userId)) {
          // Chính mình bị xóa / vừa rời nhóm -> bỏ phòng khỏi sidebar
          removeRoomLocally(conversationId)
          lastError.value = 'Bạn không còn trong nhóm này'
        }
        else { fetchConversations() }
      })

      socket.on('conversation_updated', ({ conversationId, name, avatar }: any) => {
        const room = chatRooms.value.find(r => String(r.id) === String(conversationId))
        if (room && room.isGroup) {
          if (name) room.name = name
          if (avatar) room.avatar = avatar
        }
      })

      socket.on('conversation_deleted', ({ conversationId }: any) => {
        removeRoomLocally(conversationId)
      })

      // Tab/thiết bị khác của cùng người dùng đã đọc -> tắt badge ở đây luôn
      socket.on('conversation_read', ({ conversationId }: any) => {
        const room = chatRooms.value.find(r => String(r.id) === String(conversationId))
        if (room) {
          room.unreadCount = 0
          room.mentionCount = 0
        }
      })

      // Nhận tin nhắn qua Socket
      socket.on('receive_message', (msg: any) => { handleIncomingMessage(msg) })

      socket.on('message_deleted', ({ message_id }: { message_id: any }) => {
        handleMessageDeleted(message_id)
      })

      socket.on('message_reaction', ({ messageId, conversationId, reactions }: any) => {
        const list = messagesMap.value[conversationId] || []
        const msg = list.find(m => String(m.id) === String(messageId))
        if (msg) msg.reactions = reactions || []
      })

      // Server từ chối tin (không phải thành viên, phòng không tồn tại...)
      socket.on('message_error', ({ clientTempId, error }: any) => {
        lastError.value = error || 'Không gửi được tin nhắn'
        if (!clientTempId) return

        for (const convId in messagesMap.value) {
          const msg = messagesMap.value[convId].find(m => String(m.id) === String(clientTempId))
          if (msg) {
            msg.pending = false
            msg.failed = true
            break
          }
        }
      })

      // Thông báo riêng khi bị @ (Task 4.1) — server parse mention theo thành viên
      // thật, không dựa vào việc client tự so chuỗi tên như bản cũ.
      socket.on('mention_notification', (alert: MentionAlert) => {
        lastMention.value = alert
        playNotificationSound()
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const where = alert.isGroup && alert.conversationName ? ` trong ${alert.conversationName}` : ''
            new Notification(`${alert.senderName} đã nhắc đến bạn${where}`, {
              body: alert.content,
              icon: alert.senderAvatar,
            })
          }
        }
        catch (e) { /* Notification bị chặn */ }
      })

      // Typing: lưu theo đúng conversation_id của người đang soạn
      const typingTimers: Record<string, any> = {}

      const removeTyping = (convKey: string, userName: string) => {
        const list = typingMap.value[convKey] || []
        typingMap.value = { ...typingMap.value, [convKey]: list.filter(n => n !== userName) }
      }

      socket.on('display_typing', ({ conversation_id, user_id, user_name }: any) => {
        if (conversation_id === undefined || conversation_id === null) return
        if (user_id && String(user_id) === String(currentUser.value.userId)) return

        const convKey = String(conversation_id)
        const list = typingMap.value[convKey] || []
        if (!list.includes(user_name)) typingMap.value = { ...typingMap.value, [convKey]: [...list, user_name] }

        // Tự ẩn sau 5s nếu không nhận được stop_typing (mất kết nối, đóng tab...)
        const timerKey = `${convKey}_${user_name}`
        if (typingTimers[timerKey]) clearTimeout(typingTimers[timerKey])
        typingTimers[timerKey] = setTimeout(() => removeTyping(convKey, user_name), 5000)
      })

      socket.on('hide_typing', ({ conversation_id, user_name }: any) => {
        if (conversation_id === undefined || conversation_id === null) return

        const convKey = String(conversation_id)
        if (user_name) removeTyping(convKey, user_name)
        else typingMap.value = { ...typingMap.value, [convKey]: [] }
      })
    }
    catch (e) {
      lastError.value = 'Không kết nối được tới server chat'
    }
  }

  const removeRoomLocally = (conversationId: any) => {
    chatRooms.value = chatRooms.value.filter(r => String(r.id) !== String(conversationId))
    delete messagesMap.value[conversationId]
    delete hasMoreMap.value[String(conversationId)]
    if (String(activeRoomId.value) === String(conversationId)) {
      activeRoomId.value = chatRooms.value[0]?.id ?? ''
      if (activeRoomId.value) fetchMessages(activeRoomId.value)
    }
  }

  const selectRoom = async (roomId: string | number) => {
    if (!roomId) return

    activeRoomId.value = roomId
    await fetchMessages(roomId)
    markRoomRead(roomId)

    if (socket && isConnected.value) socket.emit('join_room', roomId)
    if (isProfileRightOpen.value) fetchAttachments(roomId)
  }

  // Xử lý tin nhắn đến và chống Duplicate triệt để
  const handleIncomingMessage = (data: any) => {
    const convId = data.conversation_id || data.conversationId
    if (!convId) return

    if (!messagesMap.value[convId]) messagesMap.value[convId] = []
    const list = messagesMap.value[convId]

    // 1. Tin đã có theo ID database -> bỏ qua
    if (list.some(m => String(m.id) === String(data.id))) return

    const isSenderMe = String(data.sender_id || data.senderId) === String(currentUser.value.userId)

    // 2. Chống Duplicate cho Người gửi: thay tin tạm bằng tin thật theo client_temp_id
    if (data.client_temp_id) {
      const pending = list.find(m => String(m.id) === String(data.client_temp_id))
      if (pending) {
        pending.id = data.id
        pending.pending = false
        pending.failed = false
        pending.createdAt = data.created_at
        pending.mentions = data.mentions || []
        pending.attachmentKind = data.attachment_kind || null
        if (data.metadata) {
          pending.metadata = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata
        }

        return
      }
    }

    const isSystem = data.is_system || data.type === 'system'

    const newMsg: ChatMessage = {
      id: data.id,
      conversationId: convId,
      senderId: data.sender_id || data.senderId,
      senderName: data.sender_name || data.senderName || 'Thành viên',
      senderAvatar: data.sender_avatar || data.senderAvatar,
      type: data.type || 'text',
      content: data.content,
      metadata: typeof data.metadata === 'string' ? JSON.parse(data.metadata) : (data.metadata || {}),
      mentions: data.mentions || [],
      attachmentKind: data.attachment_kind || null,
      reactions: data.reactions || [],
      isSystem,
      createdAt: data.created_at || new Date().toISOString(),
      time: new Date(data.created_at || Date.now())
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: isSenderMe && !isSystem,
    }

    list.push(newMsg)

    const room = chatRooms.value.find(r => String(r.id) === String(convId))
    if (!room) {
      // Tin từ cuộc trò chuyện vừa được tạo / vừa được thêm vào
      fetchConversations()

      return
    }

    room.updatedAt = newMsg.createdAt
    room.lastMessage = {
      id: newMsg.id,
      content: newMsg.content,
      type: newMsg.type,
      senderId: newMsg.senderId,
      senderName: newMsg.senderName,
      time: newMsg.time,
      createdAt: newMsg.createdAt,
    }

    // Đang mở phòng này -> coi như đã đọc; phòng khác -> tăng badge.
    // Tin hệ thống và tin của chính mình không tính là chưa đọc (khớp cách backend đếm).
    if (String(convId) === String(activeRoomId.value)) {
      if (!isSenderMe && !isSystem) markRoomRead(convId)
    }
    else if (!isSenderMe && !isSystem) {
      room.unreadCount += 1
      if ((newMsg.mentions || []).includes(String(currentUser.value.userId))) room.mentionCount += 1
    }

    // Đính kèm mới -> làm mới panel Bộ sưu tập nếu đang mở đúng phòng
    if (newMsg.attachmentKind && isProfileRightOpen.value
      && String(convId) === String(activeRoomId.value)) {
      fetchAttachments(convId)
    }
  }

  const handleMessageDeleted = (messageId: any) => {
    for (const convId in messagesMap.value) {
      const msg = messagesMap.value[convId].find(m => String(m.id) === String(messageId))
      if (msg) {
        msg.isDeleted = true
        msg.content = 'Tin nhắn này đã bị xóa'
        msg.metadata = {}
        msg.reactions = []
        break
      }
    }
  }

  /**
   * Gửi tin nhắn Text / Media / Location.
   *
   * Mention KHÔNG gửi kèm: server tự parse "@tên" theo danh sách thành viên thật
   * (xem services/chat.js). Nếu client gửi mảng mentions thì chỉ cần sửa payload
   * là bắn thông báo cho người không liên quan.
   */
  const sendMessage = (content: string, type: MessageType = 'text', metadata?: MessageMetadata) => {
    if (!hasActiveRoom.value) {
      lastError.value = 'Hãy chọn một cuộc trò chuyện trước khi gửi tin'

      return
    }
    if (!content.trim() && type === 'text') return

    const convId = activeRoomId.value
    const tempId = `local-${Date.now()}`
    const now = new Date()

    const newMsg: ChatMessage = {
      id: tempId,
      conversationId: convId,
      senderId: currentUser.value.userId,
      senderName: currentUser.value.name,
      senderAvatar: currentUser.value.avatar,
      type,
      content,
      metadata: metadata || {},
      mentions: [],
      reactions: [],
      createdAt: now.toISOString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
      pending: true,
    }

    if (!messagesMap.value[convId]) messagesMap.value[convId] = []
    messagesMap.value[convId].push(newMsg)

    const room = chatRooms.value.find(r => String(r.id) === String(convId))
    if (room) {
      room.updatedAt = newMsg.createdAt
      room.lastMessage = {
        id: newMsg.id,
        content: type === 'media' ? '[Tệp đính kèm]' : type === 'location' ? '[Vị trí]' : content,
        type,
        senderId: currentUser.value.userId,
        senderName: currentUser.value.name,
        time: newMsg.time,
        createdAt: newMsg.createdAt,
      }
    }

    if (!socket || !isConnected.value) {
      newMsg.pending = false
      newMsg.failed = true
      lastError.value = 'Mất kết nối tới server chat, tin nhắn chưa được gửi'

      return
    }

    socket.emit('send_message', {
      conversation_id: convId,
      sender_id: currentUser.value.userId,
      sender_name: currentUser.value.name,
      sender_avatar: currentUser.value.avatar,
      type,
      content,
      metadata: metadata || {},
      client_temp_id: tempId, // backend trả lại để client ghép tin tạm với tin thật
    })
  }

  /** Chỉ xóa được tin của chính mình — server kiểm tra lại điều này. */
  const deleteMessage = (messageId: any) => {
    const msg = activeMessages.value.find(m => String(m.id) === String(messageId))
    if (msg && !msg.isMe) {
      lastError.value = 'Chỉ xóa được tin nhắn của chính bạn'

      return
    }

    handleMessageDeleted(messageId)

    if (socket && isConnected.value) {
      socket.emit('delete_message', {
        message_id: messageId,
        conversation_id: activeRoomId.value,
        user_id: currentUser.value.userId,
      })
    }
  }

  /** Thả / bỏ cảm xúc. Bấm lại cùng loại là bỏ (toggle). */
  const toggleReaction = async (messageId: any, reaction: ReactionType) => {
    const data = await request(`${API_CHAT}/messages/${messageId}/reactions`,
      jsonInit('POST', { userId: currentUser.value.userId, reaction }))
    if (!data) return

    const list = messagesMap.value[activeRoomId.value] || []
    const msg = list.find(m => String(m.id) === String(messageId))
    if (msg) msg.reactions = data.reactions || []
  }

  const emitTyping = () => {
    if (socket && isConnected.value && activeRoomId.value) {
      socket.emit('typing', {
        conversation_id: String(activeRoomId.value),
        user_id: String(currentUser.value.userId),
        user_name: currentUser.value.name,
      })
    }
  }

  const emitStopTyping = () => {
    if (socket && isConnected.value && activeRoomId.value) {
      socket.emit('stop_typing', {
        conversation_id: String(activeRoomId.value),
        user_id: String(currentUser.value.userId),
        user_name: currentUser.value.name,
      })
    }
  }

  const togglePinRoom = async (roomId: string | number) => {
    const room = chatRooms.value.find(r => String(r.id) === String(roomId))
    if (!room) return

    const next = !room.isPinned
    room.isPinned = next

    const data = await request(`${API_CHAT}/conversations/${roomId}/pin`,
      jsonInit('POST', { userId: currentUser.value.userId, isPinned: next }))

    // Server từ chối -> trả lại trạng thái cũ, không để UI lệch với DB
    if (!data) room.isPinned = !next
  }

  // Tạo nhóm mới (Task 1.3: tối thiểu 3 thành viên)
  const createGroup = async (name: string, avatar: string, selectedMembers: ChatUser[]) => {
    const fullMembers = [
      { ...currentUser.value, role: 'owner' as GroupRole },
      ...selectedMembers
        .filter(m => String(m.userId) !== String(currentUser.value.userId))
        .map(m => ({ ...m, role: 'member' as GroupRole })),
    ]

    if (fullMembers.length < 3) throw new Error('Nhóm chat phải có tối thiểu 3 thành viên!')

    const data = await request(`${API_CHAT}/groups`, jsonInit('POST', {
      name: name.trim() || 'Nhóm mới',
      avatar: avatar || 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
      members: fullMembers,
      createdBy: currentUser.value,
    }))
    if (!data) throw new Error(lastError.value || 'Không tạo được nhóm')

    await fetchConversations()
    await selectRoom(data.conversationId)

    return data
  }

  /** Đổi tên nhóm / ảnh đại diện (owner + admin) — Task 1.4. */
  const updateGroupInfo = async (payload: { name?: string; avatar?: string }) => {
    const room = activeRoom.value
    if (!room.id || !room.isGroup) return

    const data = await request(`${API_CHAT}/groups/${room.id}`, jsonInit('PUT', {
      ...payload,
      requesterUserId: currentUser.value.userId,
    }))
    if (!data) throw new Error(lastError.value || 'Không cập nhật được nhóm')

    if (data.name) room.name = data.name
    if (data.avatar) room.avatar = data.avatar

    return data
  }

  const addMembersToCurrentGroup = async (newMembers: ChatUser[]) => {
    const room = activeRoom.value
    if (!room.id || !room.isGroup) return

    const data = await request(`${API_CHAT}/groups/${room.id}/members`, jsonInit('POST', {
      members: newMembers,
      requesterUserId: currentUser.value.userId,
    }))
    if (!data) throw new Error(lastError.value || 'Không thêm được thành viên')

    // Tin hệ thống "X đã thêm Y vào nhóm" do SERVER sinh và phát qua socket.
    // Bản cũ gọi sendMessage() ở đây nên dòng đó hiện như tin nhắn thường của
    // người thao tác, và ai tắt tab trước khi API xong thì không có dòng nào.
    await fetchConversations()

    return data
  }

  const changeMemberRole = async (userId: string, newRole: GroupRole) => {
    const room = activeRoom.value
    if (!room.id || !room.isGroup) return
    if (room.myRole !== 'owner') throw new Error('Chỉ Trưởng nhóm (Owner) mới có quyền đổi vai trò hoặc nhường quyền!')

    const data = await request(`${API_CHAT}/groups/${room.id}/role`, jsonInit('PUT', {
      targetUserId: userId,
      newRole,
      requesterUserId: currentUser.value.userId,
    }))
    if (!data) throw new Error(lastError.value || 'Không đổi được vai trò')

    await fetchConversations()

    return data
  }

  const removeMemberFromGroup = async (userId: string) => {
    const room = activeRoom.value
    if (!room.id || !room.isGroup) return
    if (room.myRole !== 'owner') throw new Error('Chỉ Trưởng nhóm (Owner) mới có quyền xóa thành viên khỏi nhóm!')

    const url = `${API_CHAT}/groups/${room.id}/members/${userId}?requesterUserId=${currentUser.value.userId}`
    const data = await request(url, { method: 'DELETE' })
    if (!data) throw new Error(lastError.value || 'Không xóa được thành viên')

    await fetchConversations()

    return data
  }

  /** Tự rời nhóm. Owner rời thì server tự chuyển quyền cho người phù hợp. */
  const leaveCurrentGroup = async () => {
    const room = activeRoom.value
    if (!room.id || !room.isGroup) return

    const data = await request(`${API_CHAT}/groups/${room.id}/leave`,
      jsonInit('POST', { userId: currentUser.value.userId }))
    if (!data) throw new Error(lastError.value || 'Không rời được nhóm')

    removeRoomLocally(room.id)
    isProfileRightOpen.value = false

    return data
  }

  /** Xóa cả cuộc trò chuyện kèm toàn bộ tin nhắn (nhóm: chỉ owner). */
  const deleteCurrentConversation = async () => {
    const room = activeRoom.value
    if (!room.id) return

    const url = `${API_CHAT}/conversations/${room.id}?requesterUserId=${currentUser.value.userId}`
    const data = await request(url, { method: 'DELETE' })
    if (!data) throw new Error(lastError.value || 'Không xóa được cuộc trò chuyện')

    removeRoomLocally(room.id)
    isProfileRightOpen.value = false

    return data
  }

  // Cập nhật người dùng hiện tại khi đăng nhập / đăng xuất
  const setCurrentUser = (userData: any) => {
    if (userData) {
      currentUser.value = {
        userId: String(userData.id || userData.userId),
        name: userData.full_name || userData.name || '',
        avatar: userData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userData.full_name || 'User')}`,
        email: userData.email,
        employeeCode: userData.employee_code || userData.employeeCode,
        department: userData.department,
        position: userData.position,
      }
    }
    else {
      currentUser.value = { userId: '', name: 'Khách', avatar: '' }
    }

    activeRoomId.value = ''
    chatRooms.value = []
    messagesMap.value = {}
    hasMoreMap.value = {}
    attachments.value = []

    if (!currentUser.value.userId) return

    fetchContacts()
    fetchConversations()

    if (socket && isConnected.value) socket.emit('user_online', currentUser.value.userId)
  }

  const disconnectSocket = () => {
    if (socket) {
      socket.disconnect()
      socket = null
      isConnected.value = false
    }
  }

  return {
    currentUser,
    contactList,
    chatRooms,
    activeRoomId,
    activeRoom,
    hasActiveRoom,
    activeMessages,
    hasMoreMessages,
    loadingOlder,
    onlineUsers,
    currentTypingUsers,
    typingDisplayText,
    searchKeyword,
    sortedAndFilteredRooms,
    matchingUsersForDirectChat,
    mentionCandidates,
    isProfileRightOpen,
    isConnected,
    attachments,
    attachmentCounts,
    loadingAttachments,
    lastError,
    lastMention,
    totalUnread,
    totalMentions,
    isUserOnline,
    initSocket,
    setCurrentUser,
    disconnectSocket,
    requestNotificationPermission,
    fetchContacts,
    fetchConversations,
    fetchMessages,
    loadOlderMessages,
    fetchAttachments,
    markRoomRead,
    openDirectChatWithUser,
    selectRoom,
    sendMessage,
    deleteMessage,
    toggleReaction,
    emitTyping,
    emitStopTyping,
    togglePinRoom,
    createGroup,
    updateGroupInfo,
    addMembersToCurrentGroup,
    changeMemberRole,
    removeMemberFromGroup,
    leaveCurrentGroup,
    deleteCurrentConversation,
  }
})
