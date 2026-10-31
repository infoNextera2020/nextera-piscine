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

REPO = '/home/anas/.local/share/01coding-source/auth-source-browser-smtp1-clean1'
PROFILE = 'week1-auth-20261031-smtp1'
ROOT = '/home/anas/.local/share/nextera-judge/' + PROFILE + '/run-001'
WSL = r'C:\Windows\System32\wsl.exe'
PYTHON = r'C:\Python315\python.exe'
NODE = r'C:\Program Files\nodejs\node.exe'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PINNED_CORE_PACKAGE = '/home/anas/nextera-piscine/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core'
CORE = 'file://wsl.localhost/Ubuntu' + PINNED_CORE_PACKAGE + '/index.mjs'
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
    def __init__(self, category='validation_rejected', *, exit_code=None):
        self.category = category if category in {
            'validation_rejected', 'metadata_timeout', 'wsl_service_unavailable',
            'metadata_denied', 'private_process_failed', 'worker_failed',
            'retry_exhausted', 'budget_expired', 'job_closure_unverified'} else 'validation_rejected'
        self.exit_code = exit_code if type(exit_code) is int and -(1 << 31) <= exit_code < (1 << 32) else None
        super().__init__('NATIVE_BROWSER_UNRESOLVED')


def failure(error, phase='worker'):
    categories = {'metadata_timeout', 'wsl_service_unavailable', 'metadata_denied',
                  'private_process_failed', 'worker_failed', 'retry_exhausted',
                  'budget_expired', 'job_closure_unverified', 'validation_rejected'}
    category = error.category if isinstance(error, BrowserHostError) and error.category in categories else 'validation_rejected'
    return {'version': 1, 'phase': phase if phase in {'worker', 'metadata', 'handoff', 'consume', 'record', 'closure'} else 'worker',
            'component': 'native_browser', 'category': category,
            'exceptionKind': 'browser' if isinstance(error, BrowserHostError) else 'unexpected',
            'exitCode': error.exit_code if isinstance(error, BrowserHostError) else None, 'signal': None}


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


class BASIC_ACCOUNTING(ctypes.Structure):
    _fields_ = [(name, ctypes.c_longlong) for name in ['TotalUserTime', 'TotalKernelTime',
                'ThisPeriodTotalUserTime', 'ThisPeriodTotalKernelTime']] + [
                (name, wintypes.DWORD) for name in ['TotalPageFaultCount', 'TotalProcesses',
                'ActiveProcesses', 'TotalTerminatedProcesses']]


class NativeJob:
    """Unnamed, non-inheritable Job; close kills only its newly assigned descendants."""
    def __init__(self):
        require(os.name == 'nt')
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, args, result in [
            ('CreateJobObjectW', [ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            ('SetInformationJobObject', [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            ('AssignProcessToJobObject', [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            ('TerminateJobObject', [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            ('QueryInformationJobObject', [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
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

    def stop_and_verify(self, remaining):
        require(bool(self.handle) and remaining() > 0)
        require(bool(self.api.TerminateJobObject(self.handle, 1)))
        while True:
            require(remaining() > 0)
            accounting = BASIC_ACCOUNTING()
            require(bool(self.api.QueryInformationJobObject(self.handle, 1,
                ctypes.byref(accounting), ctypes.sizeof(accounting), None)))
            if accounting.ActiveProcesses == 0:
                return True
            time.sleep(min(.05, remaining()))


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


def run_private(args, data, seconds, maximum, metadata=False, hard_budget=None):
    """One bounded in-memory pipe result, no raw child diagnostics or automatic replay."""
    require(os.name == 'nt' and 0 < seconds <= 3600 and 0 < maximum <= 1048576)
    if metadata:
        require(len(args) > 1 and type(args[-1]) is str and HASH.fullmatch(args[-1]) and
                args == wsl(['/usr/bin/python3', '-B', '-c', METADATA_READER, ROOT, args[-1]]))
        require(type(hard_budget) is tuple and len(hard_budget) == 2 and
                all(type(value) in (int, float) and 0 < value < 1e20 for value in hard_budget))
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=safe_env(), close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW) if not metadata else subprocess.Popen(
        args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=safe_env(), close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW)
    cutoff = time.monotonic() + seconds
    answers = queue.Queue(maxsize=1)
    errors = queue.Queue(maxsize=1)
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
    if metadata:
        def read_error():
            try: errors.put(process.stderr.read(65537))
            except Exception: errors.put(None)
        threading.Thread(target=read_error, daemon=True).start()
    threading.Thread(target=feed, daemon=True).start()
    try:
        output = answers.get(timeout=max(.001, cutoff - time.monotonic()))
        require(type(output) is bytes and len(output) <= maximum)
        error = errors.get(timeout=max(.001, cutoff - time.monotonic())) if metadata else b''
        require(type(error) is bytes and len(error) <= 65536)
        process.wait(timeout=max(.001, cutoff - time.monotonic()))
        if process.returncode:
            category = 'private_process_failed'
            if metadata:
                # Inspect only the fixed read-only command's bounded memory result.
                # Never persist/return diagnostics, strings, paths or input frames.
                text = (output + error).decode('utf-8', errors='replace').lower().replace('\x00', '')
                if any(word in text for word in ['access is denied', 'permission denied', 'accessdenied', '0x80070005']):
                    category = 'metadata_denied'
                elif ('traceback' not in text and any(re.fullmatch(
                        r'(?:error code:\s*)?wsl/service/0x8007274c', line.strip())
                        for line in text.splitlines())):
                    category = 'wsl_service_unavailable'
            raise BrowserHostError(category, exit_code=process.returncode)
        return output
    except Exception as error:
        if process.poll() is None: process.kill()
        reap = min(3, hard_budget[0] - time.time(), hard_budget[1] - time.monotonic()) if metadata else 3
        if reap > 0:
            try: process.wait(timeout=reap)
            except subprocess.TimeoutExpired: pass
        if process.poll() is None:
            raise BrowserHostError('private_process_failed') from None  # Unreaped read is never retried.
        if isinstance(error, BrowserHostError):
            raise error from None
        if metadata and isinstance(error, (queue.Empty, subprocess.TimeoutExpired)):
            raise BrowserHostError('metadata_timeout', exit_code=process.poll()) from None
        raise BrowserHostError('private_process_failed', exit_code=process.poll()) from None
    finally:
        process.stdout.close()
        if metadata: process.stderr.close()


def wsl(command):
    return [WSL, '--distribution', 'Ubuntu', '--user', 'anas', '--cd', REPO, '--exec', *command]


class WorkerPort:
    now = staticmethod(lambda: int(time.time() * 1000))
    mono = staticmethod(lambda: time.monotonic_ns() // 1000000)
    sleep = staticmethod(time.sleep)

    def __init__(self, c):
        self.c = c
        self.stage = 'worker'
        self.hard_wall = c['deadline'] / 1000
        self.hard_mono = time.monotonic() + max(0, self.hard_wall - time.time())
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
        value = parse(run_private(wsl(['/usr/bin/python3', '-B', '-c', CORE_ATTEST, PINNED_CORE_PACKAGE]),
            None, remaining, LIMIT))
        exact(value, {'sha256', 'files', 'bytes'})
        require(value == {'sha256': CORE_TREE_SHA256, 'files': 116, 'bytes': 13658236})

    def metadata(self, seconds):
        self.stage = 'metadata'
        data = run_private(wsl(['/usr/bin/python3', '-B', '-c', METADATA_READER,
            ROOT, self.c['helperSha256']]), None, seconds, 1048576, metadata=True,
            hard_budget=(self.hard_wall, self.hard_mono))
        return parse(data, 1048576)

    def handoff(self, seconds):
        self.stage = 'handoff'
        return parse(run_private(wsl([REPO + '/.tools/node-v24.19.0-linux-x64/bin/node',
            ROOT + '/adapter-code/week1-auth-live-broker.mjs', '--operator-handoff-stdout', ROOT, REPO]),
            None, seconds, LIMIT))

    def consume(self, envelope, seconds):
        self.stage = 'consume'
        require(not self.profile.exists())
        frame = compact(envelope)
        require(len(frame) <= LIMIT)
        return parse(run_private([NODE, str(self.consumer), '--consume-private-stdin'], frame, seconds, LIMIT))

    def record(self, proof, seconds):
        self.stage = 'record'
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
    transient_failures = 0
    while True:
        remaining = left(c['cleanupAt'], mono_cleanup)
        try:
            metadata = port.metadata(min(10, remaining))
        except BrowserHostError as error:
            if error.category not in {'metadata_timeout', 'wsl_service_unavailable'}:
                raise
            transient_failures += 1
            if transient_failures >= 3:
                raise BrowserHostError('retry_exhausted', exit_code=error.exit_code) from None
            remaining = left(c['cleanupAt'], mono_cleanup)
            port.sleep(min(.25, remaining))
            continue
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
        self.deadline, self.mono_end = c['deadline'], time.monotonic() + max(0, c['deadline'] / 1000 - time.time())
        self.closure, self.failure = None, None
        self.terminal, self.terminal_value = queue.Queue(maxsize=1), None
        try:
            self.child = popen([PYTHON, '-B', str(Path(__file__).resolve()), '--worker'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env=safe_env(), close_fds=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.job.assign(self.child)  # BEFORE GO, config, source reads or any descendants.
            self.child.stdin.write(b'GO\n' + compact(c)); self.child.stdin.flush(); self.child.stdin.close()
            def read_terminal():
                try: self.terminal.put(self.child.stdout.read(LIMIT + 1))
                except Exception: self.terminal.put(None)
            threading.Thread(target=read_terminal, daemon=True).start()
        except Exception:
            self.close(); raise BrowserHostError('NATIVE_BROWSER_UNRESOLVED') from None

    def check(self):
        require(not self.closed)
        code = self.child.poll()
        if code not in (None, 0):
            if self.failure is None:
                self.failure = failure(BrowserHostError('worker_failed', exit_code=code))
                try:
                    value = parse(self.read_terminal(min(.1, self.remaining(.1))))
                    exact(value, {'status', 'failure'})
                    event = value['failure']
                    normalized = failure(BrowserHostError(event['category'], exit_code=event['exitCode']), event['phase'])
                    normalized['exceptionKind'] = event['exceptionKind']
                    require(value['status'] == 'failed' and event == normalized and
                            event['exceptionKind'] in {'browser', 'unexpected'} and type(event['version']) is int)
                    self.failure = event
                except Exception:
                    pass  # Malformed worker output is never returned or logged.
            error = BrowserHostError('worker_failed', exit_code=code)
            error.safe_event = self.failure
            raise error

    def remaining(self, ceiling):
        remaining = min(ceiling, self.deadline / 1000 - time.time(), self.mono_end - time.monotonic())
        require(remaining > 0)
        return remaining

    def read_terminal(self, seconds):
        if self.terminal_value is None:
            self.terminal_value = self.terminal.get(timeout=self.remaining(seconds))
        return self.terminal_value

    def finish(self, seconds):
        self.child.wait(timeout=self.remaining(seconds))
        self.check()
        require(self.child.returncode == 0)
        value = parse(self.read_terminal(self.remaining(seconds)))
        exact(value, SAFE_KEYS)
        require(value == {'status': 'recorded', 'scopeSha256': self.config_scope,
            'proofRecorded': True, 'contextClosed': True, 'privateInputPersisted': False})
        self.close(seconds)
        return value

    def close(self, seconds=5):
        if self.closed:
            require(self.closure is not None)
            return self.closure
        self.closed = True
        cutoff = time.monotonic() + max(0, min(seconds, self.deadline / 1000 - time.time(),
                                               self.mono_end - time.monotonic()))
        def left():
            return self.remaining(max(0, cutoff - time.monotonic()))
        try:
            if self.child is not None and self.child.stdin and not self.child.stdin.closed:
                self.child.stdin.close()  # An unassigned child is still at GO; EOF cannot run it.
            require(self.job.stop_and_verify(left) is True)  # Exact sealed HANDLE; no PID enumeration.
            if self.child is not None:
                self.child.wait(timeout=left())
                require(self.child.poll() is not None)
            closure = {'jobClosed': True, 'activeProcessesZero': True,
                       'workerExited': self.child is None or self.child.poll() is not None}
        finally:
            # KILL_ON_JOB_CLOSE remains the independent parent-loss fail-safe even
            # when explicit cancellation/query/reap proof fails. Never retry it.
            self.job.close()
            if self.child is not None:
                if self.child.stdin and not self.child.stdin.closed: self.child.stdin.close()
                if self.child.stdout: self.child.stdout.close()
        self.closure = closure
        return self.closure


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
    port = WorkerPort(c)
    try:
        result = run_worker(c, port)
    except Exception as error:
        sys.stdout.buffer.write(compact({'status': 'failed', 'failure': failure(error, port.stage)}))
        sys.stdout.buffer.flush()
        return 1
    sys.stdout.buffer.write(compact(result)); sys.stdout.buffer.flush()
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        sys.stdout.buffer.write(compact({'status': 'failed', 'failure': failure(error)}))
        sys.stdout.buffer.flush()
        sys.exit(1)
