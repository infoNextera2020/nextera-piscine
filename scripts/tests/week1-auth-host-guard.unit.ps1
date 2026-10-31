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
function Invoke-OnlyFakeDocker([string[]]$Arguments) {
    $script:FakeCalls += ,@($Arguments)
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
$fakeInvoke = { param([string[]]$Arguments) Invoke-OnlyFakeDocker -Arguments $Arguments }
$firstSweep = Invoke-Week1OwnedSweep $m $fakeInvoke
Assert-True $firstSweep.allStopped
$late = $row | Select-Object *; $late.id='2'*64; $late.running=$true
$script:FakeRows[$late.id] = $late
$secondSweep = Invoke-Week1OwnedSweep $m $fakeInvoke
Assert-True ($secondSweep.observedIds.Count -eq 2 -and -not $script:FakeRows[$late.id].running)
Assert-True (@($script:FakeCalls | Where-Object { $_[0] -eq 'stop' }).Count -eq 2)
Write-Output 'Host guard pure fake metadata tests passed; no native actions executed.'

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
