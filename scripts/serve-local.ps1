# Manual Builder をローカルで開くための小さな静的 Web サーバー（Windows 標準の PowerShell だけで動く）
#
# なぜ必要か: ブラウザは file:// で開いたページからのファイル保存（File System Access API の書き込み）を
# セキュリティポリシーで拒否する。http://localhost で開けば読み書きとも許可される。
#
# 使い方:  powershell -ExecutionPolicy Bypass -File serve-local.ps1 [-Port 8790] [-Root <フォルダ>]
#          （同じフォルダの start-local.cmd をダブルクリックしても同じ）
param(
  [int]$Port = 8790,
  [string]$Root = $PSScriptRoot,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

# "/" で開くファイル: app/index.html（公開サイト版の構成）か manual-builder.html（単一ファイル版）
$indexCandidates = @("app\index.html", "manual-builder.html", "index.html")
$index = $indexCandidates | Where-Object { Test-Path (Join-Path $Root $_) } | Select-Object -First 1
if (-not $index) {
  Write-Host "起動できません: $Root に app\index.html か manual-builder.html がありません" -ForegroundColor Red
  exit 1
}
$indexDir = Split-Path (Join-Path $Root $index) -Parent

$mime = @{
  ".html" = "text/html; charset=utf-8"; ".htm" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"
  ".mjs" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8"
  ".svg" = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"; ".gif" = "image/gif"
  ".webp" = "image/webp"; ".ico" = "image/x-icon"; ".txt" = "text/plain; charset=utf-8"; ".md" = "text/markdown; charset=utf-8"
  ".woff" = "font/woff"; ".woff2" = "font/woff2"; ".map" = "application/json"
}

function Send-Response($stream, [int]$status, [string]$statusText, [string]$contentType, [byte[]]$body) {
  $header = "HTTP/1.1 $status $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "ポート $Port を開けません（他のアプリが使用中かもしれません）。-Port で別の番号を指定してください。" -ForegroundColor Red
  exit 1
}
$url = "http://localhost:$Port/"
Write-Host "Manual Builder: $url  （公開フォルダ: $indexDir）"
Write-Host "このウィンドウを閉じるとサーバーが止まります。ブラウザのタブを閉じただけなら、同じ URL で開き直せます。"
if (-not $NoBrowser) { Start-Process $url | Out-Null }

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    # 残りのヘッダーは読み捨てる（空行まで）
    while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") { }
    if (-not $requestLine) { $client.Close(); continue }
    $parts = $requestLine.Split(" ")
    $method = $parts[0]
    $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
    $path = [System.Uri]::UnescapeDataString(($rawPath -split "\?")[0])
    if ($method -ne "GET" -and $method -ne "HEAD") {
      Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("405"))
      $client.Close(); continue
    }
    if ($path -eq "/") { $path = "/" + (Split-Path $index -Leaf) }
    $relative = $path.TrimStart("/").Replace("/", "\")
    $full = [System.IO.Path]::GetFullPath((Join-Path $indexDir $relative))
    # 公開フォルダの外（..）へは出さない
    if (-not $full.StartsWith($indexDir, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
      Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path"))
      $client.Close(); continue
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
    $bytes = if ($method -eq "HEAD") { [byte[]]@() } else { [System.IO.File]::ReadAllBytes($full) }
    Send-Response $stream 200 "OK" $type $bytes
  } catch {
    Write-Host "要求の処理に失敗しました: $($_.Exception.Message)" -ForegroundColor Yellow
  } finally {
    $client.Close()
  }
}
