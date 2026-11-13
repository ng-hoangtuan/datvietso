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
 * (một cổng duy nhất, cần cho ngrok). Phải dùng `??` chứ không phải `||`, vì
 * `||` coi chuỗi rỗng là thiếu giá trị và rơi về localhost:5000.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000'

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
