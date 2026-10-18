FROM golang:1.27.2-bookworm@sha256:55395706e9703db746cc507abfc4eb2aea75918f8a8024e4848e2cb81004f5ad AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOENV=off GOMAXPROCS=1
WORKDIR /src
COPY go.mod go.sum ./
# Trusted build dependency acquisition only. Learner builds remain fully offline.
RUN go mod download && go mod verify
COPY . .
ENV GOPROXY=off GOSUMDB=off
ARG RUNNER_SOURCE_DIGEST
RUN --network=none --mount=type=cache,id=nextera-runner-go1.27.2,target=/root/.cache/go-build,sharing=locked go test ./... && go build -trimpath -buildvcs=false -p=1 -ldflags="-buildid= -X main.revision=${RUNNER_SOURCE_DIGEST}" -o /runner ./cmd/runner

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /runner /runner
USER 65532:65532
ENTRYPOINT ["/runner"]
