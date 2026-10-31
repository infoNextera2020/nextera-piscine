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
    [string]$ManifestSha256
)
$ErrorActionPreference = 'Stop'
$ProfileId = 'week1-auth-20261030-invitation1'
$OwnedRoot = '/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-002'
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

function Invoke-LocalDocker([string[]]$Arguments) {
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
    if (-not $p.Start()) { throw 'Host Docker start failed.' }
    $stdout = $p.StandardOutput.ReadToEndAsync(); $stderr = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'Host Docker operation timed out.' }
    if ($p.ExitCode -ne 0) { throw 'Host Docker operation failed; no raw diagnostics returned.' }
    return $stdout.GetAwaiter().GetResult().Trim()
}

function Invoke-Week1BoundDocker($m, [scriptblock]$InvokeDocker, [string[]]$Arguments) {
    $engine = & $InvokeDocker -Arguments @('info','--format','{{.ID}}')
    if ($engine -cne $m.engineId) { throw 'Docker engine changed before action.' }
    return (& $InvokeDocker -Arguments $Arguments)
}

function Read-Week1Container($m, [scriptblock]$InvokeDocker, [string]$Id) {
    if ($Id -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid exact container ID.' }
    $format = '{{json .Id}}|{{json .State.Running}}|{{json .Config.Labels}}|{{json .Config.Image}}|{{json .HostConfig.RestartPolicy.Name}}'
    $parts = (Invoke-Week1BoundDocker $m $InvokeDocker @('inspect','--format',$format,$Id)) -split '\|'
    if ($parts.Length -ne 5) { throw 'Container metadata malformed.' }
    $labels = $parts[2] | ConvertFrom-Json
    $row = [pscustomobject]@{id=($parts[0]|ConvertFrom-Json);running=($parts[1]|ConvertFrom-Json);project=$labels.'com.docker.compose.project';service=$labels.'com.docker.compose.service';workingDirectory=$labels.'com.docker.compose.project.working_dir';profile=$labels.'io.nextera.week1.profile';scope=$labels.'io.nextera.week1.scope';root=$labels.'io.nextera.week1.root';source=$labels.'io.nextera.week1.source';image=($parts[3]|ConvertFrom-Json);restart=($parts[4]|ConvertFrom-Json)}
    if ($row.id -cne $Id -or $row.running -isnot [bool]) { throw 'Exact container identity/state rejected.' }
    Get-Week1OwnedRows $m $m.engineId @($row) | Out-Null
    return $row
}

function Invoke-Week1OwnedSweep($m, [scriptblock]$InvokeDocker) {
    $raw = Invoke-Week1BoundDocker $m $InvokeDocker @('ps','-aq','--no-trunc','--filter',('label=com.docker.compose.project=' + $m.project))
    $ids = @($raw -split "`n" | Where-Object { $_ })
    $rows = @()
    foreach ($id in $ids) { $rows += Read-Week1Container $m $InvokeDocker $id }
    Get-Week1OwnedRows $m $m.engineId $rows | Out-Null
    $stopped = @()
    foreach ($row in $rows) {
        # Reinspect full identity/labels immediately before EACH stop. The fixed
        # endpoint's Engine ID is checked again by every bound command.
        $current = Read-Week1Container $m $InvokeDocker $row.id
        if ($current.running) {
            Invoke-Week1BoundDocker $m $InvokeDocker @('stop','--time','5',$current.id) | Out-Null
        }
        $after = Read-Week1Container $m $InvokeDocker $row.id
        if ($after.running) { throw 'Owned container still running after stop.' }
        $stopped += $after.id
    }
    return [pscustomobject]@{observedIds=$ids;stoppedIds=$stopped;allStopped=$true}
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
    $engine = Invoke-LocalDocker @('info','--format','{{.ID}}')
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
    if ([DateTimeOffset]::UtcNow -ge $cutoff) { throw 'Host admission cutoff reached.' }
    $script:BoundDockerSha256 = $m.dockerCliSha256
    if ((Invoke-LocalDocker @('info','--format','{{.ID}}')) -cne $m.engineId) { throw 'WSL/Windows Docker engine IDs differ.' }
    $cache = Join-Path $env:TEMP ('nextera-' + $ProfileId + '-' + $m.scopeSha256.Substring(0,16))
    if (Test-Path -LiteralPath $cache) { throw 'Host guard scope cache already exists; do not reuse.' }
    New-Item -ItemType Directory -Path $cache | Out-Null
    Set-OwnerOnlyAcl $cache
    $scriptPath = Join-Path $cache 'host-guard.ps1'
    [IO.File]::Copy($PSCommandPath, $scriptPath, $false); Set-OwnerOnlyAcl $scriptPath
    $manifestFile = Join-Path $cache 'manifest.json'; Write-HostMetadata $manifestFile $m
    $manifestHash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $p = Start-Week1HostChild $scriptPath @('-Execute','-ManifestPath',$manifestFile,'-ManifestSha256',$manifestHash)
    $guardSourceHash = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $guardTicks = $p.StartTime.ToUniversalTime().Ticks
    Write-HostMetadata (Join-Path $cache 'guard-record.json') @{pid=$p.Id;startedTicks=$guardTicks;scopeSha256=$m.scopeSha256;manifestSha256=$manifestHash;guardSourceSha256=$guardSourceHash}
    $ready = Join-Path $cache 'ready.json'
    for ($n=0; $n -lt 100 -and -not (Test-Path -LiteralPath $ready); $n++) { Start-Sleep -Milliseconds 50 }
    if (-not (Test-Path -LiteralPath $ready)) { throw 'Independent host guard not ready.' }
    @{profile=$ProfileId;scopeSha256=$m.scopeSha256;engineId=$m.engineId;pid=$p.Id;startedTicks=$guardTicks;cache=$cache;manifestSha256=$manifestHash;guardSourceSha256=$guardSourceHash;ready=$true} | ConvertTo-Json -Compress
    exit 0
}

if ($Execute) {
    if (-not $ManifestPath -or $ManifestSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Pinned private host manifest required.' }
    $cache = Split-Path -Parent $ManifestPath
    if ((Get-Item -LiteralPath $cache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Host cache reparse point rejected.' }
    if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256) { throw 'Host manifest hash mismatch.' }
    $m = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
    $cutoff = Assert-Week1Manifest $m
    $script:BoundDockerSha256 = $m.dockerCliSha256
    $remaining = [long][Math]::Floor(($cutoff - [DateTimeOffset]::UtcNow).TotalMilliseconds)
    if ($remaining -le 0 -or $remaining -gt 3420000) { throw 'Original host budget expired.' }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Write-HostMetadata (Join-Path $cache 'ready.json') @{scopeSha256=$m.scopeSha256;engineId=$m.engineId;pid=$PID;deadlineUtc=$m.deadlineUtc;revocationVerified=$false}
    while (-not (Get-Week1StopDecision $m ([DateTimeOffset]::UtcNow) $clock.ElapsedMilliseconds $remaining)) { Start-Sleep -Milliseconds 500 }
    $stopped = @(); $errors = @(); $pass = 0; $final = $null
    $invoke = { param([string[]]$Arguments) Invoke-LocalDocker -Arguments $Arguments }
    # Repeated discovery catches partial/late creates after a lost WSL compose
    # response. This guard keeps the ORIGINAL monotonic lifetime; it never renews.
    $originalMonotonicEnd = $remaining + 180000
    do {
        try {
            $sweep = Invoke-Week1OwnedSweep $m $invoke
            $stopped += $sweep.stoppedIds
            Write-HostMetadata (Join-Path $cache ('owned-containers-' + $pass + '.json')) @{scopeSha256=$m.scopeSha256;ids=$sweep.observedIds;allStopped=$sweep.allStopped}
        } catch { $errors += ('owned_host_stop_unverified_pass_' + $pass) }
        $pass++
        if ($clock.ElapsedMilliseconds -lt $originalMonotonicEnd) { Start-Sleep -Milliseconds 500 }
    } while ($clock.ElapsedMilliseconds -lt $originalMonotonicEnd)
    try { $final = Invoke-Week1OwnedSweep $m $invoke } catch { $errors += 'final_owned_state_unverified' }
    Write-HostMetadata (Join-Path $cache 'shutdown.json') @{scopeSha256=$m.scopeSha256;stoppedIds=@($stopped | Select-Object -Unique);finalOwnedIds=$final.observedIds;finalStopped=($null -ne $final -and $final.allStopped);retained=$true;noPermanentDeletion=$true;revocationVerified=$false;revocationStatus='UNVERIFIED_HOST_STOP_ONLY';errors=$errors}
    exit $(if ($errors.Count) { 1 } else { 0 })
}

# Dot-sourcing exposes pure functions for injected tests. No file/Docker/process I/O.
if ($MyInvocation.InvocationName -ne '.') { @{profile=$ProfileId;status='source_only_not_authorized';runtimeReady=$false} | ConvertTo-Json -Compress }
