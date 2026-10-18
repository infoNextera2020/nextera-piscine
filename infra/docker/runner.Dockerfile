FROM golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOENV=off GOMAXPROCS=1
WORKDIR /src
COPY . .
ARG RUNNER_SOURCE_DIGEST
RUN --network=none go test ./... && go build -trimpath -buildvcs=false -p=1 -ldflags="-buildid= -X main.revision=${RUNNER_SOURCE_DIGEST}" -o /runner ./cmd/runner

FROM scratch
COPY --from=build /runner /runner
USER 65532:65532
ENTRYPOINT ["/runner"]
