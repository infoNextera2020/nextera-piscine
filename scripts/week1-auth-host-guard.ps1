param(
    [switch]$Execute,
    [switch]$Install,
    [switch]$Probe,
    [switch]$ProbeChild,
    [switch]$Complete,
    [string]$ProbeNonce,
    [int]$GuardPid,
    [long]$GuardStartedTicks,
    [string]$GuardSourceSha256,
    [string]$ManifestJsonBase64,
    [string]$ManifestPath,
    [string]$ManifestSha256,
    [long]$MonotonicDeadlineTicks
)
$ErrorActionPreference = 'Stop'
# Capture before manifest/source/cache work. Absolute Stopwatch ticks have the same
# origin/frequency in the Install and Execute processes on this Windows host.
$script:EntryTicks = [Diagnostics.Stopwatch]::GetTimestamp()
$script:EntryUtc = [DateTimeOffset]::UtcNow
$script:TickFrequency = [Diagnostics.Stopwatch]::Frequency
$script:ClientCleanupReserveMs = 250
$script:ReportReserveMs = 1000
$ProfileId = 'week1-auth-20261031-smtp1'
$OwnedRoot = '/home/anas/.local/share/nextera-judge/week1-auth-20261031-smtp1/run-001'
$DockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$WindowsPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$LocalEndpoint = 'npipe:////./pipe/docker_engine'

function Assert-Week1Manifest($m) {
    if ($m.version -ne 1 -or $m.profile -cne $ProfileId -or $m.root -cne $OwnedRoot -or
        $m.project -cne ('01coding-' + $ProfileId) -or $m.scopeSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $m.sourceLockSha256 -cnotmatch '^[a-f0-9]{64}$' -or $m.reviewedHead -cnotmatch '^[a-f0-9]{40}$' -or
        $m.engineId -cnotmatch '^[A-Za-z0-9:_-]{8,128}$' -or $m.dockerCliSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Host manifest binding rejected.' }
    $start = [DateTimeOffset]::ParseExact($m.startedUtc, 'o', [Globalization.CultureInfo]::InvariantCulture)
    $deadline = [DateTimeOffset]::ParseExact($m.deadlineUtc, 'o', [Globalization.CultureInfo]::InvariantCulture)
    $cutoff = [DateTimeOffset]::ParseExact($m.cleanupAtUtc, 'o', [Globalization.CultureInfo]::InvariantCulture)
    if (($deadline - $start).TotalSeconds -ne 3600 -or ($deadline - $cutoff).TotalSeconds -ne 180 -or
        @($m.services.psobject.Properties).Count -ne 8 -or @($m.baselineContainerIds | Where-Object { $_ -cnotmatch '^[a-f0-9]{64}$' }).Count) { throw 'Host deadline/resources rejected.' }
    foreach ($entry in $m.services.psobject.Properties) {
        if ($entry.Name -cnotin @('db','auth','rest','storage','imgproxy','meta','studio','api-gw') -or $entry.Value -cnotmatch '^.+@sha256:[a-f0-9]{64}$') { throw 'Host image scope rejected.' }
    }
    return $cutoff
}

function Get-Week1OwnedRows($m, $engineId, $rows) {
    Assert-Week1Manifest $m | Out-Null
    if ($engineId -cne $m.engineId) { throw 'Docker engine changed; no action.' }
    $seen = @{}
    foreach ($r in $rows) {
        if ($r.id -cnotmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($r.id) -or $r.id -cin $m.baselineContainerIds -or
            $r.project -cne $m.project -or $r.profile -cne $m.profile -or $r.scope -cne $m.scopeSha256 -or
            $r.root -cne $m.root -or $r.source -cne $m.sourceLockSha256 -or
            $r.workingDirectory -cne ($m.root + '/stack') -or $r.service -cnotin @('db','auth','rest','storage','imgproxy','meta','studio','api-gw') -or
            $r.image -cne $m.services.($r.service) -or $r.restart -cne 'no') { throw 'Container identity/ownership rejected; no action.' }
        $seen[$r.id] = $true
    }
    return @($rows)
}

function Get-Week1StopDecision($m, [DateTimeOffset]$Now, [long]$ElapsedMs, [long]$InitialRemainingMs) {
    $cutoff = Assert-Week1Manifest $m
    if ($ElapsedMs -lt 0 -or $InitialRemainingMs -le 0 -or $InitialRemainingMs -gt 3420000) { throw 'Invalid monotonic budget.' }
    return ($Now -ge $cutoff -or $ElapsedMs -ge $InitialRemainingMs)
}

function New-Week1HostBudget($m, [DateTimeOffset]$AnchorUtc, [long]$AnchorTicks, [long]$Frequency, [long]$InheritedDeadlineTicks = 0) {
    $cutoff = Assert-Week1Manifest $m
    $start = [DateTimeOffset]::ParseExact($m.startedUtc, 'o', [Globalization.CultureInfo]::InvariantCulture)
    $deadline = [DateTimeOffset]::ParseExact($m.deadlineUtc, 'o', [Globalization.CultureInfo]::InvariantCulture)
    $remaining = [long][Math]::Floor(($deadline - $AnchorUtc).TotalMilliseconds)
    if ($AnchorUtc -lt $start -or $remaining -le 0 -or $remaining -gt 3600000 -or $AnchorTicks -lt 0 -or $Frequency -le 0 -or $InheritedDeadlineTicks -lt 0) { throw 'Original host budget rejected.' }
    $end = $AnchorTicks + [long][Math]::Floor(([decimal]$remaining * $Frequency) / 1000)
    if ($InheritedDeadlineTicks -gt 0) { $end = [Math]::Min($end, $InheritedDeadlineTicks) }
    return [pscustomobject]@{deadlineUtc=$deadline;deadlineTicks=$end;anchorTicks=$AnchorTicks;frequency=$Frequency;cleanupUtc=$cutoff;cleanupTicks=($end - 180 * $Frequency)}
}

function Get-Week1RemainingMs($Budget, [DateTimeOffset]$NowUtc, [long]$NowTicks, [long]$ReserveMs = 0) {
    if ($null -eq $Budget -or $Budget.frequency -le 0 -or $NowTicks -lt $Budget.anchorTicks -or $ReserveMs -lt 0) { throw 'Immutable host clock budget rejected.' }
    $wall = [long][Math]::Floor(($Budget.deadlineUtc - $NowUtc).TotalMilliseconds)
    $mono = [long][Math]::Floor(([decimal]($Budget.deadlineTicks - $NowTicks) * 1000) / $Budget.frequency)
    return [long][Math]::Max(0, ([Math]::Min($wall, $mono) - $ReserveMs))
}

function Limit-Week1Budget($Budget, [DateTimeOffset]$NowUtc, [long]$NowTicks, [long]$MaximumMs) {
    if ($MaximumMs -lt 0) { throw 'Invalid child budget.' }
    $duration = [Math]::Min((Get-Week1RemainingMs $Budget $NowUtc $NowTicks), $MaximumMs)
    return [pscustomobject]@{deadlineUtc=$NowUtc.AddMilliseconds($duration);deadlineTicks=($NowTicks + [long][Math]::Floor(([decimal]$duration * $Budget.frequency) / 1000));anchorTicks=$Budget.anchorTicks;frequency=$Budget.frequency}
}

function Get-Week1CleanupBudget($Budget) {
    return [pscustomobject]@{deadlineUtc=$Budget.cleanupUtc;deadlineTicks=$Budget.cleanupTicks;anchorTicks=$Budget.anchorTicks;frequency=$Budget.frequency}
}

function Read-Week1Clock { return @{utc=[DateTimeOffset]::UtcNow;ticks=[Diagnostics.Stopwatch]::GetTimestamp()} }

function Wait-Week1DockerClient($Process, $Budget, [scriptblock]$ReadClock, [scriptblock]$WaitTasks) {
    # Bounded parallel reads avoid both pipe deadlock and unbounded ReadToEndAsync.
    $streams = @(
        @{reader=$Process.StandardOutput;buffer=[char[]]::new(4096);text=[Text.StringBuilder]::new();task=$null;done=$false},
        @{reader=$Process.StandardError;buffer=[char[]]::new(4096);text=[Text.StringBuilder]::new();task=$null;done=$false}
    )
    try {
        $now = & $ReadClock
        if ((Get-Week1RemainingMs $Budget $now.utc $now.ticks $script:ClientCleanupReserveMs) -le 0) { throw 'Docker client budget expired before drain.' }
        foreach ($stream in $streams) { $stream.task = $stream.reader.ReadAsync($stream.buffer, 0, $stream.buffer.Length) }
        while ($true) {
            $now = & $ReadClock
            $remaining = Get-Week1RemainingMs $Budget $now.utc $now.ticks $script:ClientCleanupReserveMs
            if ($remaining -le 0) { throw 'Docker client wait/drain timed out; daemon outcome unverified.' }
            foreach ($stream in $streams) {
                if (-not $stream.done -and $stream.task.IsCompleted) {
                    # GetResult is used ONLY after completion; it cannot wait for a held-open pipe.
                    $read = $stream.task.GetAwaiter().GetResult()
                    if ($read -eq 0) { $stream.done = $true }
                    else {
                        if (($streams[0].text.Length + $streams[1].text.Length + $read) -gt 1048576) { throw 'Docker output bound exceeded; inventory incomplete.' }
                        [void]$stream.text.Append($stream.buffer, 0, $read)
                        $stream.task = $stream.reader.ReadAsync($stream.buffer, 0, $stream.buffer.Length)
                    }
                }
            }
            if ($Process.HasExited -and $streams[0].done -and $streams[1].done) { break }
            $now = & $ReadClock
            $wait = [int][Math]::Min(50, (Get-Week1RemainingMs $Budget $now.utc $now.ticks $script:ClientCleanupReserveMs))
            if ($wait -le 0) { throw 'Docker client budget expired before wait.' }
            $pending = @($streams | Where-Object { -not $_.done } | ForEach-Object { $_.task })
            if ($pending.Count) { & $WaitTasks -Tasks $pending -Milliseconds $wait | Out-Null }
            else { [void]$Process.WaitForExit($wait) }
        }
        $now = & $ReadClock
        if ((Get-Week1RemainingMs $Budget $now.utc $now.ticks) -le 0 -or $Process.ExitCode -ne 0) { throw 'Docker completion late or unsuccessful; daemon outcome unverified.' }
        return $streams[0].text.ToString().Trim()
    } catch {
        # Only this exact child Process object is signalled. A killed CLI does NOT
        # prove the daemon stopped a container, nor does an OS call have a realtime guarantee.
        if (-not $Process.HasExited) {
            $Process.Kill()
            $now = & $ReadClock
            $reap = [int][Math]::Min($script:ClientCleanupReserveMs, (Get-Week1RemainingMs $Budget $now.utc $now.ticks))
            if ($reap -gt 0) { [void]$Process.WaitForExit($reap) }
        }
        throw
    }
}

function Set-OwnerOnlyAcl([string]$Path) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner($sid)
    $inherit = if ((Get-Item -LiteralPath $Path).PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-HostMetadata([string]$File, $Value) {
    $text = ($Value | ConvertTo-Json -Depth 12 -Compress) + "`n"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
    $stream = [IO.File]::Open($File, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Set-OwnerOnlyAcl $File
}

function Invoke-LocalDocker([string[]]$Arguments, $Budget) {
    $now = Read-Week1Clock
    if ($null -eq $Budget) { throw 'An explicit original Docker budget is required.' }
    $operation = Limit-Week1Budget $Budget $now.utc $now.ticks 15000
    if ((Get-FileHash -LiteralPath $DockerCli -Algorithm SHA256).Hash.ToLowerInvariant() -cne $script:BoundDockerSha256) { throw 'Docker executable changed.' }
    # Fixed local named-pipe endpoint on EVERY call; no context/global settings.
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $DockerCli
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $all = @('--host', $LocalEndpoint) + $Arguments
    # Arguments contain fixed verbs, labels, and hex IDs only. Never credentials.
    foreach ($item in $all) { if ($item -match '["\r\n]') { throw 'Invalid Docker argument.' } }
    $psi.Arguments = ($all | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $p = [Diagnostics.Process]::new(); $p.StartInfo = $psi
    try {
        $now = Read-Week1Clock
        if ((Get-Week1RemainingMs $operation $now.utc $now.ticks $script:ClientCleanupReserveMs) -le 0) { throw 'No Docker dispatch after original budget.' }
        if (-not $p.Start()) { throw 'Host Docker start failed.' }
        $readClock = { Read-Week1Clock }
        $waitTasks = { param($Tasks, [int]$Milliseconds) [Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$Tasks, $Milliseconds) }
        return Wait-Week1DockerClient $p $operation $readClock $waitTasks
    } finally { $p.Dispose() }
}

function Invoke-Week1BoundDocker($m, [scriptblock]$InvokeDocker, [string[]]$Arguments, $Budget) {
    if ($null -eq $Budget) { throw 'An explicit original Docker budget is required.' }
    $engine = & $InvokeDocker -Arguments @('info','--format','{{.ID}}') -Budget $Budget
    if ($engine -cne $m.engineId) { throw 'Docker engine changed before action.' }
    return (& $InvokeDocker -Arguments $Arguments -Budget $Budget)
}

function Read-Week1Container($m, [scriptblock]$InvokeDocker, [string]$Id, $Budget) {
    if ($Id -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid exact container ID.' }
    $format = '{{json .Id}}|{{json .State.Running}}|{{json .Config.Labels}}|{{json .Config.Image}}|{{json .HostConfig.RestartPolicy.Name}}'
    $parts = (Invoke-Week1BoundDocker $m $InvokeDocker @('inspect','--format',$format,$Id) $Budget) -split '\|'
    if ($parts.Length -ne 5) { throw 'Container metadata malformed.' }
    $labels = $parts[2] | ConvertFrom-Json
    $row = [pscustomobject]@{id=($parts[0]|ConvertFrom-Json);running=($parts[1]|ConvertFrom-Json);project=$labels.'com.docker.compose.project';service=$labels.'com.docker.compose.service';workingDirectory=$labels.'com.docker.compose.project.working_dir';profile=$labels.'io.nextera.week1.profile';scope=$labels.'io.nextera.week1.scope';root=$labels.'io.nextera.week1.root';source=$labels.'io.nextera.week1.source';image=($parts[3]|ConvertFrom-Json);restart=($parts[4]|ConvertFrom-Json)}
    if ($row.id -cne $Id -or $row.running -isnot [bool]) { throw 'Exact container identity/state rejected.' }
    Get-Week1OwnedRows $m $m.engineId @($row) | Out-Null
    return $row
}

function Invoke-Week1OwnedSweep($m, [scriptblock]$InvokeDocker, $Budget, [scriptblock]$ReadClock) {
    if ($null -eq $Budget -or $null -eq $ReadClock) { throw 'An explicit original sweep budget/clock is required.' }
    $now = & $ReadClock
    $available = Get-Week1RemainingMs $Budget $now.utc $now.ticks
    if ($available -le 0) { throw 'No owned sweep after original budget.' }
    # Inventory cannot spend the time reserved for identity rechecks, stop and verification.
    $inventory = Limit-Week1Budget $Budget $now.utc $now.ticks ([long][Math]::Floor($available / 3))
    $raw = Invoke-Week1BoundDocker $m $InvokeDocker @('ps','-aq','--no-trunc','--filter',('label=com.docker.compose.project=' + $m.project)) $inventory
    $ids = @($raw -split "`n" | Where-Object { $_ })
    $rows = @()
    foreach ($id in $ids) { $rows += Read-Week1Container $m $InvokeDocker $id $inventory }
    Get-Week1OwnedRows $m $m.engineId $rows | Out-Null
    $stopped = @()
    foreach ($row in $rows) {
        # Reinspect full identity/labels immediately before EACH stop. The fixed
        # endpoint's Engine ID is checked again by every bound command.
        $current = Read-Week1Container $m $InvokeDocker $row.id $Budget
        if ($current.running) {
            Invoke-Week1BoundDocker $m $InvokeDocker @('stop','--time','5',$current.id) $Budget | Out-Null
        }
        $after = Read-Week1Container $m $InvokeDocker $row.id $Budget
        if ($after.running) { throw 'Owned container still running after stop.' }
        $stopped += $after.id
    }
    $now = & $ReadClock
    if ((Get-Week1RemainingMs $Budget $now.utc $now.ticks) -le 0) { throw 'Owned verification completed after its budget.' }
    return [pscustomobject]@{observedIds=$ids;stoppedIds=$stopped;allStopped=$true;observedAtUtc=$now.utc;observedAtTicks=$now.ticks;inventoryComplete=$true}
}

function Invoke-Week1Cleanup($m, $Budget, [scriptblock]$InvokeDocker, [scriptblock]$ReadClock, [scriptblock]$Pause, [scriptblock]$Record) {
    $now = & $ReadClock
    $available = Get-Week1RemainingMs $Budget $now.utc $now.ticks $script:ReportReserveMs
    $workBudget = Limit-Week1Budget $Budget $now.utc $now.ticks $available
    $stopped = @(); $errors = @(); $pass = 0; $final = $null
    while ($true) {
        $now = & $ReadClock
        if ((Get-Week1RemainingMs $workBudget $now.utc $now.ticks) -le 1000) { break }
        $final = $null
        try {
            $sweep = Invoke-Week1OwnedSweep $m $InvokeDocker $workBudget $ReadClock
            $stopped += $sweep.stoppedIds
            & $Record -Pass $pass -Value $sweep | Out-Null
            $final = $sweep
        } catch { $errors += ('owned_host_stop_unverified_pass_' + $pass) }
        $pass++
        $now = & $ReadClock
        $wait = [int][Math]::Min(500, (Get-Week1RemainingMs $workBudget $now.utc $now.ticks))
        if ($wait -gt 0) { & $Pause -Milliseconds $wait | Out-Null }
    }
    $now = & $ReadClock
    $observedComplete = ($null -ne $final -and $final.allStopped -and $final.inventoryComplete -and $errors.Count -eq 0 -and (Get-Week1RemainingMs $Budget $now.utc $now.ticks) -gt 0)
    if (-not $observedComplete) { $errors += 'newest_owned_state_or_deadline_unverified' }
    # Only an external observer could verify exit/persistence time. Even a full
    # on-time observation cannot exclude a late daemon create or a later OS/FS stall.
    $uncertain = if ($observedComplete) { $null } else { $false }
    return [pscustomobject]@{scopeSha256=$m.scopeSha256;stoppedIds=@($stopped | Select-Object -Unique);lastObservedIds=$final.observedIds;lastObservedAllStopped=$observedComplete;observedAtUtc=$final.observedAtUtc;inventoryComplete=($null -ne $final -and $final.inventoryComplete);finalStopped=$uncertain;deadlineMet=$uncertain;sourceWorkCompletedBeforeDeadline=$observedComplete;deadlineObservedAtUtc=$now.utc;physicalDeadlineGuaranteed=$false;lateCreationExcluded=$false;retained=$true;noPermanentDeletion=$true;revocationVerified=$false;revocationStatus='UNVERIFIED_HOST_STOP_ONLY';errors=$errors}
}


function Start-Week1HostChild([string]$ScriptFile, [string[]]$ChildArguments) {
    $windowsPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',$ScriptFile) + $ChildArguments
    foreach ($item in $arguments) { if ($item -match '["\r\n]') { throw 'Invalid fixed child argument.' } }
    return Start-Process -FilePath $windowsPowerShell -ArgumentList ($arguments | ForEach-Object { '"' + $_ + '"' }) -WindowStyle Hidden -PassThru
}

function Assert-Week1GuardIdentity($sealed, [int]$ProcessId, [long]$StartedTicks, [string]$SourceSha256) {
    if ($ProcessId -le 0 -or $StartedTicks -le 0 -or $SourceSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $sealed.pid -ne $ProcessId -or $sealed.startedTicks -ne $StartedTicks -or
        $sealed.guardSourceSha256 -cne $SourceSha256) { throw 'Exact sealed native guard identity rejected.' }
    return $true
}

function Stop-Week1SealedGuardProcess($Owned, [long]$ExpectedTicks, [string]$ExpectedPath) {
    # Force acquisition/retention BEFORE identity checks. Kill/Wait use this exact
    # Process object and its pinned handle, never another lookup by numeric PID.
    $verifiedHandle = $Owned.Handle
    if ($verifiedHandle -eq [IntPtr]::Zero -or $Owned.StartTime.ToUniversalTime().Ticks -ne $ExpectedTicks -or
        $Owned.Path -ine $ExpectedPath) { throw 'Pinned native process identity rejected; no stop.' }
    if (-not $Owned.HasExited) { $Owned.Kill() }
    if (-not $Owned.WaitForExit(5000)) { throw 'Exact native guard exit unverified.' }
    return $true
}

if ($ProbeChild) {
    if ($Install -or $Execute -or $Complete -or $Probe -or $ProbeNonce -cnotmatch '^[a-f0-9]{64}$') { throw 'Public child probe rejected.' }
    exit 0
}

if ($Probe) {
    if ($Install -or $Execute -or $Complete -or $ProbeNonce -cnotmatch '^[a-f0-9]{64}$') { throw 'Public native probe rejected.' }
    $script:BoundDockerSha256 = (Get-FileHash -LiteralPath $DockerCli -Algorithm SHA256).Hash.ToLowerInvariant()
    $probeBudget = [pscustomobject]@{deadlineUtc=$script:EntryUtc.AddMilliseconds(15000);deadlineTicks=($script:EntryTicks + 15 * $script:TickFrequency);anchorTicks=$script:EntryTicks;frequency=$script:TickFrequency}
    $engine = Invoke-LocalDocker -Arguments @('info','--format','{{.ID}}') -Budget $probeBudget
    $child = Start-Week1HostChild $PSCommandPath @('-ProbeChild','-ProbeNonce',$ProbeNonce)
    $childTicks = $child.StartTime.ToUniversalTime().Ticks
    if (-not $child.WaitForExit(10000)) { $child.Kill(); throw 'Actual native child probe timed out; no retry.' }
    if ($child.ExitCode -ne 0) { throw 'Actual native child probe failed.' }
    @{ready=$true;nonce=$ProbeNonce;engineId=$engine;dockerSha=$script:BoundDockerSha256;childPid=$child.Id;childStartedTicks=$childTicks;childExited=$true;guardSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Compress
    exit 0
}

if ($Complete) {
    if ($Install -or $Execute -or -not $ManifestPath -or $ManifestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Exact normal cleanup binding required.' }
    $cache = Split-Path -Parent $ManifestPath
    if ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Host cache reparse point rejected.' }
    if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256) { throw 'Host manifest hash mismatch.' }
    $m = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
    Assert-Week1Manifest $m | Out-Null
    $expectedCache = Join-Path $env:TEMP ('nextera-' + $ProfileId + '-' + $m.scopeSha256.Substring(0,16))
    if ([IO.Path]::GetFullPath($cache) -ine [IO.Path]::GetFullPath($expectedCache)) { throw 'Foreign host cache rejected.' }
    $sealed = [IO.File]::ReadAllText((Join-Path $cache 'guard-record.json')) | ConvertFrom-Json
    Assert-Week1GuardIdentity $sealed $GuardPid $GuardStartedTicks $GuardSourceSha256 | Out-Null
    if ($sealed.scopeSha256 -cne $m.scopeSha256 -or $sealed.manifestSha256 -cne $ManifestSha256 -or
        (Get-FileHash -LiteralPath (Join-Path $cache 'host-guard.ps1') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $GuardSourceSha256) { throw 'Changed native guard seal/source rejected.' }
    $owned = Get-Process -Id $GuardPid -ErrorAction SilentlyContinue
    if ($null -ne $owned) {
        $fixedPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        Stop-Week1SealedGuardProcess $owned $GuardStartedTicks $fixedPowerShell | Out-Null
    }
    $ack = @{guardStopped=$true;pid=$GuardPid;startedTicks=$GuardStartedTicks;scopeSha256=$m.scopeSha256;manifestSha256=$ManifestSha256;guardSourceSha256=$GuardSourceSha256}
    Write-HostMetadata (Join-Path $cache 'normal-cleanup.json') $ack
    $ack | ConvertTo-Json -Compress
    exit 0
}

if ($Install) {
    if (-not $ManifestJsonBase64 -or $Execute) { throw 'Explicit source-bound manifest required.' }
    $bytes = [Convert]::FromBase64String($ManifestJsonBase64)
    if ($bytes.Length -gt 65536) { throw 'Manifest too large.' }
    $m = [Text.UTF8Encoding]::new($false,$true).GetString($bytes) | ConvertFrom-Json
    $cutoff = Assert-Week1Manifest $m
    $budget = New-Week1HostBudget $m $script:EntryUtc $script:EntryTicks $script:TickFrequency
    $admissionBudget = Get-Week1CleanupBudget $budget
    $now = Read-Week1Clock
    if ((Get-Week1RemainingMs $admissionBudget $now.utc $now.ticks) -le 0) { throw 'Host admission cutoff reached.' }
    $script:BoundDockerSha256 = $m.dockerCliSha256
    if ((Invoke-LocalDocker -Arguments @('info','--format','{{.ID}}') -Budget $admissionBudget) -cne $m.engineId) { throw 'WSL/Windows Docker engine IDs differ.' }
    $cache = Join-Path $env:TEMP ('nextera-' + $ProfileId + '-' + $m.scopeSha256.Substring(0,16))
    if (Test-Path -LiteralPath $cache) { throw 'Host guard scope cache already exists; do not reuse.' }
    New-Item -ItemType Directory -Path $cache | Out-Null
    Set-OwnerOnlyAcl $cache
    $scriptPath = Join-Path $cache 'host-guard.ps1'
    [IO.File]::Copy($PSCommandPath, $scriptPath, $false); Set-OwnerOnlyAcl $scriptPath
    $manifestFile = Join-Path $cache 'manifest.json'; Write-HostMetadata $manifestFile $m
    $manifestHash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $now = Read-Week1Clock
    if ((Get-Week1RemainingMs $admissionBudget $now.utc $now.ticks) -le 0) { throw 'Host preparation consumed original admission budget.' }
    $p = Start-Week1HostChild $scriptPath @('-Execute','-ManifestPath',$manifestFile,'-ManifestSha256',$manifestHash,'-MonotonicDeadlineTicks',[string]$budget.deadlineTicks)
    $guardSourceHash = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $guardTicks = $p.StartTime.ToUniversalTime().Ticks
    Write-HostMetadata (Join-Path $cache 'guard-record.json') @{pid=$p.Id;startedTicks=$guardTicks;scopeSha256=$m.scopeSha256;manifestSha256=$manifestHash;guardSourceSha256=$guardSourceHash}
    $ready = Join-Path $cache 'ready.json'
    for ($n=0; $n -lt 100 -and -not (Test-Path -LiteralPath $ready); $n++) {
        $now = Read-Week1Clock
        $wait = [int][Math]::Min(50, (Get-Week1RemainingMs $admissionBudget $now.utc $now.ticks))
        if ($wait -le 0) { break }
        Start-Sleep -Milliseconds $wait
    }
    if (-not (Test-Path -LiteralPath $ready)) { throw 'Independent host guard not ready.' }
    $now = Read-Week1Clock
    if ((Get-Week1RemainingMs $admissionBudget $now.utc $now.ticks) -le 0) { throw 'Host ready acknowledgement after original admission budget.' }
    @{profile=$ProfileId;scopeSha256=$m.scopeSha256;engineId=$m.engineId;pid=$p.Id;startedTicks=$guardTicks;cache=$cache;manifestSha256=$manifestHash;guardSourceSha256=$guardSourceHash;ready=$true} | ConvertTo-Json -Compress
    exit 0
}

if ($Execute) {
    if (-not $ManifestPath -or $ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or $MonotonicDeadlineTicks -le 0) { throw 'Pinned private host manifest and inherited monotonic budget required.' }
    $cache = Split-Path -Parent $ManifestPath
    if ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Host cache reparse point rejected.' }
    if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256) { throw 'Host manifest hash mismatch.' }
    $m = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
    $budget = New-Week1HostBudget $m $script:EntryUtc $script:EntryTicks $script:TickFrequency $MonotonicDeadlineTicks
    $cleanupBudget = Get-Week1CleanupBudget $budget
    $now = Read-Week1Clock
    $script:BoundDockerSha256 = $m.dockerCliSha256
    if ((Get-Week1RemainingMs $cleanupBudget $now.utc $now.ticks) -gt 0) {
        Write-HostMetadata (Join-Path $cache 'ready.json') @{scopeSha256=$m.scopeSha256;engineId=$m.engineId;pid=$PID;deadlineUtc=$m.deadlineUtc;monotonicDeadlineTicks=$budget.deadlineTicks;revocationVerified=$false}
    }
    while ($true) {
        $now = Read-Week1Clock
        $wait = [int][Math]::Min(500, (Get-Week1RemainingMs $cleanupBudget $now.utc $now.ticks))
        if ($wait -le 0) { break }
        Start-Sleep -Milliseconds $wait
    }
    $readClock = { Read-Week1Clock }
    $invoke = { param([string[]]$Arguments, $Budget) Invoke-LocalDocker -Arguments $Arguments -Budget $Budget }
    # Repeated discovery catches partial/late creates after a lost WSL compose
    # response. This guard keeps the ORIGINAL monotonic lifetime; it never renews.
    $pause = { param([int]$Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    $record = { param([int]$Pass, $Value) Write-HostMetadata (Join-Path $cache ('owned-containers-' + $Pass + '.json')) @{scopeSha256=$m.scopeSha256;ids=$Value.observedIds;allStopped=$Value.allStopped;observedAtUtc=$Value.observedAtUtc;inventoryComplete=$Value.inventoryComplete} }
    $shutdown = Invoke-Week1Cleanup $m $budget $invoke $readClock $pause $record
    Write-HostMetadata (Join-Path $cache 'shutdown.json') $shutdown
    exit $(if ($shutdown.errors.Count) { 1 } else { 0 })
}

# Dot-sourcing exposes pure functions for injected tests. No file/Docker/process I/O.
if ($MyInvocation.InvocationName -ne '.') { @{profile=$ProfileId;status='source_only_not_authorized';runtimeReady=$false} | ConvertTo-Json -Compress }
