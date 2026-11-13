<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useAssetStore, type DigitalAsset } from '@/stores/useAssetStore'

/**
 * Modal xem key / mật khẩu (đặc tả mục 5.2).
 *
 * Ba lớp ma sát cố ý, vì đây là thao tác lộ bí mật:
 *   1. Phải bấm xác nhận, có câu cảnh báo lượt xem được ghi log
 *   2. Bản rõ tự ẩn sau 30 giây, đếm ngược hiện ngay trên màn hình
 *   3. Thoát modal là xóa khỏi bộ nhớ, không giữ lại trong state
 */
const props = defineProps<{
  modelValue: boolean
  asset: DigitalAsset | null
  keyId?: string | null
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useAssetStore()

const revealed = ref<string | null>(null)
const loginIdentifier = ref<string | null>(null)
const what = ref('')
const countdown = ref(0)
const loading = ref(false)
const error = ref('')
const copied = ref(false)

let timer: any = null

const clearTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Xóa sạch bản rõ khỏi bộ nhớ component. */
const wipe = () => {
  clearTimer()
  revealed.value = null
  loginIdentifier.value = null
  what.value = ''
  countdown.value = 0
  error.value = ''
  copied.value = false
}

const close = () => {
  wipe()
  emit('update:modelValue', false)
}

const doReveal = async () => {
  if (!props.asset) return

  loading.value = true
  error.value = ''
  try {
    const r = await store.revealSecret(props.asset.id, props.keyId || undefined)
    revealed.value = r.value
    loginIdentifier.value = r.loginIdentifier
    what.value = r.what
    countdown.value = r.hideAfterSeconds

    clearTimer()
    timer = setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0) wipe() // hết giờ -> ẩn, không đóng modal
    }, 1000)
  }
  catch (e: any) {
    error.value = e?.message || 'Không xem được'
  }
  finally {
    loading.value = false
  }
}

const copy = async () => {
  if (!revealed.value) return
  try {
    await navigator.clipboard.writeText(revealed.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch (e) {
    error.value = 'Trình duyệt chặn truy cập clipboard'
  }
}

// Đổi tài sản hoặc đóng modal -> xóa bản rõ đang hiện
watch(() => props.modelValue, v => { if (!v) wipe() })
watch(() => [props.asset?.id, props.keyId], () => wipe())

onUnmounted(wipe)
</script>

<template>
  <v-dialog
    :model-value="props.modelValue"
    max-width="520"
    @update:model-value="close"
  >
    <v-card class="rounded-lg">
      <v-card-title class="d-flex align-center gap-2 px-5 pt-4 pb-2">
        <v-icon icon="ri-lock-unlock-line" color="warning" />
        <span class="text-h6 font-weight-bold">Xem thông tin bảo mật</span>
      </v-card-title>
      <v-divider />

      <v-card-text class="pa-5">
        <div class="text-body-2 font-weight-medium mb-1">
          {{ props.asset?.name }}
        </div>
        <div class="text-caption text-medium-emphasis mb-4">
          {{ props.asset?.provider }}
          <template v-if="props.keyId"> · 1 key trong kho</template>
        </div>

        <!-- Trước khi bấm xem -->
        <template v-if="!revealed">
          <v-alert type="warning" variant="tonal" density="comfortable" class="mb-4">
            <div class="text-body-2">
              Lượt xem này sẽ được <strong>ghi vào nhật ký kiểm toán</strong>
              kèm tên bạn và thời điểm. Chỉ xem khi thực sự cần.
            </div>
          </v-alert>

          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
            {{ error }}
          </v-alert>

          <v-btn
            color="warning"
            variant="flat"
            block
            :loading="loading"
            prepend-icon="ri-eye-line"
            @click="doReveal"
          >
            Tôi hiểu, hiện thông tin
          </v-btn>
        </template>

        <!-- Sau khi giải mã -->
        <template v-else>
          <div v-if="loginIdentifier" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">Tài khoản đăng nhập</div>
            <code class="secret-box d-block">{{ loginIdentifier }}</code>
          </div>

          <div class="text-caption text-medium-emphasis mb-1 text-capitalize">{{ what }}</div>
          <code class="secret-box secret-value d-block mb-3">{{ revealed }}</code>

          <div class="d-flex align-center justify-space-between">
            <v-chip size="small" color="error" variant="tonal" prepend-icon="ri-timer-line">
              Tự ẩn sau {{ countdown }}s
            </v-chip>
            <v-btn
              size="small"
              :color="copied ? 'success' : 'primary'"
              variant="tonal"
              :prepend-icon="copied ? 'ri-check-line' : 'ri-file-copy-line'"
              @click="copy"
            >
              {{ copied ? 'Đã sao chép' : 'Sao chép' }}
            </v-btn>
          </div>

          <v-progress-linear
            :model-value="(countdown / 30) * 100"
            color="error"
            height="3"
            class="mt-3 rounded"
          />
        </template>
      </v-card-text>

      <v-divider />
      <v-card-actions class="px-5 py-3 justify-end">
        <v-btn variant="outlined" color="grey" @click="close">
          Đóng
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.secret-box {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 0.875rem;
  word-break: break-all;
  user-select: all;
}
.secret-value {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.gap-2 { gap: 8px; }
</style>
