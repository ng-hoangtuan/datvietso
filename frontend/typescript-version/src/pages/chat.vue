<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useChatStore } from '@/stores/useChatStore'
import ChatSidebar from '@/components/chat/ChatSidebar.vue'
import ChatLog from '@/components/chat/ChatLog.vue'
import ChatUserProfileRight from '@/components/chat/ChatUserProfileRight.vue'
import ChatGroupModal from '@/components/chat/ChatGroupModal.vue'

const store = useChatStore()
const isGroupModalOpen = ref(false)

// Khởi tạo kết nối Socket khi mount trang Chat
onMounted(() => {
  store.initSocket()
})
</script>

<template>
  <v-card class="chat-app-wrapper elevation-2 rounded-lg border overflow-hidden">
    <div class="d-flex fill-height position-relative">
      <!-- 1. CỘT TRÁI: SIDEBAR CUỘC TRÒ CHUYỆN -->
      <div class="chat-sidebar-container">
        <ChatSidebar @open-create-group="isGroupModalOpen = true" />
      </div>

      <!-- 2. KHUNG CHAT CHÍNH (CHAT LOG & INPUT) -->
      <div class="chat-content-container flex-grow-1 d-flex flex-column">
        <ChatLog />
      </div>

      <!-- 3. PANEL BÊN PHẢI: QUẢN LÝ THÔNG TIN NHÓM / PROFILE (Menu 3 dots) -->
      <v-slide-x-reverse-transition>
        <div v-if="store.isProfileRightOpen" class="chat-profile-right-container">
          <ChatUserProfileRight />
        </div>
      </v-slide-x-reverse-transition>
    </div>

    <!-- MODAL KHỞI TẠO NHÓM CHAT (RÀNG BUỘC TỐI THIỂU 3 THÀNH VIÊN) -->
    <ChatGroupModal v-model="isGroupModalOpen" />
  </v-card>
</template>

<style scoped>
.chat-app-wrapper {
  height: calc(100vh - 175px);
  max-height: calc(100vh - 175px);
  min-height: 480px;
  background-color: rgb(var(--v-theme-surface));
}

.chat-sidebar-container {
  width: 330px;
  min-width: 280px;
  max-width: 360px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.chat-content-container {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.chat-profile-right-container {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  z-index: 10;
}
</style>
