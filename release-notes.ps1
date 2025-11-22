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

# Ask to push branch and tag
Write-Host ""
$pushConfirm = Read-Host "Push current branch and tag '$newTag' to origin now? [y/N]"

$tagPushed = $false

if ($pushConfirm -in @("y","Y","yes","YES")) {
    # Get current branch name
    $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
        Write-Error "Could not determine current branch. Tag was created locally, but you need to push it manually."
        Write-Host "Manual commands:" -ForegroundColor Cyan
        Write-Host "  git push origin <your-branch-name>"
        Write-Host "  git push origin $newTag"
        exit 1
    }

    Write-Host ""
    Write-Host "Pushing branch '$currentBranch' to origin..." -ForegroundColor Cyan
    git push origin $currentBranch
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push branch '$currentBranch'. Tag is still only local."
    } else {
        Write-Host "Branch '$currentBranch' pushed successfully." -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Pushing tag '$newTag' to origin..." -ForegroundColor Cyan
    git push origin $newTag
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push tag '$newTag'. You may need to push it manually with:"
        Write-Host "  git push origin $newTag"
    } else {
        Write-Host "Tag '$newTag' pushed successfully." -ForegroundColor Green
        $tagPushed = $true
    }
} else {
    Write-Host ""
    Write-Host "Tag created locally but not pushed." -ForegroundColor Yellow
    Write-Host "You can push later with:" -ForegroundColor Cyan
    Write-Host "  git push origin <your-branch-name>"
    Write-Host "  git push origin $newTag"
}

# Optional GitHub release creation using gh CLI
Write-Host ""
$releaseConfirm = Read-Host "Create a GitHub release for tag '$newTag' using these notes now? [y/N]"

if ($releaseConfirm -in @("y","Y","yes","YES")) {
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghCmd) {
        Write-Error "GitHub CLI 'gh' is not installed or not in PATH. Cannot create release automatically."
        Write-Host "You can create a release manually in your hosting provider UI using these notes." -ForegroundColor Yellow
        exit 0
    }

    if (-not $tagPushed) {
        Write-Host ""
        Write-Host "Warning: Tag '$newTag' does not appear to have been pushed to origin in this session." -ForegroundColor Yellow
        $cont = Read-Host "Create the release anyway? The tag must exist on the remote for this to work. [y/N]"
        if ($cont -notin @("y","Y","yes","YES")) {
            Write-Host "Skipped creating release."
            exit 0
        }
    }

    $releaseTempFile = [System.IO.Path]::GetTempFileName()
    $notes | Out-File -FilePath $releaseTempFile -Encoding UTF8

    Write-Host ""
    Write-Host "Creating GitHub release for '$newTag'..." -ForegroundColor Cyan
    gh release create $newTag -F $releaseTempFile -t $newTag
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create GitHub release with 'gh'."
        Write-Host "You may need to create the release manually." -ForegroundColor Yellow
    } else {
        Write-Host "GitHub release for '$newTag' created successfully." -ForegroundColor Green
    }

    Remove-Item $releaseTempFile -ErrorAction SilentlyContinue
}
