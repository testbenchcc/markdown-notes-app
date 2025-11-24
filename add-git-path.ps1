# Any PATH additions go here in one line
$appPaths = "C:\Program Files\Git\bin;C:\Program Files\Git\bin\git.exe"

Write-Host "Checking paths..."

# Current user PATH
$current = [Environment]::GetEnvironmentVariable("PATH", "User")

# If already present, do nothing
if ($current -and $current.ToLower().Contains($appPaths.ToLower())) {
    Write-Host "Entries already exist in PATH."
} else {
    Write-Host "Appending entries to PATH..."

    if ([string]::IsNullOrEmpty($current)) {
        $newPath = $appPaths
    } else {
        $newPath = "$current;$appPaths"
    }

    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    Write-Host "User PATH updated."
}

# Update session PATH
$env:PATH = [Environment]::GetEnvironmentVariable("PATH", "User")

Write-Host "Done. Current session PATH updated."
