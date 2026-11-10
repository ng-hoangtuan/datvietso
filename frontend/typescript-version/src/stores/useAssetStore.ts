import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type AssetKind = 'PHYSICAL' | 'DIGITAL'

export type AssetStatus =
  | 'AVAILABLE'
  | 'PENDING_ACTIVATION'
  | 'ACTIVE'
  | 'MAINTENANCE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'LIQUIDATED'

export type DigitalType = 'account' | 'license' | 'shared-account' | 'cloud-credential' | 'source-code'

export interface DigitalMetadata {
  provider: string               // Google Workspace, AWS, GitLab, JetBrains, Figma, Microsoft 365, etc.
  digitalType: DigitalType       // 1-1 account, multi-seat license, shared account, etc.
  username?: string              // tuan.nh@company.com
  licenseKey?: string            // Masked format
  recoveryEmail?: string         // admin-it@company.com
  accessRole?: string            // Owner, Admin, Developer, Member, Viewer
  totalSeats?: number            // Dùng cho license nhiều seat
  usedSeats?: number             // Số seat đã cấp phát
  expiresAt?: string             // YYYY-MM-DD
  costMonthly?: number           // VND hoặc USD
  storageUrl?: string            // Kho tài liệu / repo / console link
}

export interface PhysicalMetadata {
  serialNumber?: string
  model?: string
  location?: string              // Văn phòng HN, Tầng 3, Kho IT
  condition?: string             // Mới 100%, Đang hoạt động tốt, Cần bảo dưỡng
}

export interface AssetAllocation {
  id: string
  assetId: string
  employeeName: string
  employeeEmail: string
  department: string
  allocatedAt: string
  revokedAt?: string | null
  status: 'ACTIVE' | 'REVOKED'
  note?: string
}

export interface AssetAuditLog {
  id: string
  assetId: string
  action: 'CREATE' | 'UPDATE' | 'ALLOCATE' | 'REVOKE' | 'STATUS_CHANGE'
  actorName: string
  timestamp: string
  details: string
}

export interface UnifiedAsset {
  id: string
  assetKind: AssetKind
  code: string                   // TS-PHY-001 hoặc TS-DIG-002
  name: string
  category: string               // Thiết bị IT, Phần mềm bản quyền, Dịch vụ đám mây, v.v.
  status: AssetStatus
  manager: string                // Người chịu trách nhiệm quản lý / IT lead
  updatedAt: string
  digitalMeta?: DigitalMetadata
  physicalMeta?: PhysicalMetadata
  allocations?: AssetAllocation[]
  logs?: AssetAuditLog[]
}

const API_BASE = 'http://localhost:5000/api/assets'

export const useAssetStore = defineStore('asset', () => {
  const assets = ref<UnifiedAsset[]>([])
  const isLoading = ref(false)

  // Filters
  const selectedKind = ref<'ALL' | AssetKind>('ALL')
  const selectedProvider = ref<string>('ALL')
  const selectedStatus = ref<string>('ALL')
  const searchQuery = ref('')

  // 1. Fetch assets từ Backend API
  const fetchAssets = async () => {
    isLoading.value = true
    try {
      const res = await fetch(API_BASE)
      if (res.ok) {
        const json = await res.json()
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          assets.value = json.data
          return
        }
      }
    } catch (e) {
      console.warn('[AssetStore] Backend API offline or unreachable, using default data', e)
    } finally {
      isLoading.value = false
    }

    // Fallback dữ liệu mẫu nếu DB trống hoặc lỗi kết nối
    if (assets.value.length === 0) {
      assets.value = [
        {
          id: '1',
          assetKind: 'PHYSICAL',
          code: 'TS-PHY-001',
          name: 'MacBook Pro 16 inch M3 Pro',
          category: 'Laptop',
          status: 'ACTIVE',
          manager: 'Trần Anh Tuấn',
          updatedAt: '2026-11-09',
          physicalMeta: {
            serialNumber: 'C02G9988MD6R',
            model: 'MacBook Pro 16" 2023',
            location: 'Phòng Kỹ Thuật Tầng 3',
            condition: 'Mới 98%',
          },
          allocations: [
            {
              id: 'alloc-1',
              assetId: '1',
              employeeName: 'Trần Anh Tuấn',
              employeeEmail: 'tuan.ta@datvietso.vn',
              department: 'Phòng Kỹ Thuật (Tech Lead)',
              allocatedAt: '2026-01-15',
              status: 'ACTIVE',
              note: 'Cấp phát máy trạm phục vụ dự án Core',
            },
          ],
        },
        {
          id: '2',
          assetKind: 'PHYSICAL',
          code: 'TS-PHY-002',
          name: 'Màn hình Dell UltraSharp U2723QE 4K',
          category: 'Màn hình',
          status: 'ACTIVE',
          manager: 'Lê Thị Mai Hoa',
          updatedAt: '2026-11-09',
          physicalMeta: {
            serialNumber: 'CN-09384-DELL',
            model: 'UltraSharp U2723QE',
            location: 'Phòng Thiết Kế Tầng 2',
            condition: 'Hoạt động tốt',
          },
          allocations: [
            {
              id: 'alloc-2',
              assetId: '2',
              employeeName: 'Lê Thị Mai Hoa',
              employeeEmail: 'hoa.ltm@datvietso.vn',
              department: 'Phòng Thiết Kế',
              allocatedAt: '2026-02-01',
              status: 'ACTIVE',
            },
          ],
        },
        {
          id: '3',
          assetKind: 'DIGITAL',
          code: 'TS-DIG-001',
          name: 'GitHub Enterprise Cloud',
          category: 'Source Code & CI/CD',
          status: 'ACTIVE',
          manager: 'Trần Anh Tuấn',
          updatedAt: '2026-11-09',
          digitalMeta: {
            provider: 'GitHub',
            digitalType: 'license',
            licenseKey: 'GH-ENT-2026-DATVIETSO',
            recoveryEmail: 'devops@datvietso.vn',
            totalSeats: 30,
            usedSeats: 12,
            accessRole: 'Organization Owner',
            expiresAt: '2027-11-09',
            costMonthly: 15000000,
            storageUrl: 'https://github.com/datvietso',
          },
          allocations: [],
        },
        {
          id: '4',
          assetKind: 'DIGITAL',
          code: 'TS-DIG-002',
          name: 'Canva Teams Business Pro',
          category: 'Thiết kế đồ họa',
          status: 'ACTIVE',
          manager: 'Phạm Ngọc Lan',
          updatedAt: '2026-11-09',
          digitalMeta: {
            provider: 'Canva',
            digitalType: 'shared-account',
            username: 'marketing@datvietso.vn',
            recoveryEmail: 'lan.pn@datvietso.vn',
            accessRole: 'Brand Manager',
            expiresAt: '2027-06-30',
            costMonthly: 450000,
          },
          allocations: [],
        },
      ]
    }
  }

  // Tự động gọi fetchAssets khi store khởi tạo
  fetchAssets()

  // Computed: Lọc danh sách
  const filteredAssets = computed(() => {
    return assets.value.filter(item => {
      // 1. Lọc theo Kind
      if (selectedKind.value !== 'ALL' && item.assetKind !== selectedKind.value) {
        return false
      }

      // 2. Lọc theo Provider
      if (selectedProvider.value !== 'ALL') {
        if (item.assetKind !== 'DIGITAL' || item.digitalMeta?.provider !== selectedProvider.value) {
          return false
        }
      }

      // 3. Lọc theo Status
      if (selectedStatus.value !== 'ALL' && item.status !== selectedStatus.value) {
        return false
      }

      // 4. Tìm kiếm từ khóa
      if (searchQuery.value.trim()) {
        const query = searchQuery.value.toLowerCase().trim()
        const matchCode = item.code.toLowerCase().includes(query)
        const matchName = item.name.toLowerCase().includes(query)
        const matchCategory = item.category.toLowerCase().includes(query)
        const matchManager = (item.manager || '').toLowerCase().includes(query)
        const matchProvider = item.digitalMeta?.provider?.toLowerCase().includes(query) || false
        const matchUsername = item.digitalMeta?.username?.toLowerCase().includes(query) || false

        return matchCode || matchName || matchCategory || matchManager || matchProvider || matchUsername
      }

      return true
    })
  })

  // Thống kê nhanh
  const stats = computed(() => {
    const total = assets.value.length
    const physicalCount = assets.value.filter(a => a.assetKind === 'PHYSICAL').length
    const digitalCount = assets.value.filter(a => a.assetKind === 'DIGITAL').length
    const availableCount = assets.value.filter(a => a.status === 'AVAILABLE').length
    const activeCount = assets.value.filter(a => a.status === 'ACTIVE').length
    const warningCount = assets.value.filter(a => ['MAINTENANCE', 'EXPIRED', 'SUSPENDED'].includes(a.status)).length

    return {
      total,
      physicalCount,
      digitalCount,
      availableCount,
      activeCount,
      warningCount,
    }
  })

  // Danh sách các Provider duy nhất hiện có
  const providerOptions = computed(() => {
    const providers = new Set<string>()
    assets.value.forEach(a => {
      if (a.assetKind === 'DIGITAL' && a.digitalMeta?.provider) {
        providers.add(a.digitalMeta.provider)
      }
    })
    return ['ALL', ...Array.from(providers)]
  })

  // Actions CRUD kết nối Backend
  const createAsset = async (newAsset: Omit<UnifiedAsset, 'id' | 'updatedAt'>) => {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAsset),
      })
      if (res.ok) {
        await fetchAssets()
        return
      }
    } catch (e) {
      console.warn('[AssetStore] Failed to create via API, updating local state', e)
    }

    // Local optimistic update
    const id = Date.now().toString()
    const item: UnifiedAsset = {
      ...newAsset,
      id,
      updatedAt: new Date().toISOString().slice(0, 10),
      allocations: [],
    }
    assets.value.unshift(item)
    return item
  }

  const updateAsset = async (id: string, updatedData: Partial<UnifiedAsset>) => {
    try {
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      })
      if (res.ok) {
        await fetchAssets()
        return
      }
    } catch (e) {
      console.warn('[AssetStore] Failed to update via API, updating local state', e)
    }

    const index = assets.value.findIndex(a => a.id === id)
    if (index !== -1) {
      assets.value[index] = {
        ...assets.value[index],
        ...updatedData,
        updatedAt: new Date().toISOString().slice(0, 10),
      }
    }
  }

  const deleteAsset = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await fetchAssets()
        return
      }
    } catch (e) {
      console.warn('[AssetStore] Failed to delete via API, removing from local state', e)
    }
    assets.value = assets.value.filter(a => a.id !== id)
  }

  // Cấp phát tài sản cho nhân sự
  const allocateAsset = async (
    assetId: string,
    allocation: {
      employeeName: string
      employeeEmail: string
      department: string
      note?: string
    }
  ) => {
    try {
      const res = await fetch(`${API_BASE}/${assetId}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allocation),
      })
      if (res.ok) {
        await fetchAssets()
        return true
      }
    } catch (e) {
      console.warn('[AssetStore] Failed to allocate via API, updating local state', e)
    }

    const asset = assets.value.find(a => a.id === assetId)
    if (!asset) return false
    if (!asset.allocations) asset.allocations = []

    const newAlloc: AssetAllocation = {
      id: `alloc-${Date.now()}`,
      assetId,
      employeeName: allocation.employeeName,
      employeeEmail: allocation.employeeEmail,
      department: allocation.department,
      allocatedAt: new Date().toISOString().slice(0, 10),
      status: 'ACTIVE',
      note: allocation.note,
    }
    asset.allocations.push(newAlloc)
    asset.status = 'ACTIVE'
    asset.updatedAt = new Date().toISOString().slice(0, 10)
    return true
  }

  // Thu hồi tài sản
  const revokeAllocation = async (assetId: string, allocationId: string, reason?: string) => {
    try {
      const res = await fetch(`${API_BASE}/${assetId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocationId, reason }),
      })
      if (res.ok) {
        await fetchAssets()
        return true
      }
    } catch (e) {
      console.warn('[AssetStore] Failed to revoke via API, updating local state', e)
    }

    const asset = assets.value.find(a => a.id === assetId)
    if (!asset || !asset.allocations) return false

    const alloc = asset.allocations.find(a => a.id === allocationId)
    if (alloc) {
      alloc.status = 'REVOKED'
      alloc.revokedAt = new Date().toISOString().slice(0, 10)
      if (reason) alloc.note = `${alloc.note ? alloc.note + ' | ' : ''}Thu hồi: ${reason}`
      const remainingActive = asset.allocations.filter(a => a.status === 'ACTIVE').length
      if (remainingActive === 0) asset.status = 'AVAILABLE'
      asset.updatedAt = new Date().toISOString().slice(0, 10)
      return true
    }
    return false
  }

  return {
    assets,
    isLoading,
    selectedKind,
    selectedProvider,
    selectedStatus,
    searchQuery,
    filteredAssets,
    stats,
    providerOptions,
    fetchAssets,
    createAsset,
    updateAsset,
    deleteAsset,
    allocateAsset,
    revokeAllocation,
  }
})
