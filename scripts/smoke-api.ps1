$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$dir = Join-Path $env:TEMP 'aikefu-smoke'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$base = 'http://127.0.0.1:3001'
$report = New-Object System.Collections.Generic.List[object]

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Call {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Url,
    [string]$Token = '',
    [string]$JsonBody = '',
    [int[]]$ExpectOk = @(200, 201, 204)
  )
  $out = Join-Path $dir 'last-body.txt'
  $hdr = Join-Path $dir 'last-hdr.txt'
  if (Test-Path $out) { Remove-Item $out -Force }
  if (Test-Path $hdr) { Remove-Item $hdr -Force }

  $curlArgs = @('-sS', '-D', $hdr, '-o', $out, '-w', '%{http_code}', '-X', $Method, $Url)
  if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }
  if ($JsonBody) {
    $bodyFile = Join-Path $dir 'req-body.json'
    Write-Utf8NoBom $bodyFile $JsonBody
    $curlArgs += @('-H', 'Content-Type: application/json; charset=utf-8', '--data-binary', "@$bodyFile")
  }

  $codeStr = & curl.exe @curlArgs 2>&1
  if ($codeStr -is [array]) { $codeStr = ($codeStr | Select-Object -Last 1) }
  $code = 0
  [void][int]::TryParse("$codeStr", [ref]$code)
  $body = ''
  if (Test-Path $out) { $body = [System.IO.File]::ReadAllText($out) }

  $ok = $ExpectOk -contains $code
  $snippet = if ($body.Length -gt 280) { $body.Substring(0, 280) } else { $body }
  $report.Add([pscustomobject]@{ Name = $Name; Code = $code; OK = $ok; Body = $snippet }) | Out-Null
  return @{ Code = $code; Body = $body; Ok = $ok }
}

Call 'GET /health' GET "$base/health" | Out-Null
Call 'GET /ready' GET "$base/ready" | Out-Null
Call 'GET web /' GET 'http://127.0.0.1:3000/' '' '' @(200, 307) | Out-Null
Call 'GET ai /health' GET 'http://127.0.0.1:8000/health' | Out-Null

$login = Call 'POST /auth/login admin' POST "$base/api/v1/auth/login" '' '{"email":"agent@demo.aikefu.local","password":"demo-password"}'
$loginJson = $null
try { $loginJson = $login.Body | ConvertFrom-Json } catch {}
$token = $loginJson.accessToken
if (-not $token) { $token = $loginJson.token }
if (-not $token) {
  Write-Host 'LOGIN FAILED'
  Write-Host $login.Body
  $report | Format-Table Name, Code, OK, Body -Wrap
  exit 1
}
Write-Host "admin_token_ok len=$($token.Length)"

Call 'GET /me' GET "$base/api/v1/me" $token | Out-Null
Call 'GET /tenants' GET "$base/api/v1/tenants" $token | Out-Null
Call 'GET /conversations' GET "$base/api/v1/conversations?limit=20" $token | Out-Null
Call 'GET /contacts' GET "$base/api/v1/conversations/contacts?limit=20" $token | Out-Null
Call 'GET /knowledge/documents' GET "$base/api/v1/knowledge/documents?limit=50" $token | Out-Null
Call 'GET /knowledge/bases' GET "$base/api/v1/knowledge/bases" $token | Out-Null
Call 'GET /knowledge/categories' GET "$base/api/v1/knowledge/categories" $token | Out-Null
Call 'GET /knowledge/gaps' GET "$base/api/v1/knowledge/gaps" $token | Out-Null
Call 'GET /knowledge/index-settings' GET "$base/api/v1/knowledge/index-settings" $token | Out-Null
Call 'GET /knowledge/index-health' GET "$base/api/v1/knowledge/index-health" $token | Out-Null
Call 'GET /knowledge/retrieve' GET "$base/api/v1/knowledge/retrieve?q=%E9%A9%AC%E5%85%8B%E6%9D%AF%E8%B5%B7%E8%AE%A2&limit=5" $token | Out-Null
Call 'GET /ai/profiles' GET "$base/api/v1/ai/profiles" $token | Out-Null
Call 'GET /ai/settings' GET "$base/api/v1/ai/settings" $token | Out-Null
Call 'GET /ai/auto-send' GET "$base/api/v1/ai/settings/auto-send" $token | Out-Null
Call 'GET /members' GET "$base/api/v1/members" $token | Out-Null
Call 'GET /audit-logs' GET "$base/api/v1/audit-logs" $token | Out-Null
Call 'GET /analytics/support' GET "$base/api/v1/analytics/support?period=7d" $token | Out-Null
Call 'GET /wecom/connections' GET "$base/api/v1/wecom/connections" $token | Out-Null
Call 'GET /auto-draft-jobs/overview' GET "$base/api/v1/auto-draft-jobs/overview" $token | Out-Null
Call 'GET /auto-draft-jobs/dead' GET "$base/api/v1/auto-draft-jobs/dead" $token | Out-Null
Call 'GET /events/ticket' GET "$base/api/v1/events/ticket" $token | Out-Null

$convBody = ($report | Where-Object { $_.Name -eq 'GET /conversations' } | Select-Object -Last 1).Body
$convs = $null
try { $convs = $convBody | ConvertFrom-Json } catch {}
$convId = $null
if ($convs -and $convs.items -and $convs.items.Count -gt 0) { $convId = $convs.items[0].id }
Write-Host "convId=$convId"
if ($convId) {
  Call 'GET /conversations/:id' GET "$base/api/v1/conversations/$convId" $token | Out-Null
  Call 'GET /conversations/:id/messages' GET "$base/api/v1/conversations/$convId/messages" $token | Out-Null
  Call 'GET /conversations/:id/ai-draft' GET "$base/api/v1/conversations/$convId/ai-draft" $token @(200, 404) | Out-Null
  Call 'POST /conversations/:id/read' POST "$base/api/v1/conversations/$convId/read" $token '{}' | Out-Null
  Call 'POST /conversations/:id/ai-drafts' POST "$base/api/v1/conversations/$convId/ai-drafts" $token '{}' @(200, 201, 400, 409, 422) | Out-Null
  Call 'POST /conversations/:id/replies' POST "$base/api/v1/conversations/$convId/replies" $token '{"content":"smoke reply from admin"}' @(200, 201, 400, 409, 422) | Out-Null
}

$clogin = Call 'POST /auth/login customer' POST "$base/api/v1/auth/login" '' '{"email":"customer@demo.aikefu.local","password":"demo-password"}'
$cjson = $null
try { $cjson = $clogin.Body | ConvertFrom-Json } catch {}
$ctoken = $cjson.accessToken
if (-not $ctoken) { $ctoken = $cjson.token }
if ($ctoken) {
  Call 'GET /customer/thread' GET "$base/api/v1/customer/thread" $ctoken | Out-Null
  $ts = Get-Date -Format 'HHmmss'
  Call 'POST /customer/messages' POST "$base/api/v1/customer/messages" $ctoken ("{`"content`":`"smoke customer msg $ts`"}") | Out-Null
}

Call 'POST /auth/login kefu' POST "$base/api/v1/auth/login" '' '{"email":"kefu@demo.aikefu.local","password":"demo-password"}' | Out-Null
Call 'GET /me bad token' GET "$base/api/v1/me" 'bad-token' '' @(401) | Out-Null
Call 'POST /auth/login bad pwd' POST "$base/api/v1/auth/login" '' '{"email":"agent@demo.aikefu.local","password":"wrong-password"}' @(401) | Out-Null
Call 'POST /ai/settings/test' POST "$base/api/v1/ai/settings/test" $token '{}' @(200, 400, 404, 422) | Out-Null
Call 'POST /wecom/mock/inject' POST "$base/api/v1/wecom/mock/inject" $token '{"text":"mock inject smoke","externalUserId":"smoke-user-1"}' @(200, 201, 400) | Out-Null

# wait briefly then re-check conversations after customer message
Start-Sleep -Seconds 2
if ($ctoken) {
  Call 'GET /conversations after customer msg' GET "$base/api/v1/conversations?limit=5" $token | Out-Null
}

Write-Host ''
Write-Host '===== UNEXPECTED ====='
$report | Where-Object { -not $_.OK } | Format-Table Name, Code, Body -Wrap
Write-Host '===== SUMMARY ====='
$report | Format-Table Name, Code, OK -AutoSize
$pass = @($report | Where-Object OK).Count
$fail = @($report | Where-Object { -not $_.OK }).Count
Write-Host "PASS=$pass FAIL=$fail TOTAL=$($report.Count)"
$path = Join-Path $dir 'report.json'
$report | ConvertTo-Json -Depth 5 | Set-Content $path -Encoding UTF8
Write-Host "Report: $path"

foreach ($r in $report) {
  if (-not $r.OK -or $r.Name -match 'login admin|ready|ai-draft|mock|customer/messages|auto-send|ai/settings/test|replies|ai-drafts') {
    Write-Host ("---`n{0} [{1}]`n{2}" -f $r.Name, $r.Code, $r.Body)
  }
}
