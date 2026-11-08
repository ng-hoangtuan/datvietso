<script setup lang="ts">
import { ref } from 'vue'

// Interface kiểu dữ liệu mẫu cho TypeScript
interface Message {
    id: number
    senderId: string
    senderName: string
    avatar?: string
    content: string
    time: string
    isMe: boolean
}

interface ChatRoom {
    id: number
    name: string
    avatar: string
    lastMessage: string
    time: string
    unreadCount: number
    isGroup: boolean
}

// 1. Mock Data thử nghiệm giao diện
const searchKeyword = ref('')
const messageText = ref('')
const activeRoom = ref<ChatRoom>({
    id: 1,
    name: 'Nhóm Dự Án Web Chat',
    avatar: 'https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png',
    lastMessage: 'Tuấn: Giao diện nhìn ngon rồi đó!',
    time: '10:45 AM',
    unreadCount: 2,
    isGroup: true,
})

const chatRooms = ref<ChatRoom[]>([
    {
        id: 1,
        name: 'Nhóm Dự Án Web Chat',
        avatar: 'https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png',
        lastMessage: 'Tuấn: Giao diện nhìn ngon rồi đó!',
        time: '10:45 AM',
        unreadCount: 2,
        isGroup: true,
    },
    {
        id: 2,
        name: 'Trần Thanh Tuyền (Mentor)',
        avatar: 'https://cdn.vuetifyjs.com/images/john.jpg',
        lastMessage: 'Tuấn kiểm tra lại luồng Socket nhé.',
        time: 'Yesterday',
        unreadCount: 0,
        isGroup: false,
    },
])

const messages = ref<Message[]>([
    {
        id: 1,
        senderId: 'user_2',
        senderName: 'Đoàn Hồng Đăng',
        content: 'Alo mọi người, khung giao diện chat cập nhật tới đâu rồi?',
        time: '10:40 AM',
        isMe: false,
    },
    {
        id: 2,
        senderId: 'user_1',
        senderName: 'Nguyễn Hoàng Tuấn',
        content: 'Em đang làm xong khung UI chính rồi anh, chuẩn bị gắn Socket và Pinia vào luôn đây!',
        time: '10:42 AM',
        isMe: true,
    },
    {
        id: 3,
        senderId: 'user_2',
        senderName: 'Đoàn Hồng Đăng',
        content: 'Giao diện nhìn ngon rồi đó! Cố gắng đẩy nhanh nhé.',
        time: '10:45 AM',
        isMe: false,
    },
])

// 2. Hàm giả lập gửi tin nhắn
const handleSendMessage = () => {
    if (!messageText.value.trim()) return

    messages.value.push({
        id: Date.now(),
        senderId: 'user_1',
        senderName: 'Nguyễn Hoàng Tuấn',
        content: messageText.value,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: true,
    })

    messageText.value = ''
}
</script>

<template>
    <VCard class="chat-app-wrapper elevation-2">
        <VRow no-gutters class="fill-height">
            <!-- ==================== CỘT TRÁI: DANH SÁCH PHÒNG CHAT ==================== -->
            <VCol cols="12" md="4" class="chat-sidebar border-e">
                <!-- Header & Ô Tìm Kiếm -->
                <div class="pa-4 border-b">
                    <VTextField v-model="searchKeyword" placeholder="Tìm cuộc trò chuyện..."
                        prepend-inner-icon="bx-search" density="compact" variant="outlined" hide-details clearable />
                </div>

                <!-- Danh sách các Chat Room -->
                <VList lines="two" class="pa-0">
                    <VListItem v-for="room in chatRooms" :key="room.id" :active="activeRoom.id === room.id"
                        active-color="primary" class="py-3 px-4 border-b cursor-pointer" @click="activeRoom = room">
                        <template #prepend>
                            <VAvatar class="mr-3">
                                <VImg :src="room.avatar" alt="avatar" />
                            </VAvatar>
                        </template>

                        <VListItemTitle class="font-weight-bold d-flex justify-space-between align-center">
                            <span>{{ room.name }}</span>
                            <span class="text-caption text-medium-emphasis">{{ room.time }}</span>
                        </VListItemTitle>

                        <VListItemSubtitle class="d-flex justify-space-between align-center mt-1">
                            <span class="text-truncate" style="max-width: 180px;">
                                {{ room.lastMessage }}
                            </span>
                            <VChip v-if="room.unreadCount > 0" color="error" size="x-small" class="font-weight-bold">
                                {{ room.unreadCount }}
                            </VChip>
                        </VListItemSubtitle>
                    </VListItem>
                </VList>
            </VCol>

            <!-- ==================== CỘT PHẢI: KHUNG CHAT CHÍNH ==================== -->
            <VCol cols="12" md="8" class="d-flex flex-column chat-content-area">
                <!-- 1. Header Khung Chat -->
                <div class="pa-4 border-b d-flex align-center justify-space-between bg-surface">
                    <div class="d-flex align-center">
                        <VAvatar class="mr-3">
                            <VImg :src="activeRoom.avatar" />
                        </VAvatar>
                        <div>
                            <h4 class="text-subtitle-1 font-weight-bold mb-0">{{ activeRoom.name }}</h4>
                            <span class="text-caption text-success d-flex align-center">
                                <VIcon icon="bx-circle" size="8" class="mr-1 fill-current" /> Online
                            </span>
                        </div>
                    </div>

                    <!-- Các nút thao tác nhóm/phòng -->
                    <div>
                        <VBtn icon="bx-phone" variant="text" color="default" />
                        <VBtn icon="bx-video" variant="text" color="default" />
                        <VBtn icon="bx-dots-vertical-rounded" variant="text" color="default" />
                    </div>
                </div>

                <!-- 2. Danh Sách Tin Nhắn (Scrollable) -->
                <div class="chat-messages-container flex-grow-1 pa-4 overflow-y-auto">
                    <div v-for="msg in messages" :key="msg.id" class="d-flex flex-column mb-4"
                        :class="msg.isMe ? 'align-end' : 'align-start'">
                        <!-- Tên người gửi (nếu là tin nhắn nhóm) -->
                        <span v-if="!msg.isMe" class="text-caption text-medium-emphasis mb-1 ml-1">
                            {{ msg.senderName }}
                        </span>

                        <!-- Bong bóng tin nhắn (Chat Bubble) -->
                        <div class="message-bubble pa-3 rounded-lg max-w-75"
                            :class="msg.isMe ? 'bg-primary text-white rounded-br-0' : 'bg-grey-lighten-4 text-body-1 rounded-bl-0'">
                            {{ msg.content }}
                        </div>

                        <!-- Thời gian gửi -->
                        <span class="text-caption text-medium-emphasis mt-1 mx-1">
                            {{ msg.time }}
                        </span>
                    </div>
                </div>

                <!-- 3. Ô Nhập & Gửi Tin Nhắn -->
                <div class="pa-4 border-t bg-surface">
                    <VForm @submit.prevent="handleSendMessage" class="d-flex align-center">
                        <VBtn icon="bx-paperclip" variant="text" color="default" class="mr-2" />
                        <VTextField v-model="messageText" placeholder="Nhập tin nhắn..." variant="solo-filled" flat
                            density="compact" hide-details class="mr-2" @keydown.enter.prevent="handleSendMessage" />
                        <VBtn color="primary" icon="bx-paper-plane" type="submit" />
                    </VForm>
                </div>
            </VCol>
        </VRow>
    </VCard>
</template>

<style scoped>
.chat-app-wrapper {
    height: calc(100vh - 140px);
    min-height: 500px;
    overflow: hidden;
}

.chat-sidebar {
    height: 100%;
    overflow-y: auto;
}

.chat-content-area {
    height: 100%;
}

.chat-messages-container {
    background-color: rgba(var(--v-theme-on-surface), 0.02);
}

.message-bubble {
    max-width: 70%;
    word-wrap: break-word;
}
</style>