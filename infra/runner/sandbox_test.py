#!/usr/bin/env python3
"""Opt-in local sandbox integration; never executes learner code on the host."""
import argparse
from contextlib import contextmanager
import io
import hashlib
import http.client
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import tarfile
import time
import unittest
import uuid
from artifacts import FLAGS, ROOT, IDS, sha, case_records


class InfrastructureError(Exception):
    pass


def engine_info():
    """Query the local engine without Docker CLI client-plugin discovery."""
    host = os.environ.get("DOCKER_HOST", "unix:///var/run/docker.sock")
    if not host.startswith("unix://"):
        raise InfrastructureError("Local Unix Docker engine required")
    connection = http.client.HTTPConnection("localhost", timeout=10)
    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.sock.settimeout(10)
    connection.sock.connect(host[7:])
    try:
        connection.request("GET", "/info")
        response = connection.getresponse()
        payload = response.read(1 << 20)
        if response.status != 200:
            raise InfrastructureError("Engine capabilities unavailable")
        return json.loads(payload)
    finally:
        connection.close()


def docker(*args, data=None):
    return subprocess.run(["docker", *args], input=data, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30).stdout


def bounded(args, data, seconds, cap):
    """One combined stdout/stderr cap; terminate the containing sandbox on breach."""
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Inputs are trusted, bounded case arrays/archive paths, never arbitrary uploads.
    process.stdin.write(data)
    process.stdin.close()
    select = selectors.DefaultSelector()
    select.register(process.stdout, selectors.EVENT_READ)
    select.register(process.stderr, selectors.EVENT_READ)
    out, err, total = bytearray(), bytearray(), 0
    deadline = time.monotonic() + seconds
    reason = None
    try:
        while select.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reason = "timeout"
                break
            for key, _ in select.select(min(remaining, 0.05)):
                block = os.read(key.fileobj.fileno(), min(8192, cap + 1 - total))
                if not block:
                    select.unregister(key.fileobj)
                    continue
                total += len(block)
                if total > cap:
                    reason = "output"
                    break
                (out if key.fileobj is process.stdout else err).extend(block)
            if reason:
                break
        if reason:
            # This kills only the attached Docker CLI. The context manager then
            # force-removes the entire container (including descendant processes).
            process.kill()
        process.wait(timeout=5)
        return process.returncode, bytes(out), bytes(err), reason, total
    finally:
        select.close()
        process.stdout.close()
        process.stderr.close()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def archive_files(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, data in files.items():
            h = tarfile.TarInfo(name)
            h.uid = h.gid = 65532
            h.mode, h.size, h.mtime = 0o600, len(data), 0
            archive.addfile(h, io.BytesIO(data))
    return buf.getvalue()


@contextmanager
def container(image, phase):
    compile_phase = phase == "compilation"
    memory, pids = (512 << 20, 64) if compile_phase else (64 << 20, 32)
    mounts = [("/workspace", 240 << 20, 15360, "exec"), ("/tmp", 15 << 20, 960, "noexec"), ("/dev/shm", 1 << 20, 64, "noexec")] if compile_phase else [("/workspace", 12 << 20, 768, "exec"), ("/tmp", 3 << 20, 192, "noexec"), ("/dev/shm", 1 << 20, 64, "noexec")]
    name = "nextera-sandbox-test-" + uuid.uuid4().hex
    args = ["create", "--name", name, "--label", "nextera.purpose=foundation003-sandbox-test",
            "--network=none", "--user=65532:65532", "--read-only", "--cap-drop=ALL",
            "--security-opt=no-new-privileges", "--cpus=1", "--memory=" + str(memory),
            "--memory-swap=" + str(memory), "--pids-limit=" + str(pids), "--shm-size=1m",
            "--ulimit", "core=0", "--log-driver=none"]
    for path, size, inodes, executable in mounts:
        args += ["--tmpfs", f"{path}:rw,{executable},nosuid,nodev,size={size},nr_inodes={inodes},uid=65532,gid=65532,mode=700"]
    args += [image]
    created = False
    try:
        docker(*args)
        created = True
        info = json.loads(docker("inspect", name))[0]
        host, config = info["HostConfig"], info["Config"]
        if not (host["NetworkMode"] == "none" and host["ReadonlyRootfs"] and
                host["NanoCpus"] == 1000000000 and host["Memory"] == memory and
                host["MemorySwap"] == memory and host["PidsLimit"] == pids and
                config["User"] == "65532:65532" and host["CapDrop"] == ["ALL"] and
                "no-new-privileges" in host["SecurityOpt"] and not host["Privileged"] and
                not host["Binds"] and len(host["Tmpfs"]) == 3 and host["LogConfig"]["Type"] == "none"):
            raise InfrastructureError("Sandbox enforcement mismatch")
        if any(any(secret in env for secret in ("DATABASE_URL", "SUPABASE", "TOKEN", "PASSWORD")) for env in config["Env"]):
            raise InfrastructureError("Unexpected sandbox credentials")
        docker("start", name)
        # Read actual kernel enforcement, rather than trusting CLI flags alone.
        effective = docker("exec", name, "/bin/sh", "-c",
                           "cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max").decode().splitlines()
        if effective != [str(memory), "0", str(pids), "100000 100000"]:
            raise InfrastructureError("Effective cgroup limits missing")
        status = docker("exec", name, "/bin/cat", "/proc/self/status").decode()
        required = ["NoNewPrivs:\t1", "Seccomp:\t2", "CapEff:\t0000000000000000", "Uid:\t65532\t65532\t65532\t65532"]
        if any(value not in status for value in required):
            raise InfrastructureError("Effective privilege policy missing")
        for path, size, inodes, executable in mounts:
            options = docker("exec", name, "/usr/bin/findmnt", "-n", "-o", "OPTIONS", "--target", path).decode().strip().split(",")
            if not all(value in options for value in ("rw", "nosuid", "nodev", "size=" + str(size >> 10) + "k", "nr_inodes=" + str(inodes))):
                raise InfrastructureError("Effective temporary filesystem bounds missing")
            if ("noexec" in options) != (executable == "noexec"):
                raise InfrastructureError("Temporary executable policy mismatch")
        yield name
    finally:
        if created:
            docker("rm", "-f", name)


def safe(verdict):
    # Identical fixed vocabulary to Go feedback.Project. No raw data parameter.
    messages = {"passed": "All required checks passed.", "failed": "Required checks did not pass.",
                "compile_error": "The solution could not be compiled within the required profile.",
                "runtime_error": "The solution could not complete within the required profile.",
                "timeout": "The solution exceeded the execution time limit.",
                "system_error": "Evaluation infrastructure could not verify or complete this attempt."}
    if verdict not in messages:
        verdict = "system_error"
    return dict(verdict=verdict, message=messages[verdict])


def read_pack(output, pack_id, catalog, verifier):
    check = subprocess.run([str(verifier), "verify-artifact", "--layout", str(output / pack_id),
                            "--candidate", str(output / "candidate.json"), "--pack-id", pack_id],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check.returncode:
        raise InfrastructureError("Pack verification failed")
    digest = catalog["test_packs"][pack_id]["test_pack_digest"]
    layout = output / pack_id / "blobs/sha256"
    manifest = json.loads((layout / digest).read_bytes())
    payload = (layout / manifest["layers"][0]["digest"][7:]).read_bytes()
    with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
        files = {m.name: archive.extractfile(m).read() for m in archive}
    try:
        for name in ("cases/public.json", "cases/private.json"):
            case_records(files[name], pack_id)
    except (ValueError, UnicodeError):
        raise InfrastructureError("Trusted case format incompatible") from None
    return files


def verify_image(output, identity, filename):
    with tarfile.open(output / filename) as archive:
        manifest = archive.extractfile("blobs/sha256/" + identity["manifest"][7:]).read()
        if sha(manifest) != identity["manifest"][7:]:
            raise InfrastructureError("Image digest mismatch")
        m = json.loads(manifest)
        for descriptor in [m["config"], *m["layers"]]:
            stream = archive.extractfile("blobs/sha256/" + descriptor["digest"][7:])
            digest, size = hashlib.sha256(), 0
            while block := stream.read(1 << 20):
                digest.update(block)
                size += len(block)
            if size != descriptor["size"] or digest.hexdigest() != descriptor["digest"][7:]:
                raise InfrastructureError("Image blob mismatch")
        if m["config"]["digest"] != identity["config_digest"]:
            raise InfrastructureError("Local image identity mismatch")
    info = json.loads(docker("image", "inspect", identity["local_ref"]))[0]
    if info["Id"] != identity["manifest"] or info.get("Descriptor", {}).get("digest") != identity["manifest"] or info["Os"] != "linux" or info["Architecture"] != "amd64":
        raise InfrastructureError("Local image unavailable")


def evaluate(image, pack, source, metrics):
    """Test-only synchronous harness, without queue, intake, or product storage."""
    metrics["learner_fixture_digest"] = sha(source.encode())
    with container(image, "compilation") as name:
        docker("exec", "-i", name, "/bin/tar", "--no-same-owner", "-xf", "-", "-C", "/workspace", data=archive_files({"solution.go": source.encode(), "bridge.go": pack["harness/bridge.go"]}))
        command = "cp -as /opt/go-cache /workspace/cache && exec go build " + " ".join(FLAGS) + " -o /workspace/program /workspace/solution.go /workspace/bridge.go"
        started = time.monotonic()
        code, _, _, reason, count = bounded(["docker", "exec", "-e", "GOMEMLIMIT=384MiB", name, "/bin/sh", "-c", command], b"", 20, 65536)
        metrics.update(compilation_seconds=round(time.monotonic()-started,3), compilation_output_bytes=count)
        if code in (125,126,127):
            raise InfrastructureError("Compiler launch failed")
        if reason or code:
            return safe("compile_error")
        # Only this fixed regular ELF artifact crosses phases, never symlinks.
        code, data, _, reason, _ = bounded(["docker", "exec", name, "/bin/tar", "--format=ustar", "-cf", "-", "-C", "/workspace", "program"], b"", 10, 8 << 20)
        if code or reason:
            raise InfrastructureError("Compiled artifact transfer failed")
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            items = archive.getmembers()
            if len(items) != 1 or not items[0].isfile() or items[0].name != "program" or items[0].size > 7 << 20:
                raise InfrastructureError("Compiled artifact invalid")
            program = archive.extractfile(items[0]).read()
            if not program.startswith(b"\x7fELF"):
                raise InfrastructureError("Compiled artifact invalid")
            metrics["compiled_artifact_digest"] = sha(program)
    cases = json.loads(pack["cases/public.json"]) + json.loads(pack["cases/private.json"])
    with container(image, "execution") as name:
        tar = archive_files({"program": program})
        docker("exec", "-i", name, "/bin/tar", "--no-same-owner", "-xf", "-", "-C", "/workspace", data=tar)
        docker("exec", name, "/bin/chmod", "500", "/workspace/program")
        started = time.monotonic()
        code, stdout, stderr, reason, count = bounded(["docker", "exec", "-i", name, "/workspace/program"],
                                                  json.dumps([c["input"] for c in cases], ensure_ascii=False).encode(), 2, 65536)
        metrics.update(execution_seconds=round(time.monotonic()-started,3), execution_output_bytes=count)
        if code in (125,126,127):
            raise InfrastructureError("Executable launch failed")
        if reason == "timeout":
            return safe("timeout")
        if reason:
            return safe("runtime_error")
        # A handled syscall failure must not conceal an exhausted hard budget.
        # These trusted measurements happen after learner execution has ended.
        events = {}
        for key in ("pids", "memory"):
            raw = docker("exec", name, "/bin/cat", "/sys/fs/cgroup/" + key + ".events").decode()
            events[key] = {line.split()[0]: int(line.split()[1]) for line in raw.splitlines()}
        free = docker("exec", name, "/usr/bin/stat", "-f", "-c", "%a %d", "/workspace", "/tmp", "/dev/shm").decode().splitlines()
        storage_exhausted = any(any(int(value) == 0 for value in line.split()) for line in free)
        metrics.update(pid_limit_hits=events["pids"]["max"], oom_kills=events["memory"]["oom_kill"], temporary_storage_exhausted=storage_exhausted)
        if events["pids"]["max"] or events["memory"]["oom_kill"] or storage_exhausted or code or stderr:
            return safe("runtime_error")
        try:
            actual = json.loads(stdout)
        except (ValueError, UnicodeError):
            return safe("failed")
        return safe("passed" if actual == [c["expected"] for c in cases] else "failed")


def fixtures(pack_id):
    hello = pack_id == "hello-go-v1"
    signature = "Hello(name string)" if hello else "EvenOrOdd(n int)"
    correct = 'return "Hello, "+name+"!"' if hello else 'if n%2==0{return "even"};return "odd"'
    def source(body, imports=""):
        return "package main\n" + imports + "\nfunc " + signature + " string{" + body + "}\n"
    return {
        "correct": (source(correct), "passed"),
        "wrong": (source('return "wrong"'), "failed"),
        "public_examples_only": (source('if name=="Anas"{return "Hello, Anas!"};if name=="NextEra"{return "Hello, NextEra!"};return "wrong"' if hello else 'if n==10{return "even"};if n==7{return "odd"};return "wrong"'), "failed"),
        "compile_error": (source("return ???"), "compile_error"),
        "infinite_loop": (source("for {}"), "timeout"),
        "excessive_output": (source('for{fmt.Print("0123456789abcdef")}', 'import "fmt"'), "runtime_error"),
        "fake_pass": (source('fmt.Println("PASS");os.Exit(0);return ""', 'import("fmt";"os")'), "failed"),
        "hidden_exfiltration": (source('fmt.Print("LEAK:",'+('name' if hello else 'n')+');'+correct, 'import "fmt"'), "failed"),
        "hidden_stack_trace": (source('panic("private runtime diagnostic")'), "runtime_error"),
        "hidden_file_read": (source('if b,e:=os.ReadFile("/trusted/cases/private.json");e==nil{fmt.Print(string(b));return "escaped"};'+correct, 'import("fmt";"os")'), "passed"),
        "network": (source('c,e:=net.DialTimeout("tcp","1.1.1.1:53",100000000);if e==nil{c.Close();return "escaped"};'+correct, 'import "net"'), "passed"),
        "root_write": (source('if os.WriteFile("/escape",[]byte("x"),0600)==nil{return "escaped"};'+correct, 'import "os"'), "passed"),
        # Probe once per process, then reap children after the kernel denies a
        # fork so trusted post-run measurements can execute. Repeating the flood
        # per input would test aggregate elapsed time rather than the PID bound.
        # The limit, two-second budget and nonzero pids.events assertion stay intact.
        "process_limit": (source('if !pidProbed{pidProbed=true;children:=[]*exec.Cmd{};defer func(){for _,c:=range children{c.Process.Kill();c.Wait()}}();for i:=0;i<100;i++{cmd:=exec.Command("/bin/sleep","20");if cmd.Start()!=nil{return "blocked"};children=append(children,cmd)};return "escaped"};'+correct, 'import "os/exec"\nvar pidProbed bool'), "runtime_error"),
        "memory_limit": (source('b:=make([]byte,128<<20);for i:=range b{b[i]=1};return string(b)', ''), "runtime_error"),
        "tmpfs_limit": (source('b:=make([]byte,4<<20);if os.WriteFile("/tmp/full",b,0600)==nil{return "escaped"};'+correct, 'import "os"'), "runtime_error"),
        # Exhaust once per process, not again for every case in the input array.
        # The trusted supervisors still require observed inode exhaustion and
        # runtime_error; the aggregate two-second execution budget is unchanged.
        "inode_limit": (source('if !inodeProbed{inodeProbed=true;exhausted:=false;for i:=0;i<2000;i++{if os.WriteFile(fmt.Sprintf("/workspace/f%d",i),nil,0600)!=nil{exhausted=true;break}};if !exhausted{return "escaped"}};'+correct, 'import("fmt";"os")\nvar inodeProbed bool'), "runtime_error"),
        "secrets_socket": (source('if _,e:=os.Stat("/var/run/docker.sock");e==nil{return "escaped"};for _,v:=range os.Environ(){if strings.Contains(v,"DATABASE_URL="){return "escaped"}};'+correct, 'import("os";"strings")'), "passed"),
    }


class SandboxTests(unittest.TestCase):
    def test_all(self):
        self.assertTrue(any("name=seccomp" in option for option in engine_info()["SecurityOptions"]))
        identities = json.loads((OUTPUT / "local-images.json").read_bytes())
        catalog = json.loads((OUTPUT / "candidate.json").read_bytes())["catalog"]
        for name, identity in identities.items():
            verify_image(OUTPUT, identity, name + ".oci.tar")
        image = identities["sandbox"]["local_ref"]
        self.assertEqual(docker("run", "--rm", "--network=none", image, "go", "version").decode().strip(), "go version go1.27.2 linux/amd64")
        results = []
        for pack_id in IDS:
            self.assertEqual(catalog["test_packs"][pack_id]["sandbox_image_digest"], identities["sandbox"]["manifest"])
            self.assertEqual(catalog["test_packs"][pack_id]["runner_image_digest"], identities["runner"]["manifest"])
            pack = read_pack(OUTPUT, pack_id, catalog, VERIFIER)
            self.assertEqual(evaluate(image, pack, fixtures(pack_id)["correct"][0], {}), safe("passed"), "Correct fixture preflight failed under unchanged profile")
            for fixture, (source, expected) in fixtures(pack_id).items():
                with self.subTest(pack=pack_id, fixture=fixture):
                    started = time.monotonic()
                    metrics = {}
                    feedback = evaluate(image, pack, source, metrics)
                    print(pack_id, fixture, feedback["verdict"], flush=True)
                    self.assertEqual(feedback["verdict"], expected, pack_id + ":" + fixture)
                    if fixture == "process_limit":
                        self.assertGreater(metrics.get("pid_limit_hits", 0), 0)
                    if fixture == "memory_limit":
                        self.assertGreater(metrics.get("oom_kills", 0), 0)
                    if fixture in ("tmpfs_limit", "inode_limit"):
                        self.assertTrue(metrics.get("temporary_storage_exhausted"))
                    self.assertEqual(set(feedback), {"verdict", "message"})
                    self.assertEqual(feedback, safe(expected))
                    # Entire feedback is fixed/allowlisted, so hidden bytes cannot
                    # cross even when a hostile process writes arbitrary output.
                    results.append(dict(pack=pack_id, fixture=fixture, verdict=feedback["verdict"], elapsed_seconds=round(time.monotonic()-started,3), **metrics))
        self.assertFalse(docker("ps", "-aq", "--filter", "label=nextera.purpose=foundation003-sandbox-test").strip())
        (OUTPUT / "sandbox-results.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    if os.environ.get("NEXTERA_SANDBOX_TEST") != "1":
        raise SystemExit("Explicit dedicated sandbox test opt-in required")
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--verifier", required=True)
    args = parser.parse_args()
    OUTPUT, VERIFIER = Path(args.output).resolve(), Path(args.verifier).resolve()
    if ROOT == OUTPUT or ROOT in OUTPUT.parents:
        raise SystemExit("Private artifacts must remain outside product checkout")
    unittest.main(argv=[__file__], verbosity=2)
