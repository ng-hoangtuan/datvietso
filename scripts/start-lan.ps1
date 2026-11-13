<#
.SYNOPSIS
  Chạy datvietso trên máy này cho người khác trong mạng LAN truy cập.

.DESCRIPTION
  Dùng khi demo cho khách: khách mở trình duyệt trên máy của họ và gõ địa chỉ IP
  của máy bạn.

  Việc script làm:
    1. Tìm IP LAN thật của máy (bỏ qua card ảo WSL / Hyper-V / VMware)
    2. Ghi frontend/.env.local trỏ API về đúng IP đó
    3. Cảnh báo nếu tường lửa hoặc profile mạng sẽ chặn khách
    4. Mở hai cửa sổ chạy backend và frontend

  BƯỚC 2 LÀ MẤU CHỐT. Bản build frontend nhúng sẵn địa chỉ API vào JavaScript.
  Để mặc định `localhost:5000` thì trình duyệt của KHÁCH sẽ gọi về máy CỦA HỌ,
  không phải máy bạn — trang mở được nhưng trắng trơn, không có dữ liệu nào.

.PARAMETER Ip
  Ép dùng một IP cụ thể, khi máy có nhiều card mạng và script chọn nhầm.

.EXAMPLE
  .\scripts\start-lan.ps1
  .\scripts\start-lan.ps1 -Ip 192.168.1.50
#>
param(
    [string]$Ip = '',
    [int]$ApiPort = 5000,
    [int]$WebPort = 5173,
    # Chỉ dò IP, ghi .env.local và kiểm tra điều kiện — không mở server.
    # Dùng để xem trước mình sẽ đưa địa chỉ nào cho khách.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Say($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }

Say ''
Say '=== datvietso - chay cho khach truy cap qua LAN ===' 'Cyan'
Say ''

# --- 1. Tim IP LAN ---------------------------------------------------------
# Card ảo của WSL / Docker / Hyper-V cũng có IPv4 nhưng máy khác không tới được,
# nên phải loại ra, nếu không script sẽ đưa nhầm địa chỉ cho khách.
if (-not $Ip) {
    $VIRTUAL = 'vEthernet|WSL|Hyper-V|Loopback|VirtualBox|VMware|Bluetooth|Tailscale'

    $candidates = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        ForEach-Object {
            $ad = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
            if ($ad -and $ad.Status -eq 'Up' -and $ad.Name -notmatch $VIRTUAL) {
                [pscustomobject]@{
                    Ip      = $_.IPAddress
                    Adapter = $ad.Name
                    # Card có default gateway là card đang thật sự ra mạng
                    HasGw   = [bool](Get-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
                }
            }
        }

    $pick = $candidates | Sort-Object -Property HasGw -Descending | Select-Object -First 1
    if (-not $pick) {
        Say 'Khong tim thay card mang that nao dang hoat dong.' 'Red'
        Say 'Chay lai kem -Ip <dia-chi> neu ban biet IP cua may.' 'Yellow'
        exit 1
    }

    $Ip = $pick.Ip
    Say ("IP LAN  : {0}   (card {1})" -f $Ip, $pick.Adapter) 'Green'

    if ($candidates.Count -gt 1) {
        Say ('  Con card khac: ' + (($candidates | Where-Object { $_.Ip -ne $Ip } | ForEach-Object { "$($_.Ip) ($($_.Adapter))" }) -join ', ')) 'DarkGray'
        Say '  Chon nham thi chay lai voi -Ip <dia-chi>' 'DarkGray'
    }
}
else {
    Say ("IP LAN  : {0}   (ban chi dinh)" -f $Ip) 'Green'
}

# --- 2. Mot cong hay hai cong? ----------------------------------------------
# Co dist/ nghia la frontend da build va backend phuc vu luon -> chi MOT cong,
# khach chi can mot dia chi, khong phai chay vite. Chua build thi quay ve cach
# cu: vite o 5173, goi API sang 5000.
$distIndex = Join-Path $root 'frontend\typescript-version\dist\index.html'
$singlePort = Test-Path $distIndex
$userPort = if ($singlePort) { $ApiPort } else { $WebPort }

if ($singlePort) {
    Say 'Che do  : MOT CONG (backend phuc vu luon giao dien da build)' 'Green'
}
else {
    Say 'Che do  : HAI CONG (chua build frontend, se chay vite rieng)' 'Yellow'

    # Chi che do hai cong moi can bien nay: bao cho trinh duyet KHACH biet goi
    # API ve dau. De mac dinh localhost la may khach goi ve chinh no.
    $envFile = Join-Path $root 'frontend\typescript-version\.env.local'
    $content = @"
# Tao tu dong boi scripts/start-lan.ps1 - dung sua tay.
# Dia chi backend ma TRINH DUYET CUA KHACH se goi toi.
VITE_API_URL=http://${Ip}:${ApiPort}
"@
    # Ghi UTF-8 KHONG BOM: Set-Content -Encoding utf8 cua PS 5.1 luon chen BOM,
    # ma BOM dau file .env se dinh vao ten bien o dong dau tien.
    [System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding $false))
    Say ("Cau hinh: frontend/.env.local -> http://{0}:{1}" -f $Ip, $ApiPort) 'Green'
    Say '  (chay npm run build o frontend de chuyen sang che do mot cong)' 'DarkGray'
}

# --- 3. Kiem tra nhung thu se chan khach -----------------------------------
Say ''
$warn = @()

# MongoDB
$mongoUp = $false
try {
    $null = & docker inspect dvs-mongo 2>&1
    if ($LASTEXITCODE -eq 0) {
        $st = (& docker inspect --format '{{.State.Running}}' dvs-mongo 2>&1)
        $mongoUp = ($st -eq 'true')
    }
}
catch { $mongoUp = $false }

if ($mongoUp) { Say 'MongoDB : dang chay' 'Green' }
else {
    Say 'MongoDB : CHUA CHAY' 'Red'
    $warn += 'Chay truoc:  docker compose up -d'
}

# Profile mang: Public thi Windows chan manh hon nhieu
$profiles = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' }
$publicNet = $profiles | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($publicNet) {
    Say ("Mang    : '{0}' dang o che do Public" -f $publicNet[0].Name) 'Yellow'
    $warn += @"
Doi mang sang Private (chay PowerShell QUYEN ADMIN):
    Set-NetConnectionProfile -Name '$($publicNet[0].Name)' -NetworkCategory Private
"@
}
else { Say 'Mang    : Private' 'Green' }

# Rule tuong lua
$ruleName = 'datvietso-demo-lan'
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($rule) { Say 'Tuong lua: da co rule cho phep' 'Green' }
else {
    Say 'Tuong lua: CHUA MO CONG' 'Yellow'
    $warn += @"
Mo cong cho LAN (chay PowerShell QUYEN ADMIN, chi can 1 lan):
    New-NetFirewallRule -DisplayName '$ruleName' ``
      -Direction Inbound -Action Allow -Protocol TCP ``
      -LocalPort $(if ($singlePort) { "$ApiPort" } else { "$ApiPort,$WebPort" }) -Profile Private
Xoa khi demo xong:
    Remove-NetFirewallRule -DisplayName '$ruleName'
"@
}

if ($warn.Count -gt 0) {
    Say ''
    Say '--- CAN LAM TRUOC ---' 'Yellow'
    foreach ($w in $warn) { Say $w 'Yellow'; Say '' }
}

if ($DryRun) {
    Say ''
    Say ("DryRun: dia chi se gui cho khach la  http://{0}:{1}" -f $Ip, $userPort) 'Cyan'
    Say 'Bo -DryRun de chay that.' 'DarkGray'
    exit 0
}

if ($warn.Count -gt 0) {
    $ans = Read-Host 'Van chay tiep? (y/N)'
    if ($ans -ne 'y') { Say 'Da dung.' 'DarkGray'; exit 0 }
}

# --- 4. Chay hai server ----------------------------------------------------
Say ''
Say $(if ($singlePort) { 'Dang mo cua so backend...' } else { 'Dang mo 2 cua so: backend va frontend...' }) 'Cyan'

$be = Join-Path $root 'backend'
$fe = Join-Path $root 'frontend\typescript-version'

Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$be'; Write-Host 'BACKEND  http://${Ip}:${ApiPort}' -ForegroundColor Green; npm run dev"
)

if (-not $singlePort) {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "Set-Location '$fe'; Write-Host 'FRONTEND http://${Ip}:${WebPort}' -ForegroundColor Green; npm run dev -- --host --port $WebPort"
    )
}

Say ''
Say '===============================================' 'Cyan'
Say ' Dia chi gui cho khach:' 'Cyan'
Say ("   http://{0}:{1}" -f $Ip, $userPort) 'Green'
Say ''
Say ' Tai khoan: DVS-001  /  mat khau: 123456' 'Cyan'
Say '===============================================' 'Cyan'
Say ''
Say 'LUU Y BAO MAT' 'Yellow'
Say ' Tang dang nhap cua ban cu y giu o ban tam: mat khau 123456 mo duoc' 'Yellow'
Say ' moi tai khoan va token chua ky. Chi chay trong mang noi bo tin cay,' 'Yellow'
Say ' dung mo cong ra Internet, va tat cac server khi demo xong.' 'Yellow'
Say ''
Say 'IP doi (doi Wi-Fi, cap lai DHCP) thi chay lai script nay.' 'DarkGray'
Say ''
