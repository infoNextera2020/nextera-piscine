"""Inactive on import. Native Job-owned private browser handoff worker.

Only the source-bound coordinator may start this after an acknowledged guard ARM.
No credentials are written, printed, placed in argv/env, or returned to its parent.
"""
from pathlib import Path
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import queue
import re
import stat
import subprocess
import sys
import threading
import time
import uuid

REPO = '/home/anas/nextera-piscine'
PROFILE = 'week1-auth-20261031-smtp1'
ROOT = '/home/anas/.local/share/nextera-judge/' + PROFILE + '/run-001'
WSL = r'C:\Windows\System32\wsl.exe'
PYTHON = r'C:\Python315\python.exe'
NODE = r'C:\Program Files\nodejs\node.exe'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
CORE = 'file://wsl.localhost/Ubuntu/home/anas/nextera-piscine/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs'
CORE_PACKAGE = REPO + '/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core'
CORE_TREE_SHA256 = '0c7d8cae7c6fce1d651f80b117825b4cc32627847252e2fa962e9cdc071366e6'
NODE_SHA = 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'
CHROME_SHA = '4132eb3e9c5b3978874eed48cb45c21debf343a0d383b6d2fb01a5fcf349ec65'
CONSUMER = 'week1-auth-browser-consumer.mjs'
LIMIT = 4096
HASH = re.compile(r'^[a-f0-9]{64}$')
CONFIG_KEYS = {'binding', 'repo', 'cache', 'manifestSha256', 'started', 'deadline', 'cleanupAt',
               'helperSha256', 'brokerSha256', 'consumerSha256', 'hostSha256'}
ACK_KEYS = {'version', 'scopeSha256', 'sourceLockSha256', 'nonce', 'issueRequestId', 'origin',
            'cohortId', 'email', 'displayName', 'expiresAt', 'tokenSha256', 'issuedAt'}
PROOF_KEYS = {'version', 'scopeSha256', 'sourceLockSha256', 'nonce', 'issueRequestId', 'tokenSha256',
              'origin', 'email', 'cohortId', 'observedAt', 'browser', 'checks'}
SAFE_KEYS = {'status', 'scopeSha256', 'proofRecorded', 'contextClosed', 'privateInputPersisted'}


class BrowserHostError(ValueError):
    pass


def require(ok):
    if not ok:
        raise BrowserHostError('NATIVE_BROWSER_UNRESOLVED')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode() + b'\n'


def parse(data, maximum=LIMIT):
    require(type(data) is bytes and 0 < len(data) <= maximum and data.endswith(b'\n') and b'\n' not in data[:-1])
    def pairs(items):
        made = {}
        for key, value in items:
            require(key not in made)
            made[key] = value
        return made
    value = json.loads(data, object_pairs_hook=pairs,
                       parse_constant=lambda _: require(False))
    require(type(value) is dict)
    return value


def exact(value, keys):
    require(type(value) is dict and set(value) == set(keys))


def safe_env(source=None):
    source = os.environ if source is None else source
    made = {k: v for k, v in source.items() if k.upper() in {
        'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP',
        'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC'}}
    made['PATH'] = r'C:\Windows\System32;C:\Windows'
    return made


def validate_config(c):
    exact(c, CONFIG_KEYS)
    b = c['binding']
    exact(b, {'driver', 'session', 'scopeSha256', 'sourceLockSha256', 'reviewedHead', 'profile', 'root', 'project'})
    require(b['driver'] == 'native-windows-parent-v1' and b['profile'] == PROFILE and b['root'] == ROOT and
            b['project'] == '01coding-' + PROFILE and c['repo'] == REPO)
    require(all(type(b[k]) is str and HASH.fullmatch(b[k]) for k in ['session', 'scopeSha256', 'sourceLockSha256']))
    require(type(b['reviewedHead']) is str and re.fullmatch(r'[a-f0-9]{40}', b['reviewedHead']))
    require(all(type(c[k]) is str and HASH.fullmatch(c[k]) for k in
                ['manifestSha256', 'helperSha256', 'brokerSha256', 'consumerSha256', 'hostSha256']))
    require(all(type(c[k]) is int and c[k] > 0 for k in ['started', 'deadline', 'cleanupAt']))
    require(c['deadline'] - c['started'] == 3600000 and c['cleanupAt'] == c['deadline'] - 180000)
    require(type(c['cache']) is str and '\x00' not in c['cache'])
    return c


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in ['ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
               'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]


class BASIC_LIMITS(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong),
                ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]


class EXTENDED_LIMITS(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BASIC_LIMITS), ('IoInfo', IO_COUNTERS),
                ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]


class NativeJob:
    """Unnamed, non-inheritable Job; close kills only its newly assigned descendants."""
    def __init__(self):
        require(os.name == 'nt')
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, args, result in [
            ('CreateJobObjectW', [ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            ('SetInformationJobObject', [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            ('AssignProcessToJobObject', [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            ('CloseHandle', [wintypes.HANDLE], wintypes.BOOL)]:
            fn = getattr(self.api, name); fn.argtypes = args; fn.restype = result
        self.handle = self.api.CreateJobObjectW(None, None)
        require(bool(self.handle))
        try:
            limits = EXTENDED_LIMITS()
            limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE; never BREAKAWAY_OK.
            require(bool(self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits))))
        except Exception:
            self.close(); raise

    def assign(self, child):
        # Exact retained Popen HANDLE, not a PID lookup susceptible to reuse.
        require(bool(self.api.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(child._handle)))))

    def close(self):
        if self.handle:
            handle, self.handle = self.handle, None
            require(bool(self.api.CloseHandle(handle)))


def assert_owner_directory(path):
    """Read-only native DACL check: exact caller owner, owner-only Allow ACEs, no reparse."""
    require(os.name == 'nt')
    p = Path(path)
    require(p.is_absolute() and p.is_dir())
    for item in [p, *p.parents]:
        require(not item.is_symlink() and not (item.stat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT))
    adv = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    adv.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    adv.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    adv.GetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p)]
    adv.GetNamedSecurityInfoW.restype = wintypes.DWORD
    adv.EqualSid.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    adv.GetAce.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    token, size = wintypes.HANDLE(), wintypes.DWORD()
    owner, dacl, descriptor = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
    require(bool(adv.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token))))
    try:
        adv.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        require(0 < size.value < 65536)
        buf = ctypes.create_string_buffer(size.value)
        require(bool(adv.GetTokenInformation(token, 1, buf, size.value, ctypes.byref(size))))
        caller = ctypes.c_void_p.from_buffer(buf).value
        require(adv.GetNamedSecurityInfoW(str(p), 1, 5, ctypes.byref(owner), None,
                ctypes.byref(dacl), None, ctypes.byref(descriptor)) == 0)
        require(bool(owner.value) and bool(dacl.value) and bool(adv.EqualSid(owner, caller)))
        # ACL header: revision byte, pad byte, size WORD, AceCount WORD, pad WORD.
        count = ctypes.c_ushort.from_address(dacl.value + 4).value
        require(0 < count <= 16)
        full = False
        for index in range(count):
            ace = ctypes.c_void_p()
            require(bool(adv.GetAce(dacl, index, ctypes.byref(ace))))
            require(ctypes.c_ubyte.from_address(ace.value).value == 0)  # ACCESS_ALLOWED_ACE only.
            mask = ctypes.c_uint32.from_address(ace.value + 4).value
            require(bool(adv.EqualSid(ctypes.c_void_p(ace.value + 8), caller)))
            full = full or mask & 0x1f01ff == 0x1f01ff
        require(full)
    finally:
        if descriptor.value: kernel.LocalFree(descriptor)
        kernel.CloseHandle(token)


# Fixed metadata-only script. No credential file or arbitrary filename is accepted.
METADATA_READER = r'''from pathlib import Path
import hashlib,json,os,stat,sys,types
r=Path(sys.argv[1]);expected=sys.argv[2]
def bootstrap_read(p):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o600 or not 0<s.st_size<=1048576:raise ValueError()
  data=b''
  while len(data)<=s.st_size:
   part=os.read(fd,min(65536,s.st_size+1-len(data)))
   if not part:break
   data+=part
  t=os.fstat(fd)
  if len(data)!=s.st_size or (s.st_ino,s.st_dev,s.st_size,s.st_mtime_ns)!=(t.st_ino,t.st_dev,t.st_size,t.st_mtime_ns):raise ValueError()
  return data
 finally:os.close(fd)
s=r.lstat()
if r.is_symlink() or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700:raise ValueError()
p=r/'adapter-code/week1-auth-rehearsal.py';raw=bootstrap_read(p)
if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError()
m=types.ModuleType('private_browser_metadata');m.__file__=str(p);sys.modules[m.__name__]=m
exec(compile(raw,str(p),'exec'),m.__dict__)
c=json.loads(m.private_read(r/'broker-control.private.json'))
def optional(name):
 try:return json.loads(m.private_read(r/name))
 except FileNotFoundError:return None
lockraw=m.private_read(r/'adapter-code/week1-auth-source-lock.json');lock=json.loads(lockraw)
keys=['profile','project','scopeSha256','sourceLockSha256','started','deadline','cleanupAt','hostDriver','state']
print(json.dumps({'control':{k:c[k] for k in keys},'active':optional('control.json'),
'waiting':optional('browser-awaiting.private.json'),'ack':optional('browser-handoff-ack.private.json'),
'lockSha256':hashlib.sha256(lockraw).hexdigest(),'sources':lock['sources'],
'cleanupStarted':(r/'cleanup.lock').exists() or (r/'cleanup.private.json').exists()},separators=(',',':')))
'''


CORE_ATTEST = r'''from pathlib import Path
import hashlib,json,os,stat,sys
r=Path(sys.argv[1])
if r.is_symlink() or not r.is_dir() or r.resolve(strict=True)!=r:raise ValueError()
rows=[]
def walk_error(error):raise error
for current,dirs,files in os.walk(r,followlinks=False,onerror=walk_error):
 for name in dirs:
  p=Path(current)/name
  if p.is_symlink() or not p.is_dir() or not p.resolve(strict=True).is_relative_to(r):raise ValueError()
 for name in files:
  p=Path(current)/name;s=p.lstat()
  if p.is_symlink() or not stat.S_ISREG(s.st_mode) or not p.resolve(strict=True).is_relative_to(r):raise ValueError()
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   before=os.fstat(fd);h=hashlib.sha256();length=0
   while True:
    data=os.read(fd,1048576)
    if not data:break
    h.update(data);length+=len(data)
   after=os.fstat(fd)
   if length!=before.st_size or (before.st_ino,before.st_dev,before.st_size,before.st_mtime_ns)!=(after.st_ino,after.st_dev,after.st_size,after.st_mtime_ns):raise ValueError()
  finally:os.close(fd)
  rows.append([p.relative_to(r).as_posix(),length,h.hexdigest()])
rows.sort()
raw=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode('utf8')
print(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'files':len(rows),'bytes':sum(x[1] for x in rows)},separators=(',',':')))
'''


def run_private(args, data, seconds, maximum):
    """One bounded in-memory pipe result, no raw child diagnostics or automatic replay."""
    require(os.name == 'nt' and 0 < seconds <= 3600 and 0 < maximum <= 1048576)
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=safe_env(), close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW)
    cutoff = time.monotonic() + seconds
    answers = queue.Queue(maxsize=1)
    def read():
        try: answers.put(process.stdout.read(maximum + 1))
        except Exception: answers.put(None)
    def feed():
        try:
            if data: process.stdin.write(data); process.stdin.flush()
        except Exception:
            pass
        finally:
            try: process.stdin.close()
            except Exception: pass  # Never print a background pipe exception.
    threading.Thread(target=read, daemon=True).start()
    threading.Thread(target=feed, daemon=True).start()
    try:
        output = answers.get(timeout=max(.001, cutoff - time.monotonic()))
        require(type(output) is bytes and len(output) <= maximum)
        process.wait(timeout=max(.001, cutoff - time.monotonic()))
        require(process.returncode == 0)
        return output
    except Exception:
        if process.poll() is None: process.kill()
        try: process.wait(timeout=3)
        except subprocess.TimeoutExpired: pass
        raise BrowserHostError('NATIVE_BROWSER_UNRESOLVED') from None
    finally:
        process.stdout.close()


def wsl(command):
    return [WSL, '--distribution', 'Ubuntu', '--user', 'anas', '--cd', REPO, '--exec', *command]


class WorkerPort:
    now = staticmethod(lambda: int(time.time() * 1000))
    mono = staticmethod(lambda: time.monotonic_ns() // 1000000)
    sleep = staticmethod(time.sleep)

    def __init__(self, c):
        self.c = c
        self.consumer = Path(__file__).with_name(CONSUMER)
        self.verify_runtime()
        cache = Path(c['cache'])
        require(cache == Path(os.environ['TEMP']) / ('nextera-' + PROFILE + '-' + c['binding']['scopeSha256'][:16]))
        assert_owner_directory(cache)
        manifest_file = cache / 'manifest.json'
        require(not manifest_file.is_symlink() and not (manifest_file.stat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT))
        manifest_raw = manifest_file.read_bytes()
        require(sha(manifest_raw) == c['manifestSha256'])
        manifest = json.loads(manifest_raw)
        require(all(manifest[k] == c['binding'][k] for k in
            ['profile', 'root', 'project', 'scopeSha256', 'sourceLockSha256', 'reviewedHead']))
        self.parent = cache / ('browser-' + uuid.uuid4().hex)
        self.parent.mkdir()  # Exclusive; inherits existing owner-only cache ACL, no ACL writes.
        assert_owner_directory(self.parent)
        self.profile = self.parent / 'chrome-profile'  # Consumer requires this child not to exist yet.

    def verify_runtime(self):
        for file, expected in [(Path(__file__), self.c['hostSha256']), (self.consumer, self.c['consumerSha256']),
                               (Path(NODE), NODE_SHA), (Path(CHROME), CHROME_SHA)]:
            require(file.is_file() and not file.is_symlink() and
                not (file.stat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT))
            require(sha(file.read_bytes()) == expected)

    def preflight(self, seconds):
        started = time.monotonic()
        self.verify_runtime()  # Recheck after setup wait, before private issuance and consumption.
        remaining = seconds - (time.monotonic() - started)
        require(remaining > 0)
        value = parse(run_private(wsl(['/usr/bin/python3', '-B', '-c', CORE_ATTEST, CORE_PACKAGE]),
            None, remaining, LIMIT))
        exact(value, {'sha256', 'files', 'bytes'})
        require(value == {'sha256': CORE_TREE_SHA256, 'files': 116, 'bytes': 13658236})

    def metadata(self, seconds):
        data = run_private(wsl(['/usr/bin/python3', '-B', '-c', METADATA_READER,
            ROOT, self.c['helperSha256']]), None, seconds, 1048576)
        return parse(data, 1048576)

    def handoff(self, seconds):
        return parse(run_private(wsl([REPO + '/.tools/node-v24.19.0-linux-x64/bin/node',
            ROOT + '/adapter-code/week1-auth-live-broker.mjs', '--operator-handoff-stdout', ROOT, REPO]),
            None, seconds, LIMIT))

    def consume(self, envelope, seconds):
        require(not self.profile.exists())
        frame = compact(envelope)
        require(len(frame) <= LIMIT)
        return parse(run_private([NODE, str(self.consumer), '--consume-private-stdin'], frame, seconds, LIMIT))

    def record(self, proof, seconds):
        return parse(run_private(wsl([REPO + '/.tools/node-v24.19.0-linux-x64/bin/node',
            ROOT + '/adapter-code/week1-auth-live-broker.mjs', '--record-browser-proof-stdin', ROOT]),
            compact(proof), seconds, LIMIT))


def validate_metadata(c, value):
    exact(value, {'control', 'active', 'waiting', 'ack', 'lockSha256', 'sources', 'cleanupStarted'})
    control = value['control']
    exact(control, {'profile', 'project', 'scopeSha256', 'sourceLockSha256', 'started', 'deadline', 'cleanupAt', 'hostDriver', 'state'})
    b = c['binding']
    require(control['hostDriver'] == b and all(control[k] == b[k] for k in
            ['profile', 'project', 'scopeSha256', 'sourceLockSha256']))
    require(all(control[k] == c[k] for k in ['started', 'deadline', 'cleanupAt']))
    require(value['cleanupStarted'] is False and value['lockSha256'] == b['sourceLockSha256'])
    require(value['sources'].get('scripts/week1-auth-rehearsal.py') == c['helperSha256'] and
            value['sources'].get('scripts/week1-auth-live-broker.mjs') == c['brokerSha256'] and
            value['sources'].get('scripts/week1-auth-browser-consumer.mjs') == c['consumerSha256'] and
            value['sources'].get('scripts/week1-auth-browser-host.py') == c['hostSha256'])
    require(control['state'] not in ['cleaning', 'cleaned', 'failed'])
    waiting = value['waiting']
    if waiting is not None:
        exact(waiting, {'registrationDriver', 'scopeSha256', 'sourceLockSha256', 'startedAt'})
        require(waiting['registrationDriver'] == 'operator-browser-learner-b' and
                all(waiting[k] == b[k] for k in ['scopeSha256', 'sourceLockSha256']) and
                type(waiting['startedAt']) is int and c['started'] <= waiting['startedAt'] < c['cleanupAt'])
        active = value['active']
        require(type(active) is dict and active.get('state') == 'active' and active.get('phase') == 'invitations_active' and
                all(active.get(k) == b[k] for k in ['profile', 'scopeSha256', 'sourceLockSha256']) and
                all(active.get(k) == c[k] for k in ['started', 'deadline', 'cleanupAt']))
    return waiting


def run_worker(c, port):
    validate_config(c)
    admitted, mono = port.now(), port.mono()
    require(c['started'] <= admitted < c['cleanupAt'])
    mono_cleanup = mono + c['cleanupAt'] - admitted
    def left(cutoff, mono_end):
        now = port.now()
        remaining = min(cutoff - now, mono_end - port.mono(), c['cleanupAt'] - now, mono_cleanup - port.mono())
        require(now >= admitted and remaining > 0)
        return remaining / 1000
    # Wait asynchronously while the original controller bootstraps. No private handoff before marker.
    while True:
        remaining = left(c['cleanupAt'], mono_cleanup)
        metadata = port.metadata(min(10, remaining))
        waiting = validate_metadata(c, metadata)
        if waiting is not None: break
        port.sleep(min(.25, remaining))
    cutoff = min(waiting['startedAt'] + 150000, c['cleanupAt'])
    mono_end = port.mono() + cutoff - port.now()
    left(cutoff, mono_end)
    require(metadata['ack'] is None)  # Never replay or adopt a previous issuance.
    port.preflight(min(10, left(cutoff, mono_end)))
    handoff = port.handoff(left(cutoff, mono_end))  # Exactly one issuance attempt.
    metadata = port.metadata(min(10, left(cutoff, mono_end)))  # Independent persisted acknowledgement.
    require(validate_metadata(c, metadata) == waiting)
    ack = metadata['ack']
    exact(ack, ACK_KEYS); exact(handoff, ACK_KEYS | {'url', 'password'})
    require(all(handoff[k] == ack[k] for k in ACK_KEYS))
    require(ack['scopeSha256'] == c['binding']['scopeSha256'] and ack['sourceLockSha256'] == c['binding']['sourceLockSha256'])
    require(type(ack['expiresAt']) is int and type(ack['issuedAt']) is int and waiting['startedAt'] <= ack['issuedAt'] <= port.now())
    cutoff = min(cutoff, ack['expiresAt'])
    mono_end = min(mono_end, port.mono() + cutoff - port.now())
    envelope = {'handoff': handoff, 'expectedScope': ack, 'awaitingStartedAt': waiting['startedAt'],
        'cleanupAt': c['cleanupAt'], 'deadline': cutoff, 'coreUrl': CORE, 'executablePath': CHROME,
        'profileDir': str(port.profile), 'coreTreeSha256': CORE_TREE_SHA256}
    port.preflight(min(10, left(cutoff, mono_end)))
    proof = port.consume(envelope, left(cutoff, mono_end))
    exact(proof, PROOF_KEYS)
    require(all(proof[k] == ack[k] for k in ['version', 'scopeSha256', 'sourceLockSha256', 'nonce',
        'issueRequestId', 'tokenSha256', 'origin', 'email', 'cohortId']))
    require(proof['browser'] == 'chrome' and type(proof['observedAt']) is int and ack['issuedAt'] <= proof['observedAt'] <= port.now())
    exact(proof['checks'], {'fragmentRemoved', 'inviteEmailFixed', 'activationSucceeded', 'ordinaryLoginSucceeded'})
    require(all(v is True for v in proof['checks'].values()))
    receipt = port.record(proof, left(cutoff, mono_end))  # One proof write; no automatic retry on unknown.
    exact(receipt, {'status', 'replayed', 'scopeSha256', 'nonce', 'proofSha256'})
    require(receipt['status'] == 'recorded' and receipt['replayed'] is False and
        receipt['scopeSha256'] == proof['scopeSha256'] and receipt['nonce'] == proof['nonce'] and
        receipt['proofSha256'] == sha(json.dumps(proof, sort_keys=True, separators=(',', ':'),
            ensure_ascii=False, allow_nan=False).encode() + b'\n'))
    return {'status': 'recorded', 'scopeSha256': c['binding']['scopeSha256'], 'proofRecorded': True,
            'contextClosed': True, 'privateInputPersisted': False}


class BrowserJob:
    def __init__(self, c, job_factory=NativeJob, popen=subprocess.Popen):
        validate_config(c)
        self.config_scope = c['binding']['scopeSha256']
        self.job, self.child, self.closed = job_factory(), None, False
        try:
            self.child = popen([PYTHON, '-B', str(Path(__file__).resolve()), '--worker'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env=safe_env(), close_fds=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.job.assign(self.child)  # BEFORE GO, config, source reads or any descendants.
            self.child.stdin.write(b'GO\n' + compact(c)); self.child.stdin.flush(); self.child.stdin.close()
        except Exception:
            self.close(); raise BrowserHostError('NATIVE_BROWSER_UNRESOLVED') from None

    def check(self):
        require(not self.closed and self.child.poll() in [None, 0])

    def finish(self, seconds):
        self.child.wait(timeout=seconds)
        require(self.child.returncode == 0)
        value = parse(self.child.stdout.read(LIMIT + 1))
        exact(value, SAFE_KEYS)
        require(value == {'status': 'recorded', 'scopeSha256': self.config_scope,
            'proofRecorded': True, 'contextClosed': True, 'privateInputPersisted': False})
        self.close()
        return value

    def close(self):
        if self.closed: return
        self.closed = True
        try:
            self.job.close()  # Kernel kills descendants even on native-parent death.
        finally:
            if self.child is not None:
                # An unassigned failed child is still at its stdin gate and has no children.
                if self.child.poll() is None: self.child.kill()
                try: self.child.wait(timeout=5)
                except subprocess.TimeoutExpired: pass
                if self.child.stdin and not self.child.stdin.closed: self.child.stdin.close()
                if self.child.stdout: self.child.stdout.close()


def start(c):
    return BrowserJob(c)


def main():
    require(len(sys.argv) == 2 and sys.argv[1] == '--worker')
    # No filesystem, WSL, native API or child access before coordinator Job assignment.
    require(sys.stdin.buffer.readline(4) == b'GO\n')
    raw = sys.stdin.buffer.read(65537)
    require(len(raw) <= 65536)
    c = validate_config(parse(raw, 65536))
    require(os.name == 'nt' and os.path.normcase(sys.executable) == os.path.normcase(PYTHON))
    result = run_worker(c, WorkerPort(c))
    sys.stdout.buffer.write(compact(result)); sys.stdout.buffer.flush()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('NATIVE_BROWSER_UNRESOLVED; no automatic retry.\n')
        sys.exit(1)
