<script setup lang="ts">
import { computed } from 'vue'
import {
    useAssetStore,
    type UnifiedAsset,
    type AssetKind,
    type AssetStatus,
} from '@/stores/useAssetStore'

// Emits
const emit = defineEmits<{
    (e: 'view', item: UnifiedAsset): void
    (e: 'edit', item: UnifiedAsset): void
    (e: 'delete', item: UnifiedAsset): void
    (e: 'allocate', item: UnifiedAsset): void
    (e: 'revoke', item: UnifiedAsset): void
    (e: 'create'): void
}>()

const store = useAssetStore()

// Cấu hình cột Vuetify Data Table
const headers = [
    { title: 'Mã & Loại tài sản', key: 'code', sortable: true },
    { title: 'Tên tài sản / Chi tiết', key: 'name', sortable: true },
    { title: 'Danh mục', key: 'category', sortable: true },
    { title: 'Cấp phát hiện tại', key: 'allocations', sortable: false },
    { title: 'Trạng thái', key: 'status', sortable: true },
    { title: 'Cập nhật', key: 'updatedAt', sortable: true },
    { title: 'Thao tác', key: 'actions', sortable: false, align: 'center' as const },
] as const

// Status Options cho filter
const statusFilterOptions = [
    { title: 'Tất cả trạng thái', value: 'ALL' },
    { title: 'Sẵn sàng (Available)', value: 'AVAILABLE' },
    { title: 'Đang sử dụng (Active)', value: 'ACTIVE' },
    { title: 'Đang bảo trì', value: 'MAINTENANCE' },
    { title: 'Chờ kích hoạt', value: 'PENDING_ACTIVATION' },
    { title: 'Hết hạn bản quyền', value: 'EXPIRED' },
    { title: 'Tạm khóa (Suspended)', value: 'SUSPENDED' },
    { title: 'Đã thanh lý', value: 'LIQUIDATED' },
]

// Helper định dạng màu sắc trạng thái
const getStatusColor = (status: AssetStatus) => {
    switch (status) {
        case 'ACTIVE': return 'success'
        case 'AVAILABLE': return 'info'
        case 'PENDING_ACTIVATION': return 'primary'
        case 'MAINTENANCE': return 'warning'
        case 'EXPIRED':
        case 'LIQUIDATED': return 'error'
        case 'SUSPENDED':
        case 'REVOKED': return 'secondary'
        default: return 'grey'
    }
}

const getStatusText = (status: AssetStatus) => {
    switch (status) {
        case 'ACTIVE': return 'Đang sử dụng'
        case 'AVAILABLE': return 'Sẵn sàng cấp phát'
        case 'PENDING_ACTIVATION': return 'Chờ kích hoạt'
        case 'MAINTENANCE': return 'Đang bảo trì'
        case 'EXPIRED': return 'Hết hạn bản quyền'
        case 'SUSPENDED': return 'Tạm khóa'
        case 'REVOKED': return 'Đã thu hồi'
        case 'LIQUIDATED': return 'Đã thanh lý'
        default: return status
    }
}

// Helper lấy Provider Icon / Logo color
const getProviderColor = (provider?: string) => {
    if (!provider) return 'primary'
    const p = provider.toLowerCase()
    if (p.includes('google')) return 'error'
    if (p.includes('aws')) return 'warning'
    if (p.includes('jetbrains')) return 'info'
    if (p.includes('gitlab')) return 'warning'
    if (p.includes('figma')) return 'purple'
    return 'primary'
}

// Active allocations của asset
const getActiveAllocations = (item: UnifiedAsset) => {
    return item.allocations?.filter(a => a.status === 'ACTIVE') || []
}
</script>

<template>
    <div class="asset-management-container">
        <!-- 1. Stats Overview Cards -->
        <v-row class="mb-4">
            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4 rounded-lg elevation-1 stat-card" border>
                    <div class="d-flex align-center justify-space-between">
                        <div>
                            <div class="text-caption text-medium-emphasis font-weight-medium">Tổng tài sản</div>
                            <div class="text-h5 font-weight-bold mt-1">{{ store.stats.total }}</div>
                        </div>
                        <v-avatar color="primary" variant="tonal" rounded size="42">
                            <v-icon icon="ri-archive-line" size="22" />
                        </v-avatar>
                    </div>
                    <div class="d-flex gap-2 mt-2 text-caption">
                        <span class="text-success font-weight-medium">
                            <v-icon icon="ri-computer-line" size="14" class="mr-1" />{{ store.stats.physicalCount }}
                            Phần cứng
                        </span>
                        <span class="text-medium-emphasis">•</span>
                        <span class="text-info font-weight-medium">
                            <v-icon icon="ri-cloud-line" size="14" class="mr-1" />{{ store.stats.digitalCount }} Tài
                            nguyên số
                        </span>
                    </div>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4 rounded-lg elevation-1 stat-card" border>
                    <div class="d-flex align-center justify-space-between">
                        <div>
                            <div class="text-caption text-medium-emphasis font-weight-medium">Đang cấp phát sử dụng
                            </div>
                            <div class="text-h5 font-weight-bold mt-1 text-success">{{ store.stats.activeCount }}</div>
                        </div>
                        <v-avatar color="success" variant="tonal" rounded size="42">
                            <v-icon icon="ri-user-shared-line" size="22" />
                        </v-avatar>
                    </div>
                    <div class="text-caption text-medium-emphasis mt-2">Đang liên kết với nhân sự</div>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4 rounded-lg elevation-1 stat-card" border>
                    <div class="d-flex align-center justify-space-between">
                        <div>
                            <div class="text-caption text-medium-emphasis font-weight-medium">Sẵn sàng cấp phát</div>
                            <div class="text-h5 font-weight-bold mt-1 text-info">{{ store.stats.availableCount }}</div>
                        </div>
                        <v-avatar color="info" variant="tonal" rounded size="42">
                            <v-icon icon="ri-checkbox-circle-line" size="22" />
                        </v-avatar>
                    </div>
                    <div class="text-caption text-medium-emphasis mt-2">Có thể bàn giao ngay</div>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4 rounded-lg elevation-1 stat-card" border>
                    <div class="d-flex align-center justify-space-between">
                        <div>
                            <div class="text-caption text-medium-emphasis font-weight-medium">Cần chú ý / Hết hạn</div>
                            <div class="text-h5 font-weight-bold mt-1 text-warning">{{ store.stats.warningCount }}</div>
                        </div>
                        <v-avatar color="warning" variant="tonal" rounded size="42">
                            <v-icon icon="ri-alert-line" size="22" />
                        </v-avatar>
                    </div>
                    <div class="text-caption text-medium-emphasis mt-2">Bảo trì / Hết hạn bản quyền</div>
                </v-card>
            </v-col>
        </v-row>

        <!-- 2. Main Data Card -->
        <v-card class="elevation-1 rounded-lg" border>
            <!-- Filter Tabs theo Asset Kind -->
            <v-tabs v-model="store.selectedKind" color="primary" class="border-b px-4">
                <v-tab value="ALL" class="text-none">
                    <v-icon icon="ri-apps-line" class="mr-2" size="18" />
                    Tất cả tài sản ({{ store.stats.total }})
                </v-tab>
                <v-tab value="PHYSICAL" class="text-none">
                    <v-icon icon="ri-computer-line" class="mr-2" size="18" />
                    Thiết bị phần cứng ({{ store.stats.physicalCount }})
                </v-tab>
                <v-tab value="DIGITAL" class="text-none">
                    <v-icon icon="ri-cloud-line" class="mr-2" size="18" />
                    Tài nguyên số & Bản quyền ({{ store.stats.digitalCount }})
                </v-tab>
            </v-tabs>

            <!-- Thanh công cụ & Bộ lọc -->
            <v-card-text class="pa-4">
                <v-row class="align-center" dense>
                    <!-- Tìm kiếm từ khóa -->
                    <v-col cols="12" md="4">
                        <v-text-field v-model="store.searchQuery"
                            placeholder="Tìm kiếm theo mã, tên, provider, username, quản lý..."
                            prepend-inner-icon="ri-search-line" density="compact" variant="outlined" hide-details
                            clearable />
                    </v-col>

                    <!-- Lọc theo Provider (nếu xem Digital hoặc Tất cả) -->
                    <v-col cols="12" sm="6" md="3" v-if="store.selectedKind !== 'PHYSICAL'">
                        <v-select v-model="store.selectedProvider" :items="store.providerOptions"
                            label="Nhà cung cấp (Provider)" density="compact" variant="outlined" hide-details
                            prepend-inner-icon="ri-global-line">
                            <template #item="{ item, props: itemProps }">
                                <v-list-item v-bind="itemProps"
                                    :title="item.raw === 'ALL' ? 'Tất cả Provider' : item.raw" />
                            </template>
                            <template #selection="{ item }">
                                <span>{{ item.raw === 'ALL' ? 'Tất cả Provider' : item.raw }}</span>
                            </template>
                        </v-select>
                    </v-col>

                    <!-- Lọc theo Trạng thái -->
                    <v-col cols="12" sm="6" md="3">
                        <v-select v-model="store.selectedStatus" :items="statusFilterOptions" item-title="title"
                            item-value="value" label="Trạng thái" density="compact" variant="outlined" hide-details
                            prepend-inner-icon="ri-filter-3-line" />
                    </v-col>

                    <v-spacer />

                    <!-- Nút Thêm tài sản mới -->
                    <v-col cols="12" sm="auto" class="text-right">
                        <v-btn color="primary" prepend-icon="ri-add-line" @click="emit('create')">
                            Thêm tài sản
                        </v-btn>
                    </v-col>
                </v-row>
            </v-card-text>

            <v-divider />

            <!-- Bảng dữ liệu chính -->
            <v-data-table :headers="headers as any" :items="store.filteredAssets" class="text-no-wrap" hover
                density="comfortable">
                <!-- Cột 1: Mã & Loại tài sản -->
                <template #[`item.code`]="{ item }">
                    <div class="d-flex align-center gap-2 py-2">
                        <v-tooltip
                            :text="item.assetKind === 'DIGITAL' ? 'Tài nguyên số (Digital)' : 'Thiết bị vật lý (Physical)'"
                            location="top">
                            <template #activator="{ props: tipProps }">
                                <v-chip v-bind="tipProps" size="small"
                                    :color="item.assetKind === 'DIGITAL' ? 'info' : 'primary'" variant="tonal"
                                    class="font-weight-medium">
                                    <v-icon :icon="item.assetKind === 'DIGITAL' ? 'ri-cloud-line' : 'ri-computer-line'"
                                        size="14" class="mr-1" />
                                    {{ item.assetKind === 'DIGITAL' ? 'DIGITAL' : 'PHYSICAL' }}
                                </v-chip>
                            </template>
                        </v-tooltip>
                        <span class="font-weight-bold text-body-2">{{ item.code }}</span>
                    </div>
                </template>

                <!-- Cột 2: Tên & Thông tin phụ -->
                <template #[`item.name`]="{ item }">
                    <div class="py-2">
                        <div class="font-weight-medium text-body-1 text-high-emphasis">
                            {{ item.name }}
                        </div>

                        <!-- Thuộc tính bổ trợ nếu là Digital -->
                        <div v-if="item.assetKind === 'DIGITAL' && item.digitalMeta"
                            class="d-flex flex-wrap align-center gap-2 mt-1 text-caption text-medium-emphasis">
                            <v-chip size="x-small" :color="getProviderColor(item.digitalMeta.provider)" variant="flat"
                                class="text-white">
                                {{ item.digitalMeta.provider }}
                            </v-chip>

                            <span v-if="item.digitalMeta.username" class="d-inline-flex align-center">
                                <v-icon icon="ri-user-line" size="12" class="mr-1" />
                                {{ item.digitalMeta.username }}
                            </span>

                            <span v-if="item.digitalMeta.totalSeats"
                                class="d-inline-flex align-center font-weight-medium text-info">
                                <v-icon icon="ri-group-line" size="12" class="mr-1" />
                                {{ item.digitalMeta.usedSeats || 0 }}/{{ item.digitalMeta.totalSeats }} Seats
                            </span>

                            <span v-if="item.digitalMeta.expiresAt" class="d-inline-flex align-center"
                                :class="item.status === 'EXPIRED' ? 'text-error font-weight-bold' : ''">
                                <v-icon icon="ri-calendar-event-line" size="12" class="mr-1" />
                                HSD: {{ item.digitalMeta.expiresAt }}
                            </span>
                        </div>

                        <!-- Thuộc tính bổ trợ nếu là Physical -->
                        <div v-else-if="item.physicalMeta"
                            class="d-flex flex-wrap align-center gap-2 mt-1 text-caption text-medium-emphasis">
                            <span v-if="item.physicalMeta.serialNumber">
                                S/N: <strong>{{ item.physicalMeta.serialNumber }}</strong>
                            </span>
                            <span v-if="item.physicalMeta.location" class="d-inline-flex align-center">
                                <v-icon icon="ri-map-pin-line" size="12" class="mr-1" />
                                {{ item.physicalMeta.location }}
                            </span>
                        </div>
                    </div>
                </template>

                <!-- Cột 3: Danh mục -->
                <template #[`item.category`]="{ item }">
                    <span class="text-body-2">{{ item.category }}</span>
                </template>

                <!-- Cột 4: Nhân sự cấp phát -->
                <template #[`item.allocations`]="{ item }">
                    <div class="py-1">
                        <template v-if="getActiveAllocations(item).length > 0">
                            <div v-if="getActiveAllocations(item).length === 1" class="d-flex align-center gap-1">
                                <v-avatar color="primary" variant="tonal" size="26">
                                    <span class="text-caption font-weight-bold">
                                        {{ getActiveAllocations(item)[0].employeeName.charAt(0) }}
                                    </span>
                                </v-avatar>
                                <div>
                                    <div class="text-body-2 font-weight-medium line-clamp-1">
                                        {{ getActiveAllocations(item)[0].employeeName }}
                                    </div>
                                    <div class="text-caption text-medium-emphasis">
                                        {{ getActiveAllocations(item)[0].department }}
                                    </div>
                                </div>
                            </div>

                            <!-- Trường hợp chia sẻ nhiều người hoặc license multi-seat -->
                            <div v-else class="d-flex align-center gap-2">
                                <v-chip size="small" color="primary" variant="tonal" class="font-weight-medium">
                                    <v-icon icon="ri-team-line" size="14" class="mr-1" />
                                    {{ getActiveAllocations(item).length }} người dùng
                                </v-chip>
                            </div>
                        </template>
                        <template v-else>
                            <span class="text-caption text-disabled font-italic">Chưa cấp phát</span>
                        </template>
                    </div>
                </template>

                <!-- Cột 5: Trạng thái -->
                <template #[`item.status`]="{ item }">
                    <v-chip :color="getStatusColor(item.status)" size="small" class="font-weight-medium"
                        variant="tonal">
                        {{ getStatusText(item.status) }}
                    </v-chip>
                </template>

                <!-- Cột 6: Thao tác -->
                <template #[`item.actions`]="{ item }">
                    <div class="d-flex justify-center align-center gap-1">
                        <!-- Xem chi tiết -->
                        <v-tooltip text="Xem chi tiết" location="top">
                            <template #activator="{ props: tipProps }">
                                <v-btn v-bind="tipProps" icon="ri-eye-line" size="small" variant="text" color="info"
                                    @click="emit('view', item)" />
                            </template>
                        </v-tooltip>

                        <!-- Cấp phát cho nhân sự -->
                        <v-tooltip text="Cấp phát cho nhân sự" location="top">
                            <template #activator="{ props: tipProps }">
                                <v-btn v-bind="tipProps" icon="ri-user-shared-line" size="small" variant="text"
                                    color="success" @click="emit('allocate', item)" />
                            </template>
                        </v-tooltip>

                        <!-- Thu hồi nếu có người đang dùng -->
                        <v-tooltip v-if="getActiveAllocations(item).length > 0" text="Thu hồi tài sản" location="top">
                            <template #activator="{ props: tipProps }">
                                <v-btn v-bind="tipProps" icon="ri-arrow-go-back-line" size="small" variant="text"
                                    color="warning" @click="emit('revoke', item)" />
                            </template>
                        </v-tooltip>

                        <!-- Menu thêm: Sửa / Xóa -->
                        <v-menu location="bottom end">
                            <template #activator="{ props: menuProps }">
                                <v-btn v-bind="menuProps" icon="ri-more-2-line" size="small" variant="text"
                                    color="grey" />
                            </template>
                            <v-list density="compact" elevation="2">
                                <v-list-item prepend-icon="ri-pencil-line" title="Chỉnh sửa"
                                    @click="emit('edit', item)" />
                                <v-list-item prepend-icon="ri-delete-bin-line" title="Xóa tài sản" class="text-error"
                                    @click="emit('delete', item)" />
                            </v-list>
                        </v-menu>
                    </div>
                </template>

                <!-- Khi không tìm thấy kết quả -->
                <template #no-data>
                    <div class="pa-8 text-center">
                        <v-icon icon="ri-inbox-line" size="48" class="text-disabled mb-2" />
                        <div class="text-body-1 font-weight-medium text-medium-emphasis">Không tìm thấy tài sản nào phù
                            hợp</div>
                        <div class="text-caption text-disabled">Hãy thử điều chỉnh từ khóa tìm kiếm hoặc bộ lọc</div>
                    </div>
                </template>
            </v-data-table>
        </v-card>
    </div>
</template>

<style scoped>
.gap-1 {
    gap: 4px;
}

.gap-2 {
    gap: 8px;
}

.stat-card {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
    transform: translateY(-2px);
}

.line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
</style>
