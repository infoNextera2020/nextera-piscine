// Package sandbox controls disposable containers. No learner code runs in this process.
package sandbox

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

var ErrInfrastructure = errors.New("CONTAINER_FAILURE")
var ErrOutput = errors.New("OUTPUT_LIMIT")

type Engine struct {
	Socket       string
	HTTP         *http.Client
	Job, Attempt string
}

func New(socket string) *Engine {
	return &Engine{Socket: socket, HTTP: &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}, Timeout: 15 * time.Second}}
}

// A newly fenced claim may remove containers belonging to older attempts of
// that same job. Stopped Judge containers are also safe to reap after a crash.
func (e *Engine) Cleanup(ctx context.Context) error {
	filters, _ := json.Marshal(map[string][]string{"label": {"nextera.purpose=foundation004-judge"}})
	var containers []struct {
		ID     string `json:"Id"`
		State  string
		Labels map[string]string
	}
	if e.API(ctx, "GET", "/containers/json?all=true&filters="+url.QueryEscape(string(filters)), nil, &containers) != nil {
		return ErrInfrastructure
	}
	for _, c := range containers {
		if c.State == "exited" || (e.Job != "" && c.Labels["nextera.job"] == e.Job && c.Labels["nextera.attempt"] != e.Attempt) {
			if e.API(ctx, "DELETE", "/containers/"+c.ID+"?force=true&v=true", nil, nil) != nil {
				return ErrInfrastructure
			}
		}
	}
	return nil
}
func (e *Engine) API(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		b, _ := json.Marshal(input)
		body = bytes.NewReader(b)
	}
	r, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, body)
	if err != nil {
		return ErrInfrastructure
	}
	r.Header.Set("Content-Type", "application/json")
	response, err := e.HTTP.Do(r)
	if err != nil {
		return ErrInfrastructure
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ErrInfrastructure
	}
	if output != nil {
		if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output) != nil {
			return ErrInfrastructure
		}
	}
	return nil
}
func (e *Engine) VerifyImage(ctx context.Context, digest string) error {
	var v struct {
		ID         string `json:"Id"`
		OS         string `json:"Os"`
		Arch       string `json:"Architecture"`
		Descriptor struct {
			Digest string `json:"digest"`
		}
	}
	if e.API(ctx, "GET", "/images/"+digest+"/json", nil, &v) != nil || v.ID != digest || v.Descriptor.Digest != digest || v.OS != "linux" || v.Arch != "amd64" {
		return ErrInfrastructure
	}
	return nil
}

type Container struct {
	E       *Engine
	ID      string
	Compile bool
}

func (e *Engine) Create(ctx context.Context, image string, compile bool) (*Container, error) {
	memory, pids := int64(64<<20), 32
	sizes := []int{12, 3, 1}
	inodes := []int{768, 192, 64}
	if compile {
		memory = 512 << 20
		pids = 64
		sizes = []int{240, 15, 1}
		inodes = []int{15360, 960, 64}
	}
	tmp := map[string]string{}
	for i, p := range []string{"/workspace", "/tmp", "/dev/shm"} {
		executable := "noexec"
		if i == 0 {
			executable = "exec"
		}
		tmp[p] = fmt.Sprintf("rw,%s,nosuid,nodev,size=%d,nr_inodes=%d,uid=65532,gid=65532,mode=700", executable, sizes[i]<<20, inodes[i])
	}
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return nil, ErrInfrastructure
	}
	// Independent control-plane crash backstop. Normal phase deadlines remain 20s/2s.
	payload := map[string]any{"Image": image, "User": "65532:65532", "Cmd": []string{"/usr/bin/timeout", "--signal=KILL", "45", "/bin/sleep", "86400"}, "Labels": map[string]string{"nextera.purpose": "foundation004-judge", "nextera.job": e.Job, "nextera.attempt": e.Attempt},
		"HostConfig": map[string]any{"NetworkMode": "none", "ReadonlyRootfs": true, "CapDrop": []string{"ALL"}, "SecurityOpt": []string{"no-new-privileges"}, "NanoCpus": 1000000000, "Memory": memory, "MemorySwap": memory, "PidsLimit": pids, "ShmSize": 1 << 20, "Tmpfs": tmp, "LogConfig": map[string]any{"Type": "none"}, "Ulimits": []map[string]any{{"Name": "core", "Soft": 0, "Hard": 0}}}}
	var result struct {
		ID string `json:"Id"`
	}
	if e.API(ctx, "POST", "/containers/create?name=nextera-judge-"+hex.EncodeToString(entropy[:]), payload, &result) != nil {
		return nil, ErrInfrastructure
	}
	c := &Container{e, result.ID, compile}
	if e.API(ctx, "POST", "/containers/"+c.ID+"/start", nil, nil) != nil {
		c.Close()
		return nil, ErrInfrastructure
	}
	if c.verify(ctx, memory, pids, sizes, inodes) != nil {
		c.Close()
		return nil, ErrInfrastructure
	}
	return c, nil
}
func (c *Container) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = c.E.API(ctx, "DELETE", "/containers/"+c.ID+"?force=true&v=true", nil, nil)
}
func (c *Container) verify(ctx context.Context, memory int64, pids int, sizes, inodes []int) error {
	var v struct {
		Config struct {
			User string
			Env  []string
		}
		HostConfig struct {
			NetworkMode                  string
			ReadonlyRootfs, Privileged   bool
			NanoCpus, Memory, MemorySwap int64
			PidsLimit                    int
			Binds                        []string
			CapDrop, SecurityOpt         []string
			Tmpfs                        map[string]string
			LogConfig                    struct{ Type string }
		}
	}
	if c.E.API(ctx, "GET", "/containers/"+c.ID+"/json", nil, &v) != nil {
		return ErrInfrastructure
	}
	h := v.HostConfig
	if v.Config.User != "65532:65532" || h.NetworkMode != "none" || !h.ReadonlyRootfs || h.Privileged || h.NanoCpus != 1000000000 || h.Memory != memory || h.MemorySwap != memory || h.PidsLimit != pids || len(h.Binds) != 0 || len(h.Tmpfs) != 3 || h.LogConfig.Type != "none" || strings.Join(h.CapDrop, ",") != "ALL" || strings.Join(h.SecurityOpt, ",") != "no-new-privileges" {
		return ErrInfrastructure
	}
	for _, env := range v.Config.Env {
		for _, secret := range []string{"DATABASE_URL", "TOKEN", "PASSWORD", "SUPABASE"} {
			if strings.Contains(env, secret) {
				return ErrInfrastructure
			}
		}
	}
	out, stderr, code, err := c.Exec(ctx, []string{"/bin/sh", "-c", "cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max"}, nil, nil, 65536)
	if err != nil || code != 0 || len(stderr) != 0 || string(out) != fmt.Sprintf("%d\n0\n%d\n100000 100000\n", memory, pids) {
		return ErrInfrastructure
	}
	out, _, code, err = c.Exec(ctx, []string{"/bin/cat", "/proc/self/status"}, nil, nil, 65536)
	if err != nil || code != 0 {
		return ErrInfrastructure
	}
	for _, s := range []string{"NoNewPrivs:\t1", "Seccomp:\t2", "CapEff:\t0000000000000000", "Uid:\t65532\t65532\t65532\t65532"} {
		if !strings.Contains(string(out), s) {
			return ErrInfrastructure
		}
	}
	for i, p := range []string{"/workspace", "/tmp", "/dev/shm"} {
		out, _, code, err = c.Exec(ctx, []string{"/usr/bin/findmnt", "-n", "-o", "OPTIONS", "--target", p}, nil, nil, 65536)
		if err != nil || code != 0 {
			return ErrInfrastructure
		}
		options := "," + strings.TrimSpace(string(out)) + ","
		for _, option := range []string{"rw", "nosuid", "nodev", fmt.Sprintf("size=%dk", sizes[i]<<10), fmt.Sprintf("nr_inodes=%d", inodes[i])} {
			if !strings.Contains(options, ","+option+",") {
				return ErrInfrastructure
			}
		}
		if strings.Contains(options, ",noexec,") != (i != 0) {
			return ErrInfrastructure
		}
	}
	return nil
}

// Exec uses Docker's non-TTY framed stream and half-closes stdin. Cancellation closes
// the socket; the enclosing phase always destroys the entire container, not just the CLI.
func (c *Container) Exec(ctx context.Context, cmd, env []string, input []byte, cap int) ([]byte, []byte, int, error) {
	var created struct {
		ID string `json:"Id"`
	}
	if c.E.API(ctx, "POST", "/containers/"+c.ID+"/exec", map[string]any{"AttachStdin": true, "AttachStdout": true, "AttachStderr": true, "Tty": false, "Cmd": cmd, "Env": env, "User": "65532:65532"}, &created) != nil {
		return nil, nil, 0, ErrInfrastructure
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", c.E.Socket)
	if err != nil {
		return nil, nil, 0, ErrInfrastructure
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	request, _ := http.NewRequest("POST", "http://docker/exec/"+created.ID+"/start", strings.NewReader(`{"Detach":false,"Tty":false}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "tcp")
	if request.Write(conn) != nil {
		return nil, nil, 0, ErrInfrastructure
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil || response.StatusCode != 101 {
		return nil, nil, 0, ErrInfrastructure
	}
	go func() {
		_, _ = conn.Write(input)
		if u, ok := conn.(*net.UnixConn); ok {
			_ = u.CloseWrite()
		}
	}()
	var stdout, stderr bytes.Buffer
	total := 0
	for {
		var header [8]byte
		_, err = io.ReadFull(reader, header[:])
		if err == io.EOF {
			break
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil, nil, 0, ctx.Err()
			}
			return nil, nil, 0, ErrInfrastructure
		}
		length := int(binary.BigEndian.Uint32(header[4:]))
		total += length
		if total > cap {
			return nil, nil, 0, ErrOutput
		}
		var dest io.Writer = &stdout
		if header[0] == 2 {
			dest = &stderr
		} else if header[0] != 1 {
			return nil, nil, 0, ErrInfrastructure
		}
		if _, err = io.CopyN(dest, reader, int64(length)); err != nil {
			return nil, nil, 0, ErrInfrastructure
		}
	}
	var status struct {
		Running  bool
		ExitCode int
	}
	if c.E.API(ctx, "GET", "/exec/"+created.ID+"/json", nil, &status) != nil || status.Running {
		return nil, nil, 0, ErrInfrastructure
	}
	return stdout.Bytes(), stderr.Bytes(), status.ExitCode, nil
}
func Archive(files map[string][]byte) ([]byte, error) {
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	for name, data := range files {
		if strings.ContainsAny(name, "/\\") {
			return nil, ErrInfrastructure
		}
		if w.WriteHeader(&tar.Header{Name: name, Mode: 0600, Uid: 65532, Gid: 65532, Size: int64(len(data)), Typeflag: tar.TypeReg, Format: tar.FormatUSTAR}) != nil {
			return nil, ErrInfrastructure
		}
		if _, err := w.Write(data); err != nil {
			return nil, err
		}
	}
	if w.Close() != nil {
		return nil, ErrInfrastructure
	}
	return b.Bytes(), nil
}
func (c *Container) Import(ctx context.Context, files map[string][]byte) error {
	data, err := Archive(files)
	if err != nil {
		return err
	}
	_, _, code, err := c.Exec(ctx, []string{"/bin/tar", "--no-same-owner", "-xf", "-", "-C", "/workspace"}, nil, data, 65536)
	if err != nil || code != 0 {
		return ErrInfrastructure
	}
	return nil
}
func Compiled(data []byte) ([]byte, error) {
	reader := tar.NewReader(bytes.NewReader(data))
	h, err := reader.Next()
	if err != nil || h.Name != "program" || h.Typeflag != tar.TypeReg || h.Size < 4 || h.Size > 7<<20 {
		return nil, ErrInfrastructure
	}
	b, err := io.ReadAll(io.LimitReader(reader, 7<<20+1))
	if err != nil || len(b) != int(h.Size) || !bytes.HasPrefix(b, []byte{0x7f, 'E', 'L', 'F'}) {
		return nil, ErrInfrastructure
	}
	if _, err = reader.Next(); err != io.EOF {
		return nil, ErrInfrastructure
	}
	return b, nil
}
func Socket() string {
	if s := os.Getenv("DOCKER_HOST"); strings.HasPrefix(s, "unix://") {
		return strings.TrimPrefix(s, "unix://")
	}
	return "/var/run/docker.sock"
}
