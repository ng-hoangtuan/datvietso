<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import avatar1 from '@images/avatars/avatar-1.png'

const authStore = useAuthStore()

const userAvatar = computed(() => {
  return authStore.user?.avatar || avatar1
})

const userName = computed(() => {
  return authStore.user?.full_name || 'Khách (Chưa đăng nhập)'
})

const userRoleTitle = computed(() => {
  if (!authStore.user) return 'Chưa đăng nhập'
  return `${authStore.user.employee_code} • ${authStore.user.position || authStore.user.role}`
})
</script>

<template>
  <VBadge
    dot
    location="bottom right"
    offset-x="3"
    offset-y="3"
    :color="authStore.isAuthenticated ? 'success' : 'grey'"
    bordered
  >
    <VAvatar
      class="cursor-pointer"
      color="primary"
      variant="tonal"
    >
      <VImg :src="userAvatar" />

      <!-- SECTION Menu -->
      <VMenu
        activator="parent"
        width="260"
        location="bottom end"
        offset="14px"
      >
        <VList>
          <!-- 👉 User Avatar & Name -->
          <VListItem>
            <template #prepend>
              <VListItemAction start>
                <VBadge
                  dot
                  location="bottom right"
                  offset-x="3"
                  offset-y="3"
                  color="success"
                >
                  <VAvatar
                    color="primary"
                    variant="tonal"
                  >
                    <VImg :src="userAvatar" />
                  </VAvatar>
                </VBadge>
              </VListItemAction>
            </template>

            <VListItemTitle class="font-weight-semibold">
              {{ userName }}
            </VListItemTitle>
            <VListItemSubtitle class="text-caption text-medium-emphasis">
              {{ userRoleTitle }}
            </VListItemSubtitle>
          </VListItem>
          <VDivider class="my-2" />

          <!-- 👉 Profile / Thông tin cá nhân -->
          <VListItem link to="/account-settings">
            <template #prepend>
              <VIcon
                class="me-2"
                icon="ri-user-line"
                size="22"
              />
            </template>
            <VListItemTitle>Hồ sơ cá nhân</VListItemTitle>
          </VListItem>

          <!-- 👉 Chat -->
          <VListItem link to="/chat">
            <template #prepend>
              <VIcon
                class="me-2"
                icon="ri-wechat-line"
                size="22"
              />
            </template>
            <VListItemTitle>Tin nhắn nội bộ</VListItemTitle>
          </VListItem>

          <!-- 👉 Quản lý tài sản -->
          <VListItem link to="/assets">
            <template #prepend>
              <VIcon
                class="me-2"
                icon="ri-archive-line"
                size="22"
              />
            </template>
            <VListItemTitle>Tài sản được cấp</VListItemTitle>
          </VListItem>

          <!-- Divider -->
          <VDivider class="my-2" />

          <!-- 👉 Đăng xuất -->
          <VListItem class="cursor-pointer text-error" @click="authStore.logout">
            <template #prepend>
              <VIcon
                class="me-2 text-error"
                icon="ri-logout-box-r-line"
                size="22"
              />
            </template>

            <VListItemTitle class="font-weight-medium">Đăng xuất</VListItemTitle>
          </VListItem>
        </VList>
      </VMenu>
      <!-- !SECTION -->
    </VAvatar>
  </VBadge>
</template>
