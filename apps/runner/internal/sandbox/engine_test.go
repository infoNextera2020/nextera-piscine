package sandbox

import (
	"archive/tar"
	"bytes"
	"testing"
)

func TestBoundedRegularArtifactTransfer(t *testing.T) {
	valid, err := Archive(map[string][]byte{"program": {0x7f, 'E', 'L', 'F', 1}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Compiled(valid); err != nil {
		t.Fatal("regular bounded ELF rejected")
	}
	for _, files := range []map[string][]byte{{"../program": {1}}, {"program": []byte("not ELF")}, {"program": {0x7f, 'E', 'L', 'F'}, "extra": {1}}} {
		raw, e := Archive(files)
		if e == nil {
			_, e = Compiled(raw)
		}
		if e == nil {
			t.Fatal("unsafe transfer accepted")
		}
	}
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	_ = w.WriteHeader(&tar.Header{Name: "program", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"})
	_ = w.Close()
	if _, err = Compiled(b.Bytes()); err == nil {
		t.Fatal("symlink transfer accepted")
	}
}
