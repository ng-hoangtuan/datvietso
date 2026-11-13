import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from './useChatStore'
import { API_BASE } from '@/utils/api'

export interface AuthUser {
  id: string
  employee_id?: string | null
  employee_code: string
  username: string
  full_name: string
  email: string
  phone?: string
  avatar: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'HR_MANAGER' | 'DEPT_MANAGER' | 'EMPLOYEE'
  department: string
  position: string
}

export interface DemoAccount {
  id: string
  code: string
  name: string
  role: string
  department: string
  position: string
  defaultPassword: string
}

const API_AUTH = `${API_BASE}/api/auth`

export const useAuthStore = defineStore('auth', () => {
  const router = useRouter()
  const chatStore = useChatStore()

  // Khởi tạo từ LocalStorage nếu có
  const storedUser = localStorage.getItem('dvs_user')
  const storedToken = localStorage.getItem('dvs_token')

  const user = ref<AuthUser | null>(storedUser ? JSON.parse(storedUser) : null)
  const token = ref<string | null>(storedToken || null)
  const isLoading = ref(false)
  const errorMessage = ref('')

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  /**
   * Bản dùng thử cho khách (DEMO_MODE ở backend). Khi bật thì trang đăng nhập
   * giấu hết gợi ý tài khoản mẫu và mật khẩu mặc định — đưa link ra Internet mà
   * vẫn in sẵn mật khẩu lên màn hình thì coi như không khoá gì.
   */
  const isDemoMode = ref(false)

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/config`)
      if (res.ok) {
        const cfg = await res.json()
        isDemoMode.value = !!cfg.demoMode
        if (isDemoMode.value) demoAccounts.value = []
      }
    }
    catch (e) {
      // Không gọi được thì cứ coi như bản nội bộ, giữ nguyên hành vi cũ
    }
  }

  // Danh sách tài khoản mẫu để test nhanh
  const demoAccounts = ref<DemoAccount[]>([
    {
      id: '1',
      code: 'DVS-001',
      name: 'Nguyễn Quản Trị',
      role: 'SUPER_ADMIN',
      department: 'Ban Giám Đốc',
      position: 'Tổng Giám Đốc',
      defaultPassword: '123456',
    },
    {
      id: '2',
      code: 'DVS-002',
      name: 'Trần Anh Tuấn',
      role: 'EMPLOYEE',
      department: 'Khối Kỹ Thuật & Công Nghệ',
      position: 'Kỹ Sư Phần Mềm Cao Cấp',
      defaultPassword: '123456',
    },
    {
      id: '3',
      code: 'DVS-003',
      name: 'Lê Thị Mai Hoa',
      role: 'EMPLOYEE',
      department: 'Phòng Phát Triển Kinh Doanh',
      position: 'Chuyên Viên Kinh Doanh',
      defaultPassword: '123456',
    },
    {
      id: '4',
      code: 'DVS-004',
      name: 'Phạm Ngọc Lan',
      role: 'HR_MANAGER',
      department: 'Phòng Nhân Sự & Hành Chính',
      position: 'Trưởng Phòng Nhân Sự',
      defaultPassword: '123456',
    },
  ])

  // Đồng bộ user vào chatStore khi đã đăng nhập
  const syncWithChatStore = (currentUserData: AuthUser | null) => {
    chatStore.setCurrentUser(currentUserData)
  }

  // Khởi tạo đồng bộ nếu đã có session
  if (user.value) {
    syncWithChatStore(user.value)
  }

  // Đăng nhập bằng employee_code và mật khẩu
  const login = async (employeeCode: string, password: string, remember: boolean = true) => {
    isLoading.value = true
    errorMessage.value = ''

    try {
      const res = await fetch(`${API_AUTH}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: employeeCode.trim(),
          password,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Đăng nhập thất bại!')
      }

      // Lưu trữ session
      token.value = data.token
      user.value = data.user

      if (remember) {
        localStorage.setItem('dvs_token', data.token)
        localStorage.setItem('dvs_user', JSON.stringify(data.user))
      } else {
        sessionStorage.setItem('dvs_token', data.token)
        sessionStorage.setItem('dvs_user', JSON.stringify(data.user))
      }

      // Đồng bộ sang Chat store
      syncWithChatStore(data.user)

      return data.user
    } catch (err: any) {
      errorMessage.value = err.message || 'Lỗi khi đăng nhập'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Đăng xuất
  const logout = () => {
    token.value = null
    user.value = null
    localStorage.removeItem('dvs_token')
    localStorage.removeItem('dvs_user')
    sessionStorage.removeItem('dvs_token')
    sessionStorage.removeItem('dvs_user')
    chatStore.setCurrentUser(null)
    chatStore.disconnectSocket()
    router.push('/login')
  }

  return {
    user,
    token,
    isLoading,
    errorMessage,
    isAuthenticated,
    demoAccounts,
    isDemoMode,
    loadConfig,
    login,
    logout,
  }
})

