import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { API_BASE } from '@/utils/api'

/**
 * Store phân hệ Quản lý Tài sản, theo mô hình 3 thực thể của đặc tả:
 * PhysicalAsset / DigitalAsset / AssetAssignment.
 *
 * Khác mô hình cũ (một bảng `assets` phẳng): thiết bị và bản quyền tách riêng,
 * và mọi thay đổi kho đều đi qua phiếu cấp phát chứ không sửa thẳng vào tài sản.
 * Xem Docs/danh-gia-dac-ta-tai-san-so.md.
 */

export type PhysicalCategory = 'laptop' | 'pc' | 'monitor' | 'mobile_device' | 'peripheral' | 'network'
export type PhysicalCondition = 'new' | 'good' | 'needs_repair' | 'broken' | 'liquidated'
export type PhysicalStatus = 'available' | 'assigned' | 'maintenance' | 'lost' | 'retired'

export type PackagingType =
  | 'cloud_subscription' | 'physical_box_fpp' | 'digital_esd' | 'volume_portal' | 'shared_account'

export type FulfillmentMethod =
  | 'tenant_seat' | 'mak_volume_key' | 'discrete_key_pool' | 'shared_account'

export type BindingTarget = 'user' | 'device'
export type DigitalStatus = 'available' | 'fully_assigned' | 'suspended' | 'expired' | 'archived'

export type AssignmentType = 'physical_handover' | 'digital_user_license' | 'digital_device_license'
export type AssignmentStatus = 'pending_activation' | 'active' | 'suspended' | 'revoked'

export interface PhysicalAsset {
  id: string
  assetCode: string
  serialNumber: string
  name: string
  category: PhysicalCategory
  specs?: string | null
  bundledOemLicense: { hasOem: boolean; osName: string | null; hasStoredKey: boolean }
  condition: PhysicalCondition
  status: PhysicalStatus
  currentHolderId: string | null
  currentHolderName: string | null
  assignedAt?: string | null
  purchaseDate?: string | null
  warrantyExpiry?: string | null
  cost: number
  note?: string | null
  updatedAt?: string
  history?: AssignmentRow[]
}

export interface KeyPoolItem {
  keyId: string
  status: 'available' | 'assigned' | 'burned'
  label: string | null
  assignedToAssignmentId: string | null
}

export interface DigitalAsset {
  id: string
  parentAssetId: string | null
  isContainerOnly: boolean
  name: string
  provider: string
  packagingType: PackagingType
  fulfillmentMethod: FulfillmentMethod
  bindingTarget: BindingTarget
  isKeyReusable: boolean
  totalSeats: number | null
  usedSeats: number
  availableSeats: number | null
  loginIdentifier: string | null
  hasSecret: boolean
  keyPool: KeyPoolItem[]
  keyStats: { available: number; assigned: number; burned: number }
  physicalStorageLocation: string | null
  recoveryEmail: string | null
  has2FA: boolean
  twoFactorNote: string | null
  requiresPasswordRotation: boolean
  cost: number
  currency: 'VND' | 'USD'
  billingCycle: 'monthly' | 'yearly' | 'one_time'
  expiryDate: string | null
  autoRenew: boolean
  daysToExpiry: number | null
  status: DigitalStatus
  ownerId: string
  note?: string | null
  children?: DigitalAsset[]
}

export interface AssignmentRow {
  id: string
  assignmentType: AssignmentType
  employeeId: string
  employeeName: string | null
  employeeEmail?: string | null
  physicalAssetId: string | null
  digitalAssetId: string | null
  digitalAssetName?: string | null
  allocatedKeyId: string | null
  assignedIdentifier: string | null
  accessScope: string | null
  status: AssignmentStatus
  holderReleased: boolean
  assignedAt: string
  activatedAt?: string | null
  handoverConditionNote?: string | null
  revokedAt?: string | null
  revokeReason?: string | null
  returnConditionNote?: string | null
  keyReturnedToPool?: boolean | null
  note?: string | null
}

/** GET /assets/physical/:id — thiết bị kèm toàn bộ lịch sử phiếu. */
export interface PhysicalAssetDetail extends PhysicalAsset {
  history: AssignmentRow[]
}

export interface EmployeeAssetView {
  employee: { id: string; name: string; email: string | null; employeeCode: string | null; department: string | null }
  devices: (PhysicalAsset & { assignmentId: string; handoverConditionNote?: string | null })[]
  licenses: Array<{
    assignmentId: string
    digitalAssetId: string
    name: string
    provider: string
    packagingType: PackagingType
    bindingTarget: BindingTarget
    assignmentType: AssignmentType
    onMachine: string | null
    assignedIdentifier: string | null
    accessScope: string | null
    status: AssignmentStatus
    holderReleased: boolean
    assignedAt: string
    expiryDate: string | null
    currency: string
  }>
  monthlyLicenseCost: number
  total: number
}

export interface OffboardingSummary {
  employee: { id: string; name: string; email: string | null; employeeCode: string | null }
  groups: {
    physical: any[]
    deviceLicenses: any[]
    userLicenses: any[]
  }
  sharedAccounts: Array<{ assignmentId: string; digitalAssetId: string; name: string; requiresPasswordRotation: boolean }>
  blockingSharedAccounts: number
  total: number
  canComplete: boolean
  blockReason: string | null
}

export interface AssetStats {
  physical: { byStatus: Record<string, number>; total: number }
  digital: { byStatus: Record<string, number>; total: number }
  expiringIn30Days: number
  needPasswordRotation: number
  pendingActivation: number
  monthlyLicenseCost: number
}

// --- nhãn tiếng Việt, dùng chung cho mọi component -------------------------

export const CATEGORY_LABEL: Record<PhysicalCategory, string> = {
  laptop: 'Laptop',
  pc: 'Máy bàn',
  monitor: 'Màn hình',
  mobile_device: 'Thiết bị di động',
  peripheral: 'Phụ kiện',
  network: 'Thiết bị mạng',
}

export const PHYSICAL_STATUS_LABEL: Record<PhysicalStatus, string> = {
  available: 'Trong kho',
  assigned: 'Đang sử dụng',
  maintenance: 'Đang bảo trì',
  lost: 'Thất lạc',
  retired: 'Đã thanh lý',
}

export const PHYSICAL_STATUS_COLOR: Record<PhysicalStatus, string> = {
  available: 'success',
  assigned: 'primary',
  maintenance: 'warning',
  lost: 'error',
  retired: 'secondary',
}

export const CONDITION_LABEL: Record<PhysicalCondition, string> = {
  new: 'Mới',
  good: 'Tốt',
  needs_repair: 'Cần sửa',
  broken: 'Hỏng',
  liquidated: 'Đã thanh lý',
}

export const PACKAGING_LABEL: Record<PackagingType, string> = {
  cloud_subscription: 'Thuê bao cloud',
  physical_box_fpp: 'Hộp cứng FPP',
  digital_esd: 'Key điện tử ESD',
  volume_portal: 'MAK doanh nghiệp',
  shared_account: 'Tài khoản dùng chung',
}

export const PACKAGING_COLOR: Record<PackagingType, string> = {
  cloud_subscription: 'info',
  physical_box_fpp: 'deep-purple',
  digital_esd: 'indigo',
  volume_portal: 'teal',
  shared_account: 'orange',
}

export const DIGITAL_STATUS_LABEL: Record<DigitalStatus, string> = {
  available: 'Còn chỗ',
  fully_assigned: 'Hết chỗ',
  suspended: 'Tạm ngưng',
  expired: 'Hết hạn',
  archived: 'Lưu trữ',
}

export const DIGITAL_STATUS_COLOR: Record<DigitalStatus, string> = {
  available: 'success',
  fully_assigned: 'warning',
  suspended: 'secondary',
  expired: 'error',
  archived: 'secondary',
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  pending_activation: 'Chờ kích hoạt',
  active: 'Đang dùng',
  suspended: 'Tạm ngưng',
  revoked: 'Đã thu hồi',
}

export const ASSIGNMENT_STATUS_COLOR: Record<AssignmentStatus, string> = {
  pending_activation: 'warning',
  active: 'success',
  suspended: 'secondary',
  revoked: 'error',
}

const API = `${API_BASE}/api`

export const useAssetStore = defineStore('asset', () => {
  const physicalAssets = ref<PhysicalAsset[]>([])
  const digitalAssets = ref<DigitalAsset[]>([])
  const digitalTree = ref<DigitalAsset[]>([])
  const stats = ref<AssetStats | null>(null)
  const employeeView = ref<EmployeeAssetView | null>(null)
  const offboarding = ref<OffboardingSummary | null>(null)

  const isLoading = ref(false)
  const lastError = ref('')
  const lastSuccess = ref('')

  // Bộ lọc tab 1 / tab 2
  const physicalFilter = ref({ status: 'ALL', category: 'ALL', search: '' })
  const digitalFilter = ref({ status: 'ALL', provider: 'ALL', bindingTarget: 'ALL', search: '' })

  /** Người đang đăng nhập — mọi API đổi dữ liệu đều cần actorId. */
  const currentUser = computed(() => {
    try {
      const raw = localStorage.getItem('dvs_user') || sessionStorage.getItem('dvs_user')
      if (raw) {
        const u = JSON.parse(raw)

        return { id: String(u.id), name: u.full_name || u.name || '', role: u.role || 'EMPLOYEE' }
      }
    }
    catch (e) { /* localStorage có thể bị chặn */ }

    return { id: '', name: '', role: 'EMPLOYEE' }
  })

  /** Chỉ IT mới cấp phát / thu hồi / xem key — server kiểm tra lại điều này. */
  const canManage = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.value.role))
  const canOffboard = computed(() =>
    ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'].includes(currentUser.value.role))

  async function request(url: string, init?: RequestInit) {
    try {
      const res = await fetch(API + url, init)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        lastError.value = (data && data.error) || `Lỗi ${res.status}`

        return null
      }

      return data
    }
    catch (e) {
      lastError.value = 'Không kết nối được tới server'

      return null
    }
  }

  const post = (url: string, body: any) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, actorId: currentUser.value.id }),
  })

  const put = (url: string, body: any) => request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, actorId: currentUser.value.id }),
  })

  const patch = (url: string, body: any) => request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const del = (url: string) =>
    request(`${url}${url.includes('?') ? '&' : '?'}actorId=${currentUser.value.id}`, { method: 'DELETE' })

  // --- Tab 1: thiết bị vật lý ----------------------------------------------

  async function fetchPhysical() {
    isLoading.value = true
    try {
      const q = new URLSearchParams()
      if (physicalFilter.value.status !== 'ALL') q.set('status', physicalFilter.value.status)
      if (physicalFilter.value.category !== 'ALL') q.set('category', physicalFilter.value.category)
      if (physicalFilter.value.search.trim()) q.set('search', physicalFilter.value.search.trim())
      q.set('limit', '200')

      const data = await request(`/assets/physical?${q.toString()}`)
      if (data) physicalAssets.value = data.data
    }
    finally {
      isLoading.value = false
    }
  }

  const fetchPhysicalDetail = (id: string) => request(`/assets/physical/${id}`)

  async function createPhysical(payload: any) {
    const d = await post('/assets/physical', payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = `Đã nhập kho ${d.assetCode}`
    await Promise.all([fetchPhysical(), fetchStats()])

    return d
  }

  async function updatePhysical(id: string, payload: any) {
    const d = await put(`/assets/physical/${id}`, payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã cập nhật thiết bị'
    await fetchPhysical()

    return d
  }

  async function deletePhysical(id: string) {
    const d = await del(`/assets/physical/${id}`)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã xóa thiết bị (lịch sử cấp phát vẫn giữ)'
    await Promise.all([fetchPhysical(), fetchStats()])

    return d
  }

  // --- Tab 2: tài sản số ---------------------------------------------------

  async function fetchDigital() {
    isLoading.value = true
    try {
      const q = new URLSearchParams()
      if (digitalFilter.value.status !== 'ALL') q.set('status', digitalFilter.value.status)
      if (digitalFilter.value.provider !== 'ALL') q.set('provider', digitalFilter.value.provider)
      if (digitalFilter.value.bindingTarget !== 'ALL') q.set('bindingTarget', digitalFilter.value.bindingTarget)
      if (digitalFilter.value.search.trim()) q.set('search', digitalFilter.value.search.trim())

      const data = await request(`/assets/digital?${q.toString()}`)
      if (data) {
        digitalAssets.value = data.data
        digitalTree.value = data.tree
      }
    }
    finally {
      isLoading.value = false
    }
  }

  const fetchDigitalDetail = (id: string) => request(`/assets/digital/${id}`)

  async function createDigital(payload: any) {
    const d = await post('/assets/digital', payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = `Đã nhập kho "${d.name}"`
    await Promise.all([fetchDigital(), fetchStats()])

    return d
  }

  async function updateDigital(id: string, payload: any) {
    const d = await put(`/assets/digital/${id}`, payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã cập nhật tài sản số'
    await fetchDigital()

    return d
  }

  async function addKeys(id: string, keys: string[], labels?: string[]) {
    const d = await post(`/assets/digital/${id}/keys`, { keys, labels })
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = `Đã nhập thêm ${d.added} key vào kho`
    await fetchDigital()

    return d
  }

  async function deleteDigital(id: string) {
    const d = await del(`/assets/digital/${id}`)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã xóa tài sản số'
    await Promise.all([fetchDigital(), fetchStats()])

    return d
  }

  /**
   * Giải mã key / mật khẩu. Mỗi lần gọi đều bị ghi vào nhật ký kiểm toán ở
   * server — nói rõ điều đó trên UI trước khi người dùng bấm.
   */
  async function revealSecret(digitalAssetId: string, keyId?: string) {
    const q = new URLSearchParams({ actorId: currentUser.value.id })
    if (keyId) q.set('keyId', keyId)

    const d = await request(`/assets/digital/${digitalAssetId}/reveal-secret?${q.toString()}`)
    if (!d) throw new Error(lastError.value)

    return d as { value: string; masked: string; loginIdentifier: string | null; what: string; hideAfterSeconds: number; warning: string }
  }

  // --- Phiếu cấp phát ------------------------------------------------------

  const fetchAssignments = (params: Record<string, string> = {}) =>
    request(`/assignments?${new URLSearchParams(params).toString()}`)

  async function handoverBundle(payload: {
    employeeId: string
    physicalAssetId?: string | null
    digitalAssetIds?: string[]
    handoverConditionNote?: string
  }) {
    const d = await post('/assignments/handover-bundle', payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = `Đã cấp phát ${d.total} tài sản`
      + (d.pendingActivation ? `, ${d.pendingActivation} mục chờ nhân sự kích hoạt` : '')
    await refreshAll()

    return d
  }

  async function assignPhysical(payload: any) {
    const d = await post('/assignments/physical', payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã bàn giao thiết bị'
    await refreshAll()

    return d
  }

  async function assignDigital(payload: any) {
    const d = await post('/assignments/digital', payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã cấp bản quyền'
    await refreshAll()

    return d
  }

  async function confirmActivation(assignmentId: string) {
    const d = await patch(`/assignments/${assignmentId}/confirm-activation`, { userId: currentUser.value.id })
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = 'Đã xác nhận kích hoạt'
    await refreshAll()

    return d
  }

  async function revoke(assignmentId: string, payload: {
    revokeReason?: string
    returnConditionNote?: string
    returnToStatus?: string
    returnKeyToPool?: boolean
    condition?: string
  }) {
    const d = await post(`/assignments/${assignmentId}/revoke`, payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = d.keyReturnedToPool === false
      ? 'Đã thu hồi, key giữ nguyên trên máy'
      : 'Đã thu hồi và hoàn về kho'
    await refreshAll()

    return d
  }

  /** Giao máy nguyên trạng cho người khác, giữ key đã cài (Quy tắc 2). */
  async function transferDevice(physicalAssetId: string, newEmployeeId: string, reason?: string) {
    const d = await post('/assignments/transfer-device', { physicalAssetId, newEmployeeId, reason })
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = d.message
    await refreshAll()

    return d
  }

  // --- Tab 3: tra cứu theo nhân sự + offboarding ---------------------------

  async function fetchByEmployee(employeeId: string) {
    isLoading.value = true
    try {
      const d = await request(`/assets/by-employee/${employeeId}`)
      employeeView.value = d

      return d
    }
    finally {
      isLoading.value = false
    }
  }

  async function fetchOffboardingSummary(employeeId: string) {
    const d = await request(`/employees/${employeeId}/offboarding-summary?actorId=${currentUser.value.id}`)
    offboarding.value = d

    return d
  }

  async function offboardExecute(employeeId: string, payload: {
    deviceLicenseAction: 'keep' | 'revoke'
    sharedAccountsRotated?: boolean
    returnConditionNote?: string
    reason?: string
  }) {
    const d = await post(`/employees/${employeeId}/offboard-execute`, payload)
    if (!d) throw new Error(lastError.value)
    lastSuccess.value = d.message
    offboarding.value = null
    await refreshAll()

    return d
  }

  // --- Chung ---------------------------------------------------------------

  async function fetchStats() {
    const d = await request('/assets/stats')
    if (d) stats.value = d
  }

  const fetchAuditLogs = (params: Record<string, string> = {}) =>
    request(`/assets/audit-logs?${new URLSearchParams({ limit: '100', ...params }).toString()}`)

  async function refreshAll() {
    await Promise.all([fetchPhysical(), fetchDigital(), fetchStats()])
  }

  // --- Dẫn xuất ------------------------------------------------------------

  /** Máy đang rảnh, cho drawer cấp phát chọn. */
  const availableDevices = computed(() => physicalAssets.value.filter(p => p.status === 'available'))

  /** Gói còn chỗ và cấp phát trực tiếp được (bỏ tenant cha). */
  const assignableLicenses = computed(() => digitalAssets.value.filter(d =>
    !d.isContainerOnly
    && !['suspended', 'expired', 'archived'].includes(d.status)
    && (d.totalSeats === null || d.usedSeats < d.totalSeats)))

  const providers = computed(() =>
    [...new Set(digitalAssets.value.map(d => d.provider))].sort())

  /** Cảnh báo cần IT xử lý ngay, hiện trên đầu trang. */
  const alerts = computed(() => {
    const out: Array<{ type: string; color: string; icon: string; text: string }> = []

    const rotation = digitalAssets.value.filter(d => d.requiresPasswordRotation)
    if (rotation.length > 0) {
      out.push({
        type: 'rotation',
        color: 'error',
        icon: 'ri-key-2-line',
        text: `${rotation.length} tài khoản dùng chung cần đổi mật khẩu gốc: `
          + rotation.map(d => d.name).join(', '),
      })
    }

    const expiring = digitalAssets.value.filter(d =>
      d.daysToExpiry !== null && d.daysToExpiry >= 0 && d.daysToExpiry <= 30 && d.status !== 'archived')
    if (expiring.length > 0) {
      out.push({
        type: 'expiring',
        color: 'warning',
        icon: 'ri-time-line',
        text: `${expiring.length} bản quyền hết hạn trong 30 ngày: `
          + expiring.map(d => `${d.name} (còn ${d.daysToExpiry} ngày)`).join(', '),
      })
    }

    const expired = digitalAssets.value.filter(d => d.status === 'expired')
    if (expired.length > 0) {
      out.push({
        type: 'expired',
        color: 'error',
        icon: 'ri-close-circle-line',
        text: `${expired.length} bản quyền đã hết hạn: ${expired.map(d => d.name).join(', ')}`,
      })
    }

    return out
  })

  return {
    physicalAssets,
    digitalAssets,
    digitalTree,
    stats,
    employeeView,
    offboarding,
    isLoading,
    lastError,
    lastSuccess,
    physicalFilter,
    digitalFilter,
    currentUser,
    canManage,
    canOffboard,
    availableDevices,
    assignableLicenses,
    providers,
    alerts,
    fetchPhysical,
    fetchPhysicalDetail,
    createPhysical,
    updatePhysical,
    deletePhysical,
    fetchDigital,
    fetchDigitalDetail,
    createDigital,
    updateDigital,
    addKeys,
    deleteDigital,
    revealSecret,
    fetchAssignments,
    handoverBundle,
    assignPhysical,
    assignDigital,
    confirmActivation,
    revoke,
    transferDevice,
    fetchByEmployee,
    fetchOffboardingSummary,
    offboardExecute,
    fetchStats,
    fetchAuditLogs,
    refreshAll,
  }
})
