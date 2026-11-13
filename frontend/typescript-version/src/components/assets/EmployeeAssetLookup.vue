<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  useAssetStore,
  CATEGORY_LABEL, PACKAGING_LABEL,
  ASSIGNMENT_STATUS_COLOR, ASSIGNMENT_STATUS_LABEL,
} from '@/stores/useAssetStore'
import { API_BASE } from '@/utils/api'
import { vnAutocompleteFilter } from '@/utils/vnSearch'

/**
 * Tab 3 — Tra cứu theo nhân sự, và cửa vào quy trình Offboarding (Luồng 4).
 *
 * Một màn hình trả lời: người này đang giữ máy nào, bao nhiêu license, mỗi
 * tháng tốn bao nhiêu tiền bản quyền, và khi nghỉ việc thì phải thu những gì.
 */
const store = useAssetStore()

interface Contact { userId: string; name: string; email?: string; department?: string; employeeCode?: string }

const contacts = ref<Contact[]>([])
const employeeId = ref<string | null>(null)
const error = ref('')

// Offboarding
const offboardOpen = ref(false)
const deviceLicenseAction = ref<'keep' | 'revoke'>('keep')
const rotated = ref(false)
const returnNote = ref('')
const busy = ref(false)
const result = ref<any | null>(null)

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/chat/contacts`)
    if (res.ok) contacts.value = await res.json()
  }
  catch (e) { /* bỏ qua, người dùng vẫn chọn được nếu tải lại */ }
})

watch(employeeId, async id => {
  error.value = ''
  result.value = null
  if (id) await store.fetchByEmployee(id)
})

const view = computed(() => store.employeeView)

const vnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n || 0)} ₫`
const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')

const openOffboard = async () => {
  if (!employeeId.value) return

  error.value = ''
  result.value = null
  const s = await store.fetchOffboardingSummary(employeeId.value)
  if (!s) {
    error.value = store.lastError

    return
  }
  deviceLicenseAction.value = 'keep'
  rotated.value = false
  returnNote.value = ''
  offboardOpen.value = true
}

const doOffboard = async () => {
  if (!employeeId.value) return

  busy.value = true
  error.value = ''
  try {
    result.value = await store.offboardExecute(employeeId.value, {
      deviceLicenseAction: deviceLicenseAction.value,
      sharedAccountsRotated: rotated.value,
      returnConditionNote: returnNote.value || undefined,
    })
    offboardOpen.value = false
    await store.fetchByEmployee(employeeId.value)
  }
  catch (e: any) {
    error.value = e?.message || 'Offboarding không thành công'
  }
  finally {
    busy.value = false
  }
}

const confirmActivation = async (assignmentId: string) => {
  error.value = ''
  try {
    await store.confirmActivation(assignmentId)
    if (employeeId.value) await store.fetchByEmployee(employeeId.value)
  }
  catch (e: any) {
    error.value = e?.message || 'Không xác nhận được'
  }
}

/** Chặn hoàn tất khi còn tài khoản dùng chung chưa đổi mật khẩu (Quy tắc 4). */
const canComplete = computed(() => {
  const o = store.offboarding
  if (!o) return false

  return o.blockingSharedAccounts === 0 || rotated.value
})
</script>

<template>
  <div>
    <div class="d-flex flex-wrap gap-3 mb-4 align-center">
      <v-autocomplete
        v-model="employeeId"
        :items="contacts"
        item-title="name"
        item-value="userId"
        placeholder="Chọn nhân sự để xem toàn cảnh tài sản..."
        prepend-inner-icon="ri-user-search-line"
        :custom-filter="vnAutocompleteFilter"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 380px;"
      >
        <template #item="{ item, props: ip }">
          <v-list-item v-bind="ip" :subtitle="`${item.raw.employeeCode || ''} · ${item.raw.department || ''}`" />
        </template>
      </v-autocomplete>

      <v-spacer />

      <v-btn
        v-if="employeeId && store.canOffboard"
        color="error"
        variant="tonal"
        prepend-icon="ri-logout-circle-line"
        @click="openOffboard"
      >
        Offboarding
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-alert v-if="result" type="success" variant="tonal" class="mb-4">
      <div class="font-weight-bold mb-1">{{ result.message }}</div>
      <div class="text-body-2">
        Thu hồi {{ result.physical }} thiết bị · {{ result.userLicenses }} license theo người
        · {{ result.deviceLicenses }} license trên máy
        <template v-if="result.kept"> · giữ {{ result.kept }} key trên máy cho người kế nhiệm</template>
      </div>
      <div v-if="result.reminder" class="text-body-2 mt-2 font-weight-medium">
        ⚠ {{ result.reminder }}
      </div>
    </v-alert>

    <div v-if="!employeeId" class="text-center py-10 text-medium-emphasis">
      <v-icon icon="ri-user-search-line" size="40" class="mb-2 opacity-50" />
      <div class="text-body-2">Chọn một nhân sự để xem thiết bị và bản quyền họ đang giữ</div>
    </div>

    <template v-else-if="view">
      <!-- Tóm tắt -->
      <v-row class="mb-2">
        <v-col cols="12" md="4">
          <v-card variant="tonal" color="primary" class="pa-4 rounded-lg">
            <div class="text-caption">Nhân sự</div>
            <div class="text-h6 font-weight-bold">{{ view.employee.name }}</div>
            <div class="text-caption">
              {{ view.employee.employeeCode }} · {{ view.employee.department || '—' }}
            </div>
          </v-card>
        </v-col>
        <v-col cols="6" md="4">
          <v-card variant="outlined" class="pa-4 rounded-lg">
            <div class="text-caption text-medium-emphasis">Đang giữ</div>
            <div class="text-h6 font-weight-bold">
              {{ view.devices.length }} thiết bị · {{ view.licenses.length }} license
            </div>
          </v-card>
        </v-col>
        <v-col cols="6" md="4">
          <v-card variant="outlined" class="pa-4 rounded-lg">
            <div class="text-caption text-medium-emphasis">Chi phí bản quyền / tháng</div>
            <div class="text-h6 font-weight-bold text-primary">{{ vnd(view.monthlyLicenseCost) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Thiết bị -->
      <div class="section-title mt-4">
        <v-icon icon="ri-computer-line" size="16" class="mr-1" />
        Thiết bị vật lý ({{ view.devices.length }})
      </div>
      <div v-if="view.devices.length === 0" class="text-caption text-disabled mb-3">
        Không giữ thiết bị nào
      </div>
      <v-card v-for="d in view.devices" :key="d.assignmentId" variant="outlined" class="mb-2 pa-3 rounded-lg">
        <div class="d-flex align-center gap-3 flex-wrap">
          <v-avatar size="34" color="primary" variant="tonal">
            <v-icon icon="ri-macbook-line" size="18" />
          </v-avatar>
          <div class="flex-grow-1" style="min-width: 200px;">
            <div class="d-flex align-center gap-2 flex-wrap">
              <span class="text-body-2 font-weight-bold">{{ d.assetCode }}</span>
              <span class="text-body-2">{{ d.name }}</span>
              <v-chip v-if="d.bundledOemLicense.hasOem" size="x-small" color="success" variant="tonal">
                {{ d.bundledOemLicense.osName }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ CATEGORY_LABEL[d.category] }} · SN {{ d.serialNumber }} · nhận {{ dmy(d.assignedAt) }}
            </div>
            <div v-if="d.handoverConditionNote" class="text-caption text-disabled">
              Bàn giao: {{ d.handoverConditionNote }}
            </div>
          </div>
        </div>
      </v-card>

      <!-- License -->
      <div class="section-title mt-5">
        <v-icon icon="ri-key-2-line" size="16" class="mr-1" />
        Bản quyền &amp; tài khoản ({{ view.licenses.length }})
      </div>
      <div v-if="view.licenses.length === 0" class="text-caption text-disabled mb-3">
        Không giữ bản quyền nào
      </div>
      <v-card v-for="l in view.licenses" :key="l.assignmentId" variant="outlined" class="mb-2 pa-3 rounded-lg">
        <div class="d-flex align-center gap-3 flex-wrap">
          <v-avatar size="34" color="deep-purple" variant="tonal">
            <v-icon :icon="l.bindingTarget === 'device' ? 'ri-computer-line' : 'ri-user-line'" size="18" />
          </v-avatar>
          <div class="flex-grow-1" style="min-width: 200px;">
            <div class="d-flex align-center gap-2 flex-wrap">
              <span class="text-body-2 font-weight-bold">{{ l.name }}</span>
              <v-chip size="x-small" variant="outlined">{{ PACKAGING_LABEL[l.packagingType] }}</v-chip>
              <v-chip size="x-small" :color="ASSIGNMENT_STATUS_COLOR[l.status]" variant="tonal">
                {{ ASSIGNMENT_STATUS_LABEL[l.status] }}
              </v-chip>
              <v-chip v-if="l.holderReleased" size="x-small" color="secondary" variant="tonal">
                Chờ người kế nhiệm
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ l.provider }}
              <template v-if="l.onMachine"> · cài trên <strong>{{ l.onMachine }}</strong></template>
              <template v-if="l.assignedIdentifier"> · {{ l.assignedIdentifier }}</template>
              <template v-if="l.accessScope"> · {{ l.accessScope }}</template>
            </div>
          </div>

          <!-- Nhân sự tự xác nhận kích hoạt (Luồng 2 bước 4) -->
          <v-btn
            v-if="l.status === 'pending_activation' && store.currentUser.id === employeeId"
            size="small" color="warning" variant="flat"
            prepend-icon="ri-check-double-line"
            @click="confirmActivation(l.assignmentId)"
          >
            Xác nhận đã nhận &amp; kích hoạt
          </v-btn>
          <v-chip v-else-if="l.status === 'pending_activation'" size="small" color="warning" variant="tonal">
            Chờ nhân sự kích hoạt
          </v-chip>
        </div>
      </v-card>
    </template>

    <!-- Offboarding -->
    <v-dialog v-model="offboardOpen" max-width="620">
      <v-card v-if="store.offboarding" class="rounded-lg">
        <v-card-title class="px-5 pt-4 pb-2">
          <div class="text-h6 font-weight-bold">Offboarding — {{ store.offboarding.employee.name }}</div>
          <div class="text-caption text-medium-emphasis">
            Thu hồi toàn bộ tài sản đang giữ ({{ store.offboarding.total }} mục)
          </div>
        </v-card-title>
        <v-divider />

        <v-card-text class="pa-5">
          <!-- Nhóm 1 -->
          <div class="section-title">
            Thiết bị hữu hình ({{ store.offboarding.groups.physical.length }})
          </div>
          <div v-if="store.offboarding.groups.physical.length === 0" class="text-caption text-disabled mb-3">
            Không có
          </div>
          <div v-for="r in store.offboarding.groups.physical" :key="r.assignmentId" class="text-body-2 mb-1">
            • {{ r.asset?.code }} — {{ r.asset?.name }}
          </div>

          <v-textarea
            v-if="store.offboarding.groups.physical.length > 0"
            v-model="returnNote"
            label="Tình trạng thiết bị khi nhận lại"
            placeholder="VD: Máy còn tốt, đủ sạc và túi"
            variant="outlined" rows="2" density="compact" hide-details class="mt-2 mb-4"
          />

          <!-- Nhóm 2 -->
          <div class="section-title mt-4">
            Bản quyền gắn trên máy ({{ store.offboarding.groups.deviceLicenses.length }})
          </div>
          <div v-if="store.offboarding.groups.deviceLicenses.length === 0" class="text-caption text-disabled mb-3">
            Không có
          </div>
          <template v-else>
            <div v-for="r in store.offboarding.groups.deviceLicenses" :key="r.assignmentId" class="text-body-2 mb-1">
              • {{ r.asset?.name }}<template v-if="r.machine"> trên {{ r.machine.code }}</template>
            </div>
            <v-radio-group v-model="deviceLicenseAction" density="compact" hide-details class="mt-2 mb-3">
              <v-radio value="keep">
                <template #label>
                  <div>
                    <div class="text-body-2 font-weight-medium">Giữ bản quyền trên máy</div>
                    <div class="text-caption text-medium-emphasis">
                      Máy giao nguyên trạng cho người kế nhiệm, key không trả về kho
                    </div>
                  </div>
                </template>
              </v-radio>
              <v-radio value="revoke">
                <template #label>
                  <div>
                    <div class="text-body-2 font-weight-medium">Format máy, thu key về kho</div>
                    <div class="text-caption text-medium-emphasis">
                      Key quay lại kho và cấp được cho máy khác
                    </div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
          </template>

          <!-- Nhóm 3 -->
          <div class="section-title mt-4">
            Bản quyền theo nhân sự ({{ store.offboarding.groups.userLicenses.length }})
          </div>
          <div v-if="store.offboarding.groups.userLicenses.length === 0" class="text-caption text-disabled mb-2">
            Không có
          </div>
          <div v-for="r in store.offboarding.groups.userLicenses" :key="r.assignmentId" class="text-body-2 mb-1">
            • {{ r.asset?.name }}
          </div>
          <div v-if="store.offboarding.groups.userLicenses.length > 0" class="text-caption text-medium-emphasis mt-1">
            Tất cả sẽ bị thu hồi, seat trả về kho ngay.
          </div>

          <!-- Chặn vì tài khoản dùng chung -->
          <v-alert
            v-if="store.offboarding.blockingSharedAccounts > 0"
            type="error" variant="tonal" class="mt-4"
          >
            <div class="text-body-2 font-weight-bold mb-1">
              Cảnh báo tài khoản dùng chung
            </div>
            <div class="text-body-2 mb-2">
              Nhân sự này đang nắm
              {{ store.offboarding.sharedAccounts.map(s => s.name).join(', ') }}.
              Phải đổi mật khẩu gốc trước khi hoàn tất.
            </div>
            <v-checkbox
              v-model="rotated"
              density="compact"
              hide-details
              label="Tôi xác nhận đã đổi mật khẩu gốc của các tài khoản trên"
            />
          </v-alert>
        </v-card-text>

        <v-divider />
        <v-card-actions class="px-5 py-3 justify-end gap-2">
          <v-btn variant="outlined" color="grey" @click="offboardOpen = false">Hủy</v-btn>
          <v-btn color="error" variant="flat" :loading="busy" :disabled="!canComplete" @click="doOffboard">
            Hoàn tất offboarding
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 0.8125rem;
  font-weight: 700;
  margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  display: flex;
  align-items: center;
}
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
</style>
