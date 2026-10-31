param([string]$GuardSource)
$ErrorActionPreference = 'Stop'
if (-not $GuardSource) { $GuardSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'week1-auth-host-guard.ps1' }
. $GuardSource
function Assert-True($value) { if (-not $value) { throw 'Fake host guard assertion failed.' } }
function Assert-Rejected([scriptblock]$work) { $denied = $false; try { & $work | Out-Null } catch { $denied = $true }; Assert-True $denied }
# All inputs are synthetic metadata; no file/process/Docker/provider function is called.
$m = [pscustomobject]@{
    version=1;profile='week1-auth-20261031-smtp1';root='/home/anas/.local/share/nextera-judge/week1-auth-20261031-smtp1/run-001';project='01coding-week1-auth-20261031-smtp1';scopeSha256=('a'*64);sourceLockSha256=('b'*64);reviewedHead=('c'*40);engineId='synthetic-engine-123';dockerCliSha256=('d'*64)
    startedUtc='2026-10-30T12:00:00.0000000+00:00';deadlineUtc='2026-10-30T13:00:00.0000000+00:00';cleanupAtUtc='2026-10-30T12:57:00.0000000+00:00';baselineContainerIds=@(('f'*64));services=[pscustomobject]@{}
}
foreach ($name in @('db','auth','rest','storage','imgproxy','meta','studio','api-gw')) { $m.services | Add-Member -NotePropertyName $name -NotePropertyValue ('fixture.invalid/'+$name+'@sha256:'+('e'*64)) }
$row = [pscustomobject]@{id=('1'*64);running=$true;project=$m.project;profile=$m.profile;scope=$m.scopeSha256;root=$m.root;source=$m.sourceLockSha256;workingDirectory=($m.root+'/stack');service='db';image=$m.services.db;restart='no'}
Assert-True (@(Get-Week1OwnedRows $m $m.engineId @($row)).Count -eq 1)
Assert-Rejected { Get-Week1OwnedRows $m 'different-engine' @($row) }
foreach ($field in @('id','project','profile','scope','root','source','workingDirectory','service','image','restart')) {
    $copy = $row | Select-Object *; $copy.$field = 'foreign-or-tampered'
    Assert-Rejected { Get-Week1OwnedRows $m $m.engineId @($copy) }
}
$copy = $row | Select-Object *; $copy.id = 'f'*64
Assert-Rejected { Get-Week1OwnedRows $m $m.engineId @($copy) }
Assert-Rejected { Get-Week1OwnedRows $m $m.engineId @($row,$row) }
Assert-True (-not (Get-Week1StopDecision $m ([DateTimeOffset]::Parse('2026-10-30T12:00:00Z')) 10 1000))
Assert-True (Get-Week1StopDecision $m ([DateTimeOffset]::Parse('2026-10-30T12:57:00Z')) 10 1000)
Assert-True (Get-Week1StopDecision $m ([DateTimeOffset]::Parse('2026-10-30T11:00:00Z')) 1000 1000)
$script:FakeRows = @{}
$script:FakeRows[('1'*64)] = ($row | Select-Object *)
$script:FakeCalls = @()
$script:FakeUtc = [DateTimeOffset]::Parse('2026-10-30T12:00:00Z')
$script:FakeTicks = 1000L
$script:FakeCallCostMs = 0L
$script:FakeBudget = New-Week1HostBudget $m $script:FakeUtc $script:FakeTicks 1000
$readFakeClock = { return @{utc=$script:FakeUtc;ticks=$script:FakeTicks} }
function Move-FakeTime([long]$Milliseconds) { $script:FakeTicks += $Milliseconds; $script:FakeUtc = $script:FakeUtc.AddMilliseconds($Milliseconds) }
function Invoke-OnlyFakeDocker([string[]]$Arguments, $Budget) {
    $left = Get-Week1RemainingMs $Budget $script:FakeUtc $script:FakeTicks
    if ($left -le 0) { throw 'Fake dispatch rejected after budget.' }
    $script:FakeCalls += ,@($Arguments)
    if ($script:FakeCallCostMs -gt 0) {
        Move-FakeTime ([Math]::Min($left, $script:FakeCallCostMs))
        if ((Get-Week1RemainingMs $Budget $script:FakeUtc $script:FakeTicks) -le 0) { throw 'Fake slow Docker deadline.' }
    }
    switch ($Arguments[0]) {
        'info' { return $m.engineId }
        'ps' { return (($script:FakeRows.Keys | Sort-Object) -join "`n") }
        'inspect' {
            $r = $script:FakeRows[$Arguments[-1]]
            $labels = @{'com.docker.compose.project'=$r.project;'com.docker.compose.service'=$r.service;'com.docker.compose.project.working_dir'=$r.workingDirectory;'io.nextera.week1.profile'=$r.profile;'io.nextera.week1.scope'=$r.scope;'io.nextera.week1.source'=$r.source;'io.nextera.week1.root'=$r.root}
            return (($r.id|ConvertTo-Json -Compress),($r.running|ConvertTo-Json -Compress),($labels|ConvertTo-Json -Compress),($r.image|ConvertTo-Json -Compress),($r.restart|ConvertTo-Json -Compress)) -join '|'
        }
        'stop' { $script:FakeRows[$Arguments[-1]].running=$false; return $Arguments[-1] }
        default { throw 'Unexpected native-like action in fake.' }
    }
}
$fakeInvoke = { param([string[]]$Arguments, $Budget) Invoke-OnlyFakeDocker -Arguments $Arguments -Budget $Budget }
$firstSweep = Invoke-Week1OwnedSweep $m $fakeInvoke $script:FakeBudget $readFakeClock
Assert-True $firstSweep.allStopped
$late = $row | Select-Object *; $late.id='2'*64; $late.running=$true
$script:FakeRows[$late.id] = $late
$secondSweep = Invoke-Week1OwnedSweep $m $fakeInvoke $script:FakeBudget $readFakeClock
Assert-True ($secondSweep.observedIds.Count -eq 2 -and -not $script:FakeRows[$late.id].running)
Assert-True (@($script:FakeCalls | Where-Object { $_[0] -eq 'stop' }).Count -eq 2)

$sealed = @{pid=1234;startedTicks=987654;guardSourceSha256=('a'*64)}
Assert-True (Assert-Week1GuardIdentity $sealed 1234 987654 ('a'*64))
Assert-Rejected { Assert-Week1GuardIdentity $sealed 4321 987654 ('a'*64) }
Assert-Rejected { Assert-Week1GuardIdentity $sealed 1234 987655 ('a'*64) }
Assert-Rejected { Assert-Week1GuardIdentity $sealed 1234 987654 ('b'*64) }

Assert-True ($WindowsPowerShell -ceq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')

$script:IdentityCalls = @()
$fake = [pscustomobject]@{Path='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';HasExited=$false}
$fake | Add-Member ScriptProperty Handle { $script:IdentityCalls += 'handle'; return [IntPtr]123 }
$fake | Add-Member ScriptProperty StartTime { $script:IdentityCalls += 'identity'; return [DateTime]::new(987654,[DateTimeKind]::Utc) }
$fake | Add-Member ScriptMethod Kill { $script:IdentityCalls += 'kill-exact-object' }
$fake | Add-Member ScriptMethod WaitForExit { param($milliseconds) $script:IdentityCalls += 'wait-exact-object'; return $true }
Assert-True (Stop-Week1SealedGuardProcess $fake 987654 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
Assert-True (($script:IdentityCalls -join ',') -ceq 'handle,identity,kill-exact-object,wait-exact-object')
$script:IdentityCalls = @()
Assert-Rejected { Stop-Week1SealedGuardProcess $fake 987655 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' }
Assert-True ($script:IdentityCalls -cnotcontains 'kill-exact-object')


foreach ($field in @('profile','root','project')) {
    $closed=$m|Select-Object *
    $closed.$field=@{profile='week1-auth-20261030-invitation1';root='/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-002';project='01coding-week1-auth-20261030-invitation1'}[$field]
    Assert-Rejected { Assert-Week1Manifest $closed }
}

# Clock values and all ports below are fake; these tests never create a process,
# touch Docker, execute -Probe/-Install/-Execute, or write a host cache/receipt.
$anchor = [DateTimeOffset]::Parse('2026-10-30T12:00:00Z')
$original = New-Week1HostBudget $m $anchor 1000 1000
Assert-Rejected { New-Week1HostBudget $m $anchor.AddSeconds(-1) 1000 1000 }
Assert-Rejected { New-Week1HostBudget $m $anchor.AddHours(1) 1000 1000 }
Assert-True ((Get-Week1RemainingMs $original $anchor.AddHours(2) 1000) -eq 0)
Assert-True ((Get-Week1RemainingMs $original $anchor.AddMinutes(-30) 3601000) -eq 0)
$child = New-Week1HostBudget $m $anchor.AddMinutes(30) 1801000 1000 $original.deadlineTicks
Assert-True ($child.deadlineTicks -eq $original.deadlineTicks)
Assert-True ((Get-Week1RemainingMs $child $anchor.AddMinutes(10) 3601000) -eq 0)
$expiredParent = New-Week1HostBudget $m $anchor.AddMinutes(30) 1801000 1000 1701000
Assert-True ((Get-Week1RemainingMs $expiredParent $anchor.AddMinutes(30) 1801000) -eq 0)
# Parent disappearance cannot renew the inherited budget; Windows PID liveness is
# deliberately not an input. The separate Linux EOF watcher handles prompt parent loss.
$callsBefore = $script:FakeCalls.Count
Assert-Rejected { Invoke-Week1BoundDocker $m $fakeInvoke @('stop','--time','5',('1'*64)) $null }
Assert-Rejected { Invoke-Week1OwnedSweep $m $fakeInvoke $null $readFakeClock }
Assert-True ($script:FakeCalls.Count -eq $callsBefore)

function New-FakeReader([string]$Text, [bool]$HeldOpen = $false, [bool]$Repeat = $false) {
    $reader = [pscustomobject]@{text=$Text;held=$HeldOpen;repeat=$Repeat;readCalls=0}
    $reader | Add-Member ScriptMethod ReadAsync {
        param([char[]]$Buffer, [int]$Offset, [int]$Count)
        $this.readCalls++
        $completion = [Threading.Tasks.TaskCompletionSource[int]]::new()
        if ($this.held) { return $completion.Task }
        $length = [Math]::Min($Count, $this.text.Length)
        if ($length) { $this.text.CopyTo(0, $Buffer, $Offset, $length) }
        if (-not $this.repeat) { $this.text = $this.text.Substring($length) }
        $completion.SetResult($length)
        return $completion.Task
    }
    return $reader
}
function New-FakeClient([long]$ExitAt, $Output, $ErrorOutput, [bool]$KillLeavesAlive = $false) {
    $client = [pscustomobject]@{exitAt=$ExitAt;StandardOutput=$Output;StandardError=$ErrorOutput;ExitCode=0;killCount=0;killLeavesAlive=$KillLeavesAlive;reapWaits=@()}
    $client | Add-Member ScriptProperty HasExited { return ($this.killCount -gt 0 -and -not $this.killLeavesAlive) -or $script:FakeTicks -ge $this.exitAt }
    $client | Add-Member ScriptMethod Kill { $this.killCount++ }
    $client | Add-Member ScriptMethod WaitForExit {
        param([int]$Milliseconds)
        $this.reapWaits += $Milliseconds
        Move-FakeTime $Milliseconds
        return $this.HasExited
    }
    return $client
}
$script:FakeWaits = @()
$script:FakeWaitOverrunMs = 0
$fakeWaitTasks = {
    param($Tasks, [int]$Milliseconds)
    $script:FakeWaits += $Milliseconds
    foreach ($task in $Tasks) { if ($task.IsCompleted) { return 0 } }
    Move-FakeTime ($Milliseconds + $script:FakeWaitOverrunMs)
    return -1
}
$script:FakeUtc = $anchor
$script:FakeTicks = 1000
$short = Limit-Week1Budget $original $script:FakeUtc $script:FakeTicks 1000
$hung = New-FakeClient 9999999 (New-FakeReader '') (New-FakeReader '') $true
Assert-Rejected { Wait-Week1DockerClient $hung $short $readFakeClock $fakeWaitTasks }
Assert-True ($hung.killCount -eq 1)
Assert-True (@($hung.reapWaits | Where-Object { $_ -gt 250 }).Count -eq 0)
Assert-True ($script:FakeTicks -le $short.deadlineTicks)

$script:FakeUtc = $anchor; $script:FakeTicks = 1000
$held = New-FakeClient 1000 (New-FakeReader '' $true) (New-FakeReader '')
Assert-Rejected { Wait-Week1DockerClient $held $short $readFakeClock $fakeWaitTasks }
Assert-True ($held.killCount -eq 0) # Exited client + held-open stdout is still unverified.
Assert-True ($script:FakeTicks -le $short.deadlineTicks)

$script:FakeUtc = $anchor; $script:FakeTicks = 1000
$oversized = New-FakeClient 1000 (New-FakeReader ('x'*4096) $false $true) (New-FakeReader '')
$outputBound = $false
try { Wait-Week1DockerClient $oversized $short $readFakeClock $fakeWaitTasks | Out-Null }
catch { $outputBound = $_.Exception.Message -like '*Docker output bound exceeded*' }
Assert-True ($outputBound -and $oversized.StandardOutput.readCalls -ge 257 -and $oversized.StandardOutput.readCalls -le 258)

$script:FakeUtc = $anchor; $script:FakeTicks = 1000
$completed = New-FakeClient 1000 (New-FakeReader ' hello ') (New-FakeReader 'public fake diagnostic')
Assert-True ((Wait-Week1DockerClient $completed $short $readFakeClock $fakeWaitTasks) -ceq 'hello')
Assert-True ($completed.killCount -eq 0 -and $script:FakeTicks -eq 1000)

$script:FakeUtc = $anchor; $script:FakeTicks = 1000
$script:FakeWaitOverrunMs = 2000
$overrun = New-FakeClient 9999999 (New-FakeReader '' $true) (New-FakeReader '') $true
Assert-Rejected { Wait-Week1DockerClient $overrun $short $readFakeClock $fakeWaitTasks }
Assert-True ($overrun.killCount -eq 1 -and $overrun.reapWaits.Count -eq 0)
$script:FakeWaitOverrunMs = 0

# Eight valid, slow containers cannot be promised stopped: inventory needs 18
# info/inspect calls, so a 4s/call inventory exhausts its 60s share. No truncation.
$script:FakeUtc = $anchor.AddMinutes(57); $script:FakeTicks = 3421000
$script:FakeCallCostMs = 4000
$script:FakeRows = @{}
foreach ($number in 1..8) {
    $copy = $row | Select-Object *; $copy.id = ('{0:x64}' -f $number); $copy.running = $true
    $script:FakeRows[$copy.id] = $copy
}
$script:FakeCalls = @()
Assert-Rejected { Invoke-Week1OwnedSweep $m $fakeInvoke $original $readFakeClock }
Assert-True (@($script:FakeCalls | Where-Object { $_[0] -eq 'stop' }).Count -eq 0)
Assert-True ((Get-Week1RemainingMs $original $script:FakeUtc $script:FakeTicks) -ge 120000)
Assert-True (@($script:FakeRows.Values | Where-Object { $_.running }).Count -eq 8)

$fakePause = { param([int]$Milliseconds) Move-FakeTime $Milliseconds }
$fakeRecord = { param($Pass,$Value) }
$script:FakeCallCostMs = 0; $script:FakeCalls = @()
$script:FakeUtc = $anchor.AddHours(1); $script:FakeTicks = $original.deadlineTicks
$expired = Invoke-Week1Cleanup $m $original $fakeInvoke $readFakeClock $fakePause $fakeRecord
Assert-True ($script:FakeCalls.Count -eq 0 -and $expired.deadlineMet -eq $false -and -not $expired.inventoryComplete)

# A newest incomplete scan invalidates an older good observation, including a
# late owned create. OS wait overruns remain false/unknown, never a one-hour proof.
$script:FakeUtc = $anchor.AddMinutes(59).AddSeconds(54); $script:FakeTicks = 3595000
$script:FakeRows = @{}; $script:FakeRows[('1'*64)] = ($row | Select-Object *); $script:FakeRows[('1'*64)].running = $true
$script:FakeCallCostMs = 0
$lateRecord = {
    param($Pass,$Value)
    if ($Pass -eq 0) {
        $late = $row | Select-Object *; $late.id = '2'*64; $late.running = $true
        $script:FakeRows[$late.id] = $late
        $script:FakeCallCostMs = 100000
    }
}
$lateResult = Invoke-Week1Cleanup $m $original $fakeInvoke $readFakeClock $fakePause $lateRecord
Assert-True (-not $lateResult.lastObservedAllStopped -and $lateResult.deadlineMet -eq $false -and $lateResult.finalStopped -eq $false)
Assert-True ($script:FakeRows[('2'*64)].running)
Assert-True (-not $lateResult.physicalDeadlineGuaranteed -and -not $lateResult.lateCreationExcluded)

$script:FakeUtc = $anchor.AddMinutes(59).AddSeconds(54); $script:FakeTicks = 3595000
$script:FakeRows = @{}; $script:FakeCallCostMs = 0
$observed = Invoke-Week1Cleanup $m $original $fakeInvoke $readFakeClock $fakePause $fakeRecord
Assert-True ($observed.lastObservedAllStopped -and $null -eq $observed.deadlineMet -and $null -eq $observed.finalStopped)
Assert-True (-not $observed.physicalDeadlineGuaranteed -and -not $observed.lateCreationExcluded)

# Preparation that consumes the reserve cannot begin an async output drain, and
# forward wall jumps stop the actual shared wait helper without a new timeout.
$script:FakeUtc = $anchor; $script:FakeTicks = $short.deadlineTicks - 100
$preparedLate = New-FakeClient 9999999 (New-FakeReader '' $true) (New-FakeReader '') $true
Assert-Rejected { Wait-Week1DockerClient $preparedLate $short $readFakeClock $fakeWaitTasks }
Assert-True ($preparedLate.StandardOutput.readCalls -eq 0 -and $preparedLate.killCount -eq 1)
$script:FakeUtc = $anchor; $script:FakeTicks = 1000
$forwardWait = {
    param($Tasks,[int]$Milliseconds)
    $script:FakeUtc = $script:FakeUtc.AddHours(2); $script:FakeTicks += $Milliseconds
    return -1
}
$forwardJump = New-FakeClient 9999999 (New-FakeReader '' $true) (New-FakeReader '') $true
Assert-Rejected { Wait-Week1DockerClient $forwardJump $short $readFakeClock $forwardWait }
Assert-True ($forwardJump.killCount -eq 1 -and $forwardJump.reapWaits.Count -eq 0)

# The production cleanup loop also expires by the inherited monotonic deadline
# while UTC is rolled back. Parent presence cannot reset its shared deadline.
$script:FakeUtc = $anchor.AddMinutes(-30); $script:FakeTicks = $original.deadlineTicks - 6000
$script:FakeRows = @{}; $script:FakeCallCostMs = 0
$rollback = Invoke-Week1Cleanup $m $original $fakeInvoke $readFakeClock $fakePause $fakeRecord
Assert-True ($script:FakeTicks -lt $original.deadlineTicks -and $rollback.lastObservedAllStopped)
Assert-True ($null -eq $rollback.deadlineMet -and -not $rollback.physicalDeadlineGuaranteed)
Write-Output 'Host guard fake budget/identity tests passed; no native actions executed.'
