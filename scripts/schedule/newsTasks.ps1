# Registers the News Engine's unattended runs with Windows Task Scheduler (Phase 6 cadence).
# What each task runs, and why locally rather than on a CI runner: scripts/newsCycle.mjs.
#
#   powershell -ExecutionPolicy Bypass -File scripts\schedule\newsTasks.ps1 -Action install [-DryRun]
#   powershell -ExecutionPolicy Bypass -File scripts\schedule\newsTasks.ps1 -Action status
#   powershell -ExecutionPolicy Bypass -File scripts\schedule\newsTasks.ps1 -Action uninstall
#
# Two tasks, both under the current user and ONLY while that user is logged on (no stored password):
#   "Atlas News Build"  10:00 and 22:00 local time  -> npm run news:build
#   "Atlas News Watch"  every 3 hours (-WatchIntervalMinutes to change; 180 default) -> npm run news:watch
#
# The tasks point at THIS checkout's path. If the checkout moves (or this git worktree is removed), run uninstall, then
# install again from the new location. The archive lives under this checkout too (archive/news/, not regenerable) unless
# NEWS_ARCHIVE_DIR is set — see scripts/lib/newsArchive.mjs.
param(
  [Parameter(Mandatory = $true)][ValidateSet('install', 'uninstall', 'status')][string]$Action,
  [switch]$DryRun,
  # J, 2026-09-23: 3 hours. The first pick (30 min) was mine, not from the design; see LOGBOOK.md.
  [ValidateRange(15, 1440)][int]$WatchIntervalMinutes = 180
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildTask = 'Atlas News Build'
$watchTask = 'Atlas News Watch'

function New-NewsAction([string]$npmScript) {
  $npm = (Get-Command npm.cmd).Source
  # Hidden window so a frequent tick doesn't flash a console over whatever is being worked on.
  $cmd = "Set-Location -LiteralPath '$repo'; & '$npm' run $npmScript"
  New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$cmd`"" -WorkingDirectory $repo
}

function New-NewsSettings {
  New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
}

switch ($Action) {
  'install' {
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $build = @{
      TaskName = $buildTask
      Description = 'News Engine: scheduled build of public/data/news-events.json (10AM/10PM). See scripts/newsCycle.mjs.'
      Action = New-NewsAction 'news:build'
      Trigger = @((New-ScheduledTaskTrigger -Daily -At '10:00'), (New-ScheduledTaskTrigger -Daily -At '22:00'))
      Settings = New-NewsSettings
      Principal = $principal
    }
    # Repeats from "now" with no end. Windows treats an omitted duration as indefinite on Win10/11.
    $watch = @{
      TaskName = $watchTask
      Description = 'News Engine: fetch + archive, and pull a build forward when something Critical-looking arrives. See scripts/newsCycle.mjs.'
      Action = New-NewsAction 'news:watch'
      Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $WatchIntervalMinutes)
      Settings = New-NewsSettings
      Principal = $principal
    }
    foreach ($t in @($build, $watch)) {
      if ($DryRun) {
        Write-Host "[dry run] would register '$($t.TaskName)' as $user, working dir $repo"
        Write-Host "          action : $($t.Action.Execute) $($t.Action.Arguments)"
        foreach ($tr in @($t.Trigger)) { Write-Host "          trigger: $($tr.CimClass.CimClassName) at $($tr.StartBoundary) repeat=$($tr.Repetition.Interval)" }
      } else {
        Register-ScheduledTask @t -Force | Out-Null
        Write-Host "Registered '$($t.TaskName)'."
      }
    }
  }
  'uninstall' {
    foreach ($name in @($buildTask, $watchTask)) {
      if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Removed '$name'."
      } else {
        Write-Host "'$name' is not registered."
      }
    }
  }
  'status' {
    foreach ($name in @($buildTask, $watchTask)) {
      $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      if (-not $task) { Write-Host "'$name': not registered"; continue }
      $info = Get-ScheduledTaskInfo -TaskName $name
      Write-Host ("'{0}': {1}; last run {2} (result {3}); next run {4}" -f $name, $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
    }
  }
}
