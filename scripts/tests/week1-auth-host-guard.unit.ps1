param([string]$GuardSource)
$ErrorActionPreference = 'Stop'
if (-not $GuardSource) { $GuardSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'week1-auth-host-guard.ps1' }
. $GuardSource
function Assert-True($value) { if (-not $value) { throw 'Fake host guard assertion failed.' } }
function Assert-Rejected([scriptblock]$work) { $denied = $false; try { & $work | Out-Null } catch { $denied = $true }; Assert-True $denied }
# All inputs are synthetic metadata; no file/process/Docker/provider function is called.
$m = [pscustomobject]@{
    version=1;profile='week1-auth-20261030-invitation1';root='/home/anas/.local/share/nextera-judge/week1-auth-20261030-invitation1/run-001';project='01coding-week1-auth-20261030-invitation1';scopeSha256=('a'*64);sourceLockSha256=('b'*64);reviewedHead=('c'*40);engineId='synthetic-engine-123';dockerCliSha256=('d'*64)
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
