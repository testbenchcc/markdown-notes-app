param(
    [int]$RecentTagCount = 5
)

function Assert-GitRepo {
    $null = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "This directory is not inside a git repository."
        exit 1
    }
}

function Get-RecentTags {
    param(
        [int]$Count = 5
    )
    $tags = git tag --sort=-v:refname | Where-Object { $_ -ne "" }
    return $tags | Select-Object -First $Count
}

function Get-ReleaseNotes {
    param(
        [string]$FromTag,
        [string]$ToRef = "HEAD"
    )

    # Get commit subjects between two refs
    $commits = git log "$FromTag..$ToRef" --pretty=format:"%s"
    if (-not $commits) {
        return "## Changes`n`n- No commits found between $FromTag and $ToRef."
    }

    # Group commits by Conventional Commit type
    $features = $commits | Where-Object { $_ -match '^feat(\([^)]+\))?:' }
    $fixes    = $commits | Where-Object { $_ -match '^fix(\([^)]+\))?:' }
    $docs     = $commits | Where-Object { $_ -match '^docs(\([^)]+\))?:' }

    $others   = $commits | Where-Object {
        ($_ -notmatch '^feat(\([^)]+\))?:') -and
        ($_ -notmatch '^fix(\([^)]+\))?:') -and
        ($_ -notmatch '^docs(\([^)]+\))?:')
    }

    $sb = New-Object System.Text.StringBuilder

    if ($features) {
        [void]$sb.AppendLine("## Features")
        $features | ForEach-Object {
            $line = ($_ -replace '^feat(\([^)]+\))?:\s*', '- ')
            [void]$sb.AppendLine($line)
        }
        [void]$sb.AppendLine()
    }

    if ($fixes) {
        [void]$sb.AppendLine("## Fixes")
        $fixes | ForEach-Object {
            $line = ($_ -replace '^fix(\([^)]+\))?:\s*', '- ')
            [void]$sb.AppendLine($line)
        }
        [void]$sb.AppendLine()
    }

    if ($docs) {
        [void]$sb.AppendLine("## Documentation")
        $docs | ForEach-Object {
            $line = ($_ -replace '^docs(\([^)]+\))?:\s*', '- ')
            [void]$sb.AppendLine($line)
        }
        [void]$sb.AppendLine()
    }

    if ($others) {
        [void]$sb.AppendLine("## Other")
        $others | ForEach-Object {
            [void]$sb.AppendLine("- $_")
        }
        [void]$sb.AppendLine()
    }

    return $sb.ToString().Trim()
}

# Main script

Assert-GitRepo

# Get recent tags
$recentTags = Get-RecentTags -Count $RecentTagCount

if (-not $recentTags -or $recentTags.Count -eq 0) {
    Write-Error "No tags found in this repository. Create an initial tag first."
    exit 1
}

Write-Host "Most recent tags:" -ForegroundColor Cyan
$recentTags | ForEach-Object { Write-Host "  $_" }

$fromTag = $recentTags[0]

Write-Host ""
Write-Host "Using previous tag '$fromTag' as the starting point for release notes." -ForegroundColor Yellow

# Generate release notes
$notes = Get-ReleaseNotes -FromTag $fromTag

Write-Host ""
Write-Host "Generated release notes (between $fromTag and HEAD):" -ForegroundColor Cyan
Write-Host ""
Write-Output $notes
Write-Host ""

# Ask user for new version tag
$newTag = Read-Host "Enter new version tag to create (for example v1.3.0)"
if ([string]::IsNullOrWhiteSpace($newTag)) {
    Write-Error "Version tag cannot be empty. Aborting."
    exit 1
}

Write-Host ""
Write-Host "You are about to create tag '$newTag' with the following notes:" -ForegroundColor Yellow
Write-Host ""
Write-Output $notes
Write-Host ""

$confirm = Read-Host "Create annotated tag '$newTag' with these notes? [y/N]"
if ($confirm -notin @("y","Y","yes","YES")) {
    Write-Host "Aborted."
    exit 0
}

# Write notes to a temp file for git tag -F
$tempFile = [System.IO.Path]::GetTempFileName()
$notes | Out-File -FilePath $tempFile -Encoding UTF8

# Create annotated tag
git tag -a $newTag -F $tempFile
if ($LASTEXITCODE -ne 0) {
    Write-Error "git tag command failed."
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    exit 1
}

Remove-Item $tempFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Created tag '$newTag' with release notes." -ForegroundColor Green
Write-Host "You can push it with:" -ForegroundColor Cyan
Write-Host "  git push origin $newTag"
