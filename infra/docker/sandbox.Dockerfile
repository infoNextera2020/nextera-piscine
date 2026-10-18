# Exact platform manifest, resolved from the official Go image.
FROM golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOENV=off \
    GO111MODULE=off GOMAXPROCS=1 GOFLAGS="" GOOS=linux GOARCH=amd64 \
    GOCACHE=/workspace/cache GOTMPDIR=/tmp HOME=/workspace GOMEMLIMIT=48MiB
# Trusted read-only standard-library cache. Per-attempt cache uses writable
# directories and symlinks to immutable content-addressed cache entries.
RUN --network=none GOMEMLIMIT=384MiB GOCACHE=/opt/go-cache go build -trimpath -buildvcs=false -p=1 -ldflags=-buildid= encoding/json fmt os net os/exec strings syscall \
    && chmod -R a+rX /opt/go-cache \
    && mkdir -p /workspace && chown 65532:65532 /workspace
USER 65532:65532
WORKDIR /workspace
CMD ["/bin/sleep", "86400"]
