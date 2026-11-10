<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from 'vuetify'
import { useAuthStore, type DemoAccount } from '@/stores/useAuthStore'

import logo from '@images/logo.svg?raw'
import authV1MaskDark from '@images/pages/auth-v1-mask-dark.png'
import authV1MaskLight from '@images/pages/auth-v1-mask-light.png'
import authV1Tree2 from '@images/pages/auth-v1-tree-2.png'
import authV1Tree from '@images/pages/auth-v1-tree.png'

const router = useRouter()
const authStore = useAuthStore()
const vuetifyTheme = useTheme()

const form = ref({
  employee_code: 'DVS-001',
  password: '123456',
  remember: true,
})

const isPasswordVisible = ref(false)
const localError = ref('')

const authThemeMask = computed(() => {
  return vuetifyTheme.global.name.value === 'light'
    ? authV1MaskLight
    : authV1MaskDark
})

// Auto-fill tài khoản mẫu khi click vào chip
const selectDemoAccount = (acc: DemoAccount) => {
  form.value.employee_code = acc.code
  form.value.password = acc.defaultPassword
  localError.value = ''
  authStore.errorMessage = ''
}

// Xử lý Đăng nhập
const handleLogin = async () => {
  localError.value = ''

  if (!form.value.employee_code.trim()) {
    localError.value = 'Vui lòng nhập Mã nhân sự!'
    return
  }

  if (!form.value.password) {
    localError.value = 'Vui lòng nhập Mật khẩu!'
    return
  }

  try {
    await authStore.login(form.value.employee_code, form.value.password, form.value.remember)
    // Đăng nhập thành công -> Chuyển về Dashboard
    router.push('/dashboard')
  } catch (err: any) {
    localError.value = err.message || 'Đăng nhập không thành công'
  }
}
</script>

<template>
  <div class="auth-wrapper d-flex align-center justify-center pa-4">
    <VCard class="auth-card pa-4 pt-6" max-width="460">
      <!-- Logo thương hiệu -->
      <VCardItem class="justify-center pb-2">
        <RouterLink to="/" class="d-flex align-center gap-3">
          <div class="d-flex" v-html="logo" />
          <h2 class="font-weight-bold text-h5 text-uppercase text-primary mb-0">
            DatVietSo
          </h2>
        </RouterLink>
      </VCardItem>

      <VCardText class="pt-2 text-center">
        <h4 class="text-h5 font-weight-bold mb-1">
          Đăng nhập Hệ thống 👋🏻
        </h4>
        <p class="text-caption text-medium-emphasis mb-0">
          Cổng thông tin nội bộ Công ty Cổ phần Đất Việt Số
        </p>
      </VCardText>

      <!-- Alert thông báo lỗi -->
      <div v-if="localError || authStore.errorMessage" class="px-6 pb-2">
        <VAlert
          type="error"
          variant="tonal"
          density="compact"
          closable
          @click:close="localError = ''; authStore.errorMessage = ''"
        >
          {{ localError || authStore.errorMessage }}
        </VAlert>
      </div>

      <VCardText>
        <VForm @submit.prevent="handleLogin">
          <VRow>
            <!-- Mã nhân sự (employee_code) -->
            <VCol cols="12">
              <VTextField
                v-model="form.employee_code"
                label="Mã nhân sự (Employee Code) *"
                placeholder="VD: DVS-001, DVS-002"
                prepend-inner-icon="ri-user-badge-line"
                variant="outlined"
                density="comfortable"
                autofocus
                :rules="[(v: string) => !!v || 'Vui lòng nhập mã nhân sự']"
              />
            </VCol>

            <!-- Mật khẩu (Password) -->
            <VCol cols="12">
              <VTextField
                v-model="form.password"
                label="Mật khẩu *"
                placeholder="123456"
                prepend-inner-icon="ri-lock-password-line"
                variant="outlined"
                density="comfortable"
                :type="isPasswordVisible ? 'text' : 'password'"
                autocomplete="current-password"
                :append-inner-icon="isPasswordVisible ? 'ri-eye-off-line' : 'ri-eye-line'"
                @click:append-inner="isPasswordVisible = !isPasswordVisible"
                :rules="[(v: string) => !!v || 'Vui lòng nhập mật khẩu']"
              />

              <!-- Ghi nhớ & Quên mật khẩu -->
              <div class="d-flex align-center justify-space-between flex-wrap my-2">
                <VCheckbox
                  v-model="form.remember"
                  label="Ghi nhớ đăng nhập"
                  density="compact"
                  hide-details
                />

                <a
                  class="text-primary text-caption font-weight-medium"
                  href="javascript:void(0)"
                >
                  Mật khẩu mặc định: 123456
                </a>
              </div>

              <!-- Nút Đăng nhập -->
              <VBtn
                block
                type="submit"
                color="primary"
                size="large"
                class="mt-3 font-weight-bold"
                :loading="authStore.isLoading"
              >
                <VIcon icon="ri-login-box-line" class="mr-2" />
                Đăng nhập
              </VBtn>
            </VCol>

            <!-- Gợi ý tài khoản demo bấm chọn nhanh -->
            <VCol cols="12" class="pt-4">
              <div class="text-caption font-weight-bold text-medium-emphasis mb-2 text-center">
                CHỌN TÀI KHOẢN MẪU ĐỂ ĐĂNG NHẬP NHANH (Pass: 123456)
              </div>
              <div class="d-flex flex-wrap gap-2 justify-center">
                <VChip
                  v-for="acc in authStore.demoAccounts"
                  :key="acc.code"
                  size="small"
                  :color="form.employee_code === acc.code ? 'primary' : 'default'"
                  :variant="form.employee_code === acc.code ? 'flat' : 'outlined'"
                  class="cursor-pointer font-weight-medium"
                  @click="selectDemoAccount(acc)"
                >
                  <VIcon icon="ri-user-line" size="14" class="mr-1" />
                  {{ acc.code }} ({{ acc.name.split(' ').slice(-1)[0] }})
                </VChip>
              </div>
            </VCol>
          </VRow>
        </VForm>
      </VCardText>
    </VCard>

    <VImg
      class="auth-footer-start-tree d-none d-md-block"
      :src="authV1Tree"
      :width="250"
    />

    <VImg
      :src="authV1Tree2"
      class="auth-footer-end-tree d-none d-md-block"
      :width="350"
    />

    <!-- bg img -->
    <VImg
      class="auth-footer-mask d-none d-md-block"
      :src="authThemeMask"
    />
  </div>
</template>

<style lang="scss">
@use "@core/scss/template/pages/page-auth";
.gap-2 {
  gap: 8px;
}
.cursor-pointer {
  cursor: pointer;
}
</style>
