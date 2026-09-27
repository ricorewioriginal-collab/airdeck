# AirDeck GitHub Storage Cleanup
# Loescht alle alten Actions-Artefakte (behaelt je Typ nur den neuesten)
# und auf Wunsch auch alte Releases.
#
# VERWENDUNG:
#   $env:GITHUB_TOKEN = "ghp_deinToken"
#   pwsh -ExecutionPolicy Bypass -File scripts/cleanup-github-storage.ps1
#
# Benoetigt: GitHub PAT mit Scopes: repo (oder: actions:write + contents:write)
# Erstellt:  2026-09-27 | Zweck: Einmaliger Cleanup nach Storage-Explosion

param(
    [string]$Token    = $env:GITHUB_TOKEN,
    [string]$Repo     = "ricorewioriginal-collab/anmacha_control",
    [switch]$DryRun,               # Mit -DryRun: nur anzeigen, nichts loeschen
    [switch]$IncludeReleases,      # Mit -IncludeReleases: auch alte Releases loeschen
    [int]   $KeepReleases = 1      # Wie viele aktuelle Releases behalten (Standard: 1)
)

if (-not $Token) {
    Write-Error "Kein GitHub-Token. Setze `$env:GITHUB_TOKEN = 'ghp_...' oder uebergib -Token."
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $Token"
    "User-Agent"    = "AirDeck-Cleanup"
    "Accept"        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$baseUrl = "https://api.github.com/repos/$Repo"

function Invoke-GH($Method, $Path, $Body = $null) {
    $uri = "$baseUrl$Path"
    $params = @{ Uri = $uri; Method = $Method; Headers = $headers; ErrorAction = "Stop" }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json); $params.ContentType = "application/json" }
    try {
        Invoke-RestMethod @params
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 204 -or $code -eq 404) { return $null }
        Write-Warning "  API-Fehler $code bei $Method $Path : $($_.Exception.Message)"
        return $null
    }
}

# ─── ARTEFAKTE ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== SCHRITT 1: Actions-Artefakte bereinigen ===" -ForegroundColor Cyan

$page = 1; $allArt = @()
do {
    $resp = Invoke-GH "GET" "/actions/artifacts?per_page=100&page=$page"
    $allArt += $resp.artifacts
    $page++
} while ($allArt.Count -lt $resp.total_count -and $resp.artifacts.Count -eq 100)

Write-Host "  Gefundene Artefakte: $($allArt.Count)"

# Je Name: nur den neuesten behalten (hoechste ID = juengster)
$grouped = $allArt | Group-Object name
$toDelete = @()
$toKeep   = @()

foreach ($group in $grouped) {
    $sorted  = $group.Group | Sort-Object id -Descending
    $keep    = $sorted | Select-Object -First 1
    $old     = $sorted | Select-Object -Skip 1
    $toKeep  += $keep
    $toDelete += $old
    $sizeMB  = [math]::Round(($old | Measure-Object -Property size_in_bytes -Sum).Sum / 1MB, 1)
    Write-Host "  $($group.Name): behalte ID $($keep.id) | loesche $($old.Count) alte ($sizeMB MB)"
}

$totalDeleteMB = [math]::Round(($toDelete | Measure-Object -Property size_in_bytes -Sum).Sum / 1MB, 0)
$totalDeleteGB = [math]::Round($totalDeleteMB / 1024, 2)

Write-Host ""
Write-Host "  Zu loeschen: $($toDelete.Count) Artefakte | $totalDeleteMB MB ($totalDeleteGB GB)" -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "  [DRY-RUN] Nichts geloescht." -ForegroundColor Gray
} else {
    $deleted = 0; $failed = 0
    foreach ($art in $toDelete) {
        $result = Invoke-GH "DELETE" "/actions/artifacts/$($art.id)"
        if ($result -ne $false) {
            $deleted++
            if ($deleted % 50 -eq 0) { Write-Host "  ... $deleted von $($toDelete.Count) geloescht" }
        } else {
            $failed++
            Write-Warning "  Fehler beim Loeschen von Artefakt $($art.id) ($($art.name))"
        }
    }
    Write-Host "  Artefakte geloescht: $deleted | Fehler: $failed" -ForegroundColor Green
}

# ─── .DOCKERBUILD RECORDS ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== SCHRITT 2: .dockerbuild Records loeschen ===" -ForegroundColor Cyan
$dockerBuilds = $allArt | Where-Object { $_.name -like "*.dockerbuild" }
Write-Host "  Gefundene .dockerbuild Records: $($dockerBuilds.Count)"
if (-not $DryRun -and $dockerBuilds.Count -gt 0) {
    foreach ($art in $dockerBuilds) {
        Invoke-GH "DELETE" "/actions/artifacts/$($art.id)" | Out-Null
    }
    Write-Host "  .dockerbuild Records geloescht: $($dockerBuilds.Count)" -ForegroundColor Green
}

# ─── RELEASES ─────────────────────────────────────────────────────────────────
if ($IncludeReleases) {
    Write-Host ""
    Write-Host "=== SCHRITT 3: Alte Releases bereinigen ===" -ForegroundColor Cyan

    $releases = Invoke-GH "GET" "/releases?per_page=100"
    Write-Host "  Gefundene Releases: $($releases.Count)"

    $sortedRel  = $releases | Sort-Object { [datetime]$_.created_at } -Descending
    $keepRel    = $sortedRel | Select-Object -First $KeepReleases
    $deleteRel  = $sortedRel | Select-Object -Skip $KeepReleases

    $relDeleteMB = [math]::Round(($deleteRel | ForEach-Object {
        ($_.assets | Measure-Object -Property size -Sum).Sum
    } | Measure-Object -Sum).Sum / 1MB, 0)

    Write-Host "  Behalten:  $($keepRel.Count) aktuellste Release(s): $($keepRel.tag_name -join ', ')"
    Write-Host "  Loeschen:  $($deleteRel.Count) alte Releases | $relDeleteMB MB" -ForegroundColor Yellow

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Nichts geloescht." -ForegroundColor Gray
    } else {
        $relDeleted = 0
        foreach ($rel in $deleteRel) {
            Invoke-GH "DELETE" "/releases/$($rel.id)" | Out-Null
            $relDeleted++
            if ($relDeleted % 10 -eq 0) { Write-Host "  ... $relDeleted Releases geloescht" }
        }
        Write-Host "  Releases geloescht: $relDeleted" -ForegroundColor Green
    }
}

# ─── ZUSAMMENFASSUNG ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== FERTIG ===" -ForegroundColor Green
Write-Host "  Artefakte: $($toDelete.Count) geloescht | ~$totalDeleteGB GB frei"
if ($IncludeReleases) {
    Write-Host "  Releases:  $($deleteRel.Count) geloescht | ~$([math]::Round($relDeleteMB/1024,2)) GB frei"
}
Write-Host ""
Write-Host "Hinweis: GitHub verarbeitet Loeschungen asynchron."
Write-Host "Die Speicherersparnis ist im GitHub-Speicherreport nach einigen Minuten sichtbar."
