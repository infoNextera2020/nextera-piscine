package functional

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

func owned(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid())
}
func readPrivate(path string, maximum int64) ([]byte, error) {
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || !owned(info) || info.Size() < 1 || info.Size() > maximum {
		return nil, ErrUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil || int64(len(raw)) != info.Size() {
		return nil, ErrUnavailable
	}
	return raw, nil
}
func checkDirectory(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return ErrUnavailable
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return ErrUnavailable
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 || !owned(info) {
		return ErrUnavailable
	}
	return nil
}
func (p *Publisher) root() (*os.Root, error) {
	if checkDirectory(p.config.ReceiptDirectory) != nil {
		return nil, ErrUnavailable
	}
	root, err := os.OpenRoot(p.config.ReceiptDirectory)
	if err != nil {
		return nil, ErrUnavailable
	}
	return root, nil
}
func (p *Publisher) read(operation string) ([]byte, error) {
	if !uuid.MatchString(operation) {
		return nil, ErrUnavailable
	}
	root, err := p.root()
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.OpenFile(operation+".json", os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || !owned(info) ||
		info.Size() < 1 || info.Size() > p.config.MaxEnvelopeBytes {
		return nil, ErrUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(file, p.config.MaxEnvelopeBytes+1))
	if err != nil || int64(len(raw)) != info.Size() {
		return nil, ErrUnavailable
	}
	return raw, nil
}
func (p *Publisher) store(operation string, raw []byte) error {
	if !uuid.MatchString(operation) || len(raw) == 0 || int64(len(raw)) > p.config.MaxEnvelopeBytes {
		return ErrUnavailable
	}
	root, err := p.root()
	if err != nil {
		return err
	}
	defer root.Close()
	directory, err := root.Open(".")
	if err != nil {
		return ErrUnavailable
	}
	defer directory.Close()
	if syscall.Flock(int(directory.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return ErrUnavailable
	}
	defer syscall.Flock(int(directory.Fd()), syscall.LOCK_UN)
	info, err := directory.Stat()
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 || !owned(info) {
		return ErrUnavailable
	}
	var objects, total int64
	for {
		entries, readErr := directory.ReadDir(64)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return ErrUnavailable
		}
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || !owned(info) ||
				info.Size() < 1 || info.Size() > p.config.MaxEnvelopeBytes || info.Size() > p.config.MaxBytes-total ||
				!strings.HasSuffix(entry.Name(), ".json") || !uuid.MatchString(strings.TrimSuffix(entry.Name(), ".json")) {
				return ErrUnavailable
			}
			objects++
			total += info.Size()
			if objects > p.config.MaxObjects || total > p.config.MaxBytes {
				return ErrUnavailable
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
	}
	if objects >= p.config.MaxObjects || int64(len(raw)) > p.config.MaxBytes-total {
		return ErrUnavailable
	}
	name := operation + ".json"
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if errors.Is(err, os.ErrExist) {
		retained, readErr := p.read(operation)
		if readErr == nil && bytes.Equal(retained, raw) {
			return nil
		}
		return ErrUnavailable
	}
	if err != nil {
		return ErrUnavailable
	}
	// The final reservation counts the new envelope even when a crash/partial
	// write occurs. No overwrite, cleanup, refund or native write follows failure.
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return ErrUnavailable
	}
	if file.Sync() != nil {
		file.Close()
		return ErrUnavailable
	}
	if file.Close() != nil || directory.Sync() != nil {
		return ErrUnavailable
	}
	return nil
}
