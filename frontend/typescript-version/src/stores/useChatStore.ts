import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { io, Socket } from 'socket.io-client'

export type GroupRole = 'owner' | 'admin' | 'member'
export type MessageType = 'text' | 'media' | 'location'

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
  mentions?: string[]
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
  isDeleted?: boolean
  createdAt?: string
  time: string
  isMe: boolean
}

export interface ChatRoom {
  id: string | number
  type: 'direct' | 'group'
  name: string
  avatar: string
  isGroup: boolean
  isPinned: boolean
  myRole?: GroupRole
  members: ChatUser[]
  lastMessage?: {
    id?: any
    content: string
    type: MessageType
    time: string
  } | null
  unreadCount: number
  updatedAt?: string
}

const API_CHAT = 'http://localhost:5000/api/chat'

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
    } catch (e) {}
    return {
      userId: '1',
      name: 'Nguyễn Quản Trị',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
      email: 'admin@datvietso.vn',
      employeeCode: 'DVS-001',
    }
  }

  // Current user đăng nhập (tự động nạp theo tài khoản đã đăng nhập)
  const currentUser = ref<ChatUser>(getStoredUser())

  // Danh bạ nhân sự trong hệ thống (tất cả nhân viên để tìm kiếm và nhắn tin 1-1)
  const contactList = ref<ChatUser[]>([
    {
      userId: '1',
      name: 'Nguyễn Quản Trị',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
      email: 'admin@datvietso.vn',
      employeeCode: 'DVS-001',
      department: 'Ban Giám Đốc',
      position: 'Tổng Giám Đốc',
    },
    {
      userId: '2',
      name: 'Trần Anh Tuấn',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tuan',
      email: 'tuan.ta@datvietso.vn',
      employeeCode: 'DVS-002',
      department: 'Khối Kỹ Thuật & Công Nghệ',
      position: 'Kỹ Sư Phần Mềm Cao Cấp',
    },
    {
      userId: '3',
      name: 'Lê Thị Mai Hoa',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hoa',
      email: 'hoa.ltm@datvietso.vn',
      employeeCode: 'DVS-003',
      department: 'Phòng Phát Triển Kinh Doanh',
      position: 'Chuyên Viên Kinh Doanh',
    },
    {
      userId: '4',
      name: 'Phạm Ngọc Lan',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lan',
      email: 'lan.pn@datvietso.vn',
      employeeCode: 'DVS-004',
      department: 'Phòng Nhân Sự & Hành Chính',
      position: 'Trưởng Phòng Nhân Sự',
    },
  ])

  // Danh sách cuộc trò chuyện
  const chatRooms = ref<ChatRoom[]>([])

  // Phòng chat đang chọn
  const activeRoomId = ref<string | number>(1)

  // Tin nhắn theo conversationId: { [convId]: ChatMessage[] }
  const messagesMap = ref<Record<string | number, ChatMessage[]>>({})

  // Set các userId đang Online
  const onlineUsers = ref<Set<string>>(new Set(['1', '2', '3']))

  // Typing state
  const typingMap = ref<Record<string | number, string[]>>({})

  // Search keyword trên sidebar
  const searchKeyword = ref('')

  // Right Drawer Profile/Group Info state
  const isProfileRightOpen = ref(false)

  // Socket instance
  let socket: Socket | null = null
  const isConnected = ref(false)

  // Active room computed
  const activeRoom = computed(() => {
    return chatRooms.value.find(r => r.id === activeRoomId.value) || chatRooms.value[0] || {
      id: 1,
      type: 'group',
      name: 'Đất Việt Số - Tổng Công Ty',
      avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
      isGroup: true,
      isPinned: false,
      myRole: 'owner',
      members: contactList.value,
      unreadCount: 0,
    }
  })

  // Active messages computed
  const activeMessages = computed(() => {
    return messagesMap.value[activeRoomId.value] || []
  })

  // Typing users trong phòng hiện tại
  const currentTypingUsers = computed(() => {
    return (typingMap.value[String(activeRoomId.value)] || []).filter(name => name !== currentUser.value.name)
  })

  const typingDisplayText = computed(() => {
    const users = currentTypingUsers.value
    if (users.length === 0) return ''
    if (users.length === 1) return `${users[0]} đang soạn tin...`
    return `${users[0]} và ${users.length - 1} người khác đang soạn tin...`
  })

  // 1. Danh sách phòng chat phù hợp từ khóa tìm kiếm (Ghim lên đầu, từ mới nhất đến muộn nhất)
  const sortedAndFilteredRooms = computed(() => {
    let list = [...chatRooms.value]

    if (searchKeyword.value.trim()) {
      const q = searchKeyword.value.toLowerCase().trim()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }

    list.sort((a, b) => {
      // 1. Ghim lên đầu
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1

      // 2. Sắp xếp tin nhắn từ mới nhất đến muộn nhất
      const timeA = new Date(a.updatedAt || a.lastMessage?.time || 0).getTime()
      const timeB = new Date(b.updatedAt || b.lastMessage?.time || 0).getTime()
      return timeB - timeA
    })

    return list
  })

  // 2. Danh sách người dùng phù hợp từ khóa tìm kiếm (để nhắn tin trực tiếp 1-1)
  const matchingUsersForDirectChat = computed(() => {
    if (!searchKeyword.value.trim()) return []

    const q = searchKeyword.value.toLowerCase().trim()
    return contactList.value.filter(u => {
      if (String(u.userId) === String(currentUser.value.userId)) return false
      const matchName = u.name.toLowerCase().includes(q)
      const matchEmail = (u.email || '').toLowerCase().includes(q)
      const matchCode = (u.employeeCode || '').toLowerCase().includes(q)
      const matchDept = (u.department || '').toLowerCase().includes(q)
      return matchName || matchEmail || matchCode || matchDept
    })
  })

  const isUserOnline = (userId: string) => {
    return onlineUsers.value.has(String(userId))
  }

  // Fetch danh bạ nhân viên từ backend
  const fetchContacts = async () => {
    try {
      const res = await fetch(`${API_CHAT}/contacts`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          contactList.value = data
        }
      }
    } catch (e) {
      console.warn('[ChatStore] Cannot fetch contacts from backend', e)
    }
  }

  // Fetch Conversations từ Backend theo currentUser
  const fetchConversations = async (targetUserId?: string) => {
    const uid = targetUserId || currentUser.value.userId
    try {
      const res = await fetch(`${API_CHAT}/conversations?userId=${uid}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          chatRooms.value = data
          if (data.length > 0) {
            if (!activeRoomId.value || !chatRooms.value.some(r => String(r.id) === String(activeRoomId.value))) {
              activeRoomId.value = data[0].id
            }
            await fetchMessages(activeRoomId.value)
          }
          if (socket && isConnected.value) {
            socket.emit('join_rooms', data.map(r => r.id))
          }
          return
        }
      }
    } catch (e) {
      console.warn('[ChatStore] Cannot fetch conversations from backend, using default', e)
    }

    // Fallback default mock
    if (chatRooms.value.length === 0) {
      chatRooms.value = [
        {
          id: 1,
          type: 'group',
          name: 'Đất Việt Số - Tổng Công Ty',
          avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
          isGroup: true,
          isPinned: true,
          myRole: 'owner',
          members: contactList.value,
          lastMessage: {
            content: 'Chào mừng cả đội ngũ tham gia hệ thống DatVietSo!',
            type: 'text',
            time: '11:38 AM',
          },
          unreadCount: 0,
        },
      ]
      fetchMessages(1)
    }
  }

  // Fetch Messages cho 1 conversation từ Backend
  const fetchMessages = async (convId: string | number) => {
    try {
      const res = await fetch(`${API_CHAT}/messages/${convId}`)
      if (res.ok) {
        const msgs = await res.json()
        if (Array.isArray(msgs)) {
          messagesMap.value[convId] = msgs.map(m => ({
            ...m,
            isMe: String(m.senderId) === String(currentUser.value.userId),
          }))
          return
        }
      }
    } catch (e) {
      console.warn(`[ChatStore] Cannot fetch messages for room ${convId}`, e)
    }

    if (!messagesMap.value[convId]) {
      messagesMap.value[convId] = [
        {
          id: 1,
          conversationId: convId,
          senderId: '1',
          senderName: 'Nguyễn Quản Trị',
          senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
          type: 'text',
          content: 'Chào mừng cả đội ngũ tham gia hệ thống quản trị DatVietSo!',
          time: '11:38 AM',
          isMe: true,
        },
      ]
    }
  }

  // Nhắn tin trực tiếp 1-1 với một người dùng (Direct Chat)
  const openDirectChatWithUser = async (targetUser: ChatUser) => {
    // 1. Kiểm tra xem phòng direct với targetUser đã có trong chatRooms chưa
    const existing = chatRooms.value.find(
      r => !r.isGroup && r.members.some(m => String(m.userId) === String(targetUser.userId))
    )

    if (existing) {
      selectRoom(existing.id)
      searchKeyword.value = ''
      return existing
    }

    // 2. Gọi backend API POST /api/chat/direct
    try {
      const res = await fetch(`${API_CHAT}/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentUserId: currentUser.value.userId,
          targetUserId: targetUser.userId,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        await fetchConversations()
        selectRoom(data.conversationId)
        searchKeyword.value = ''
        return
      }
    } catch (e) {
      console.warn('Error creating direct chat via API, creating local direct room', e)
    }

    // Fallback tạo local direct room nếu server offline
    const directId = `direct-${Date.now()}`
    const newRoom: ChatRoom = {
      id: directId,
      type: 'direct',
      name: targetUser.name,
      avatar: targetUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(targetUser.name)}`,
      isGroup: false,
      isPinned: false,
      myRole: 'member',
      members: [
        { ...currentUser.value, role: 'member' },
        { ...targetUser, role: 'member' },
      ],
      lastMessage: null,
      unreadCount: 0,
    }

    chatRooms.value.unshift(newRoom)
    selectRoom(directId)
    searchKeyword.value = ''
    return newRoom
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
    } catch (e) {
      // AudioContext not allowed before user gesture
    }
  }

  // Khởi tạo Socket.io với Auto-reconnect
  const initSocket = () => {
    fetchContacts()
    fetchConversations()

    if (socket) return

    try {
      socket = io('http://localhost:5000', {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        transports: ['websocket', 'polling'],
      })

      socket.on('connect', () => {
        console.log('[Socket] Connected to server, ID:', socket?.id)
        isConnected.value = true
        socket?.emit('user_online', currentUser.value.userId)

        if (chatRooms.value.length > 0) {
          socket?.emit('join_rooms', chatRooms.value.map(r => r.id))
        } else if (activeRoomId.value) {
          socket?.emit('join_room', activeRoomId.value)
        }
      })

      socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server')
        isConnected.value = false
      })

      socket.on('active_users', (userIds: string[]) => {
        onlineUsers.value = new Set(userIds.map(String))
      })

      socket.on('user_status_change', ({ userId, status }: { userId: string; status: 'online' | 'offline' }) => {
        const nextSet = new Set(onlineUsers.value)
        if (status === 'online') {
          nextSet.add(String(userId))
        } else {
          nextSet.delete(String(userId))
        }
        onlineUsers.value = nextSet
      })

      socket.on('direct_chat_created', ({ currentUserId, targetUserId }: any) => {
        if (String(currentUser.value.userId) === String(currentUserId) || String(currentUser.value.userId) === String(targetUserId)) {
          fetchConversations()
        }
      })

      // Nhận tin nhắn qua Socket
      socket.on('receive_message', (msg: any) => {
        handleIncomingMessage(msg)
      })

      socket.on('message_deleted', ({ message_id }: { message_id: any }) => {
        handleMessageDeleted(message_id)
      })

      // Typing: lưu theo đúng conversation_id của người đang soạn (không dùng phòng đang mở)
      const typingTimers: Record<string, any> = {}

      const removeTyping = (convKey: string, userName: string) => {
        const list = typingMap.value[convKey] || []
        typingMap.value = { ...typingMap.value, [convKey]: list.filter(n => n !== userName) }
      }

      socket.on('display_typing', ({ conversation_id, user_id, user_name }: { conversation_id: any; user_id?: string; user_name: string }) => {
        if (conversation_id === undefined || conversation_id === null) return
        if (user_id && String(user_id) === String(currentUser.value.userId)) return
        const convKey = String(conversation_id)
        const list = typingMap.value[convKey] || []
        if (!list.includes(user_name)) {
          typingMap.value = { ...typingMap.value, [convKey]: [...list, user_name] }
        }
        // Tự ẩn sau 5s nếu không nhận được stop_typing (mất kết nối, đóng tab...)
        const timerKey = `${convKey}_${user_name}`
        if (typingTimers[timerKey]) clearTimeout(typingTimers[timerKey])
        typingTimers[timerKey] = setTimeout(() => removeTyping(convKey, user_name), 5000)
      })

      socket.on('hide_typing', ({ conversation_id, user_name }: { conversation_id: any; user_name?: string }) => {
        if (conversation_id === undefined || conversation_id === null) return
        const convKey = String(conversation_id)
        if (user_name) {
          removeTyping(convKey, user_name)
        } else {
          typingMap.value = { ...typingMap.value, [convKey]: [] }
        }
      })
    } catch (e) {
      console.warn('[Socket] Could not connect to backend server', e)
    }
  }

  const selectRoom = (roomId: string | number) => {
    activeRoomId.value = roomId
    const room = chatRooms.value.find(r => r.id === roomId)
    if (room) room.unreadCount = 0

    fetchMessages(roomId)

    if (socket && isConnected.value) {
      socket.emit('join_room', roomId)
    }
  }

  // Xử lý tin nhắn đến và chống Duplicate triệt để
  const handleIncomingMessage = (data: any) => {
    const convId = data.conversation_id || data.conversationId || activeRoomId.value
    if (!messagesMap.value[convId]) messagesMap.value[convId] = []

    const list = messagesMap.value[convId]

    // 1. Kiểm tra nếu tin nhắn theo ID database đã tồn tại -> bỏ qua
    const alreadyExists = list.some(m => String(m.id) === String(data.id))
    if (alreadyExists) return

    // 2. Chống Duplicate cho Người gửi: Reconcile theo client_temp_id
    if (data.client_temp_id) {
      const pendingIndex = list.findIndex(m => m.id === data.client_temp_id)
      if (pendingIndex !== -1) {
        list[pendingIndex].id = data.id
        if (data.metadata) {
          list[pendingIndex].metadata = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata
        }
        return
      }
    }

    // 3. Fallback chống Duplicate nếu người gửi là chính tôi và có local pending message
    const isSenderMe = String(data.sender_id || data.senderId) === String(currentUser.value.userId)
    if (isSenderMe) {
      const pendingIndex = list.findIndex(m => String(m.id).startsWith('local-') && m.type === data.type)
      if (pendingIndex !== -1) {
        list[pendingIndex].id = data.id
        if (data.metadata) {
          list[pendingIndex].metadata = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata
        }
        return
      }
    }

    // 4. Tin nhắn từ người khác -> push vào danh sách
    const newMsg: ChatMessage = {
      id: data.id || Date.now(),
      conversationId: convId,
      senderId: data.sender_id || data.senderId,
      senderName: data.sender_name || data.senderName || 'Thành viên',
      senderAvatar: data.sender_avatar || data.senderAvatar,
      type: data.type || 'text',
      content: data.content,
      metadata: typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata,
      createdAt: data.created_at || new Date().toISOString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: isSenderMe,
    }

    list.push(newMsg)

    // Âm thanh thông báo nếu có mention
    if (!newMsg.isMe) {
      if (newMsg.content.includes(`@${currentUser.value.name}`)) {
        playNotificationSound()
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`Bạn được nhắc đến bởi ${newMsg.senderName}`, {
            body: newMsg.content,
            icon: newMsg.senderAvatar,
          })
        }
      }
    }

    const room = chatRooms.value.find(r => String(r.id) === String(convId))
    if (room) {
      room.updatedAt = new Date().toISOString()
      room.lastMessage = {
        id: newMsg.id,
        content: `${newMsg.senderName}: ${newMsg.content}`,
        type: newMsg.type,
        time: newMsg.time,
      }
      if (String(convId) !== String(activeRoomId.value)) room.unreadCount++
    } else {
      // Tin nhắn từ cuộc trò chuyện mới được tạo
      fetchConversations()
    }
  }

  const handleMessageDeleted = (messageId: any) => {
    for (const convId in messagesMap.value) {
      const msg = messagesMap.value[convId].find(m => String(m.id) === String(messageId))
      if (msg) {
        msg.isDeleted = true
        msg.content = 'Tin nhắn này đã bị xóa'
        break
      }
    }
  }

  // Gửi tin nhắn Text / Media / Location
  const sendMessage = (content: string, type: MessageType = 'text', metadata?: MessageMetadata) => {
    if (!content.trim() && type === 'text') return

    const convId = activeRoomId.value
    const tempId = `local-${Date.now()}`

    const newMsg: ChatMessage = {
      id: tempId,
      conversationId: convId,
      senderId: currentUser.value.userId,
      senderName: currentUser.value.name,
      senderAvatar: currentUser.value.avatar,
      type,
      content,
      metadata,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
    }

    if (!messagesMap.value[convId]) messagesMap.value[convId] = []
    messagesMap.value[convId].push(newMsg)

    const room = chatRooms.value.find(r => String(r.id) === String(convId))
    if (room) {
      room.updatedAt = new Date().toISOString()
      room.lastMessage = {
        id: newMsg.id,
        content: `Bạn: ${type === 'media' ? '[Tệp đính kèm]' : type === 'location' ? '[Vị trí]' : content}`,
        type,
        time: newMsg.time,
      }
    }

    if (socket && isConnected.value) {
      socket.emit('send_message', {
        conversation_id: convId,
        sender_id: currentUser.value.userId,
        sender_name: currentUser.value.name,
        sender_avatar: currentUser.value.avatar,
        type,
        content,
        metadata: metadata || {},
        client_temp_id: tempId, // Gửi tempId để backend trả về cho client reconcile
      })
    }
  }

  const deleteMessage = (messageId: any) => {
    handleMessageDeleted(messageId)
    if (socket && isConnected.value) {
      socket.emit('delete_message', {
        message_id: messageId,
        conversation_id: activeRoomId.value,
      })
    }
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
    const room = chatRooms.value.find(r => r.id === roomId)
    if (room) {
      room.isPinned = !room.isPinned
      try {
        await fetch(`${API_CHAT}/conversations/${roomId}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.value.userId, isPinned: room.isPinned }),
        })
      } catch (e) {
        console.warn('Pin sync error', e)
      }
    }
  }

  // Tạo nhóm mới và gọi API
  const createGroup = async (name: string, avatar: string, selectedMembers: ChatUser[]) => {
    const fullMembers = [
      { ...currentUser.value, role: 'owner' as GroupRole },
      ...selectedMembers.filter(m => String(m.userId) !== String(currentUser.value.userId)).map(m => ({ ...m, role: 'member' as GroupRole })),
    ]

    if (fullMembers.length < 3) {
      throw new Error('Nhóm chat phải có tối thiểu 3 thành viên!')
    }

    try {
      const res = await fetch(`${API_CHAT}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Nhóm mới',
          avatar: avatar || 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
          members: fullMembers,
          createdBy: currentUser.value,
        }),
      })

      if (res.ok) {
        await fetchConversations()
        return
      }
    } catch (e) {
      console.warn('Backend API error on group creation, updating local state', e)
    }

    const newGroupId = Date.now()
    const newRoom: ChatRoom = {
      id: newGroupId,
      type: 'group',
      name: name.trim() || 'Nhóm mới',
      avatar: avatar || 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
      isGroup: true,
      isPinned: false,
      myRole: 'owner',
      members: fullMembers,
      lastMessage: {
        content: `${currentUser.value.name} đã tạo nhóm mới.`,
        type: 'text',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      unreadCount: 0,
    }

    chatRooms.value.unshift(newRoom)
    activeRoomId.value = newGroupId
    return newRoom
  }

  const addMembersToCurrentGroup = async (newMembers: ChatUser[]) => {
    const room = activeRoom.value
    if (!room || !room.isGroup) return

    try {
      await fetch(`${API_CHAT}/groups/${room.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: newMembers }),
      })
      await fetchConversations()
    } catch (e) {
      console.warn('Error adding members via API', e)
    }

    newMembers.forEach(m => {
      const exists = room.members.some(mem => String(mem.userId) === String(m.userId))
      if (!exists) room.members.push({ ...m, role: 'member' })
    })

    sendMessage(`${currentUser.value.name} đã thêm ${newMembers.map(m => m.name).join(', ')} vào nhóm.`, 'text')
  }

  const changeMemberRole = async (userId: string, newRole: GroupRole) => {
    const room = activeRoom.value
    if (!room || !room.isGroup) return
    if (room.myRole !== 'owner') {
      throw new Error('Chỉ Trưởng nhóm (Owner) mới có quyền đổi vai trò hoặc nhường quyền!')
    }

    try {
      await fetch(`${API_CHAT}/groups/${room.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          newRole,
          requesterUserId: currentUser.value.userId,
        }),
      })
    } catch (e) {
      console.warn('Error changing role via API', e)
    }

    const target = room.members.find(m => String(m.userId) === String(userId))
    if (!target) return

    if (newRole === 'owner') {
      const me = room.members.find(m => String(m.userId) === String(currentUser.value.userId))
      if (me) me.role = 'admin'
      target.role = 'owner'
      room.myRole = 'admin'
      sendMessage(`${currentUser.value.name} đã nhường quyền Trưởng nhóm cho ${target.name}.`, 'text')
    } else {
      target.role = newRole
      const roleText = newRole === 'admin' ? 'Phó nhóm (Admin)' : 'Thành viên (Member)'
      sendMessage(`${currentUser.value.name} đã bổ nhiệm ${target.name} làm ${roleText}.`, 'text')
    }
  }

  const removeMemberFromGroup = async (userId: string) => {
    const room = activeRoom.value
    if (!room || !room.isGroup) return
    if (room.myRole !== 'owner') {
      throw new Error('Chỉ Trưởng nhóm (Owner) mới có quyền xóa thành viên khỏi nhóm!')
    }

    try {
      await fetch(`${API_CHAT}/groups/${room.id}/members/${userId}?requesterUserId=${currentUser.value.userId}`, {
        method: 'DELETE',
      })
    } catch (e) {
      console.warn('Error removing member via API', e)
    }

    const index = room.members.findIndex(m => String(m.userId) === String(userId))
    if (index !== -1) {
      const removedName = room.members[index].name
      room.members.splice(index, 1)
      sendMessage(`${currentUser.value.name} đã xóa ${removedName} khỏi nhóm.`, 'text')
    }
  }

  // Cập nhật người dùng hiện tại khi đăng nhập/đăng xuất
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
    } else {
      currentUser.value = {
        userId: '1',
        name: 'Nguyễn Quản Trị',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
        email: 'admin@datvietso.vn',
        employeeCode: 'DVS-001',
      }
    }

    activeRoomId.value = 0
    chatRooms.value = []
    messagesMap.value = {}

    fetchContacts()
    fetchConversations()

    if (socket && isConnected.value) {
      socket.emit('user_online', currentUser.value.userId)
    }
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
    activeMessages,
    onlineUsers,
    currentTypingUsers,
    typingDisplayText,
    searchKeyword,
    sortedAndFilteredRooms,
    matchingUsersForDirectChat,
    isProfileRightOpen,
    isConnected,
    isUserOnline,
    initSocket,
    setCurrentUser,
    disconnectSocket,
    fetchContacts,
    fetchConversations,
    fetchMessages,
    openDirectChatWithUser,
    selectRoom,
    sendMessage,
    deleteMessage,
    emitTyping,
    emitStopTyping,
    togglePinRoom,
    createGroup,
    addMembersToCurrentGroup,
    changeMemberRole,
    removeMemberFromGroup,
  }
})
