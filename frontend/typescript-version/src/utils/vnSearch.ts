/**
 * Tìm kiếm tiếng Việt không phân biệt dấu.
 *
 * Người dùng gõ nhanh thường bỏ dấu: "tuan" phải ra "Trần Anh Tuấn", "hoa" phải
 * ra "Lê Thị Mai Hoa". So chuỗi thẳng bằng `includes()` thì không ra gì cả, và
 * người dùng tưởng hệ thống không có dữ liệu.
 */

/**
 * Bỏ dấu và hạ chữ thường.
 *
 * NFD tách dấu thanh thành ký tự tổ hợp (U+0300–U+036F) để xóa đi, nhưng
 * KHÔNG tách được "đ" — nó là một ký tự riêng, không phải "d" + dấu. Vì vậy
 * phải thay "đ"/"Đ" bằng tay, nếu không "Đất Việt Số" tìm bằng "dat" sẽ trượt.
 */
export function deaccent(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

/** true nếu `haystack` chứa `needle`, bỏ qua dấu và hoa thường. */
export function vnIncludes(haystack: unknown, needle: unknown): boolean {
  const q = deaccent(needle)
  if (!q) return true

  return deaccent(haystack).includes(q)
}

/**
 * Bộ lọc cho `v-autocomplete` / `v-select` của Vuetify.
 *
 * Chữ ký Vuetify 3: (value, query, item) => boolean. Tìm trên cả `value` lẫn
 * vài trường hay dùng của item (mã nhân sự, email, phòng ban, mã tài sản...),
 * để gõ "DVS-002" hay "tuan.tech@" cũng ra đúng người.
 */
export function vnAutocompleteFilter(value: string, query: string, item?: any): boolean {
  if (vnIncludes(value, query)) return true

  const raw = item?.raw ?? item
  if (!raw || typeof raw !== 'object') return false

  const FIELDS = ['name', 'employeeCode', 'email', 'department', 'position', 'assetCode', 'serialNumber']

  return FIELDS.some(f => f in raw && vnIncludes(raw[f], query))
}
