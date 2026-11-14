/**
 * Gốc URL của backend, dùng chung cho mọi store và component.
 *
 * Trước đây mỗi file tự khai một hằng số riêng; `useAuthStore` lỡ hard-code
 * `http://localhost:5000` nên chạy backend ở cổng khác là đăng nhập hỏng trong
 * khi phần còn lại vẫn chạy — lỗi chỉ lộ ra lúc deploy.
 *
 * Đặt `VITE_API_URL` trong `.env` của frontend khi backend không nằm ở
 * localhost:5000, ví dụ:
 *   VITE_API_URL=https://api.datvietso.vn
 */
/**
 * Chuỗi rỗng = CÙNG ORIGIN: dùng khi backend phục vụ luôn frontend đã build
 * (một cổng duy nhất, cần cho ngrok).
 *
 * Tự động nhận diện hostname từ trình duyệt (localhost, 192.168.x.x, 10.x.x.x...)
 * để các thiết bị khác trong cùng mạng LAN / VLAN truy cập được backend mà không cần cấu hình thủ công.
 */
const resolveApiBase = (): string => {
  // 1. Ưu tiên VITE_API_URL nếu được cấu hình rõ ràng trong .env
  if (import.meta.env.VITE_API_URL !== undefined) {
    return import.meta.env.VITE_API_URL
  }

  // 2. Nhận diện dynamic hostname từ trình duyệt khi truy cập qua mạng LAN/VLAN
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const proto = window.location.protocol || 'http:'
    const host = window.location.hostname
    return `${proto}//${host}:5000`
  }

  return 'http://192.168.1.184:5000'
}

export const API_BASE = resolveApiBase()

/** Nối đường dẫn vào gốc API. Truyền path bắt đầu bằng '/'. */
export const apiUrl = (path: string) => `${API_BASE}${path}`

/**
 * Gốc để Socket.IO kết nối. Chuỗi rỗng làm socket.io-client bối rối nên khi
 * cùng origin thì đưa thẳng origin của trang.
 */
export const socketUrl = () => API_BASE || window.location.origin

/** Token đăng nhập đang lưu. Dùng cho những API bắt buộc đăng nhập. */
export function authToken(): string {
  try {
    return localStorage.getItem('dvs_token') || sessionStorage.getItem('dvs_token') || ''
  }
  catch (e) {
    return ''
  }
}

/** Header Authorization, rỗng nếu chưa đăng nhập. */
export function authHeader(): Record<string, string> {
  const t = authToken()

  return t ? { Authorization: `Bearer ${t}` } : {}
}
