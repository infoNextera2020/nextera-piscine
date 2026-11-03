# Copy JWT to WSL /tmp
wsl sh -c "cp /mnt/host/c/Users/NEXTERA/nextera-credentials-run003/storage-reader.jwt /tmp/storage-reader.jwt && chmod 0600 /tmp/storage-reader.jwt"

# Launch continuous runner work loop
wsl env JUDGE_DATABASE_URL="postgresql://nextera_worker_9ef4a0519ca28e2d:348c42bfe41a346174e84362f0b8089ea15200baffaf05189339d9507b73c5f2@127.0.0.1:54322/foundation_test_slice_001" JUDGE_STORAGE_PUBLISHABLE_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" DOCKER_HOST=/var/run/docker.sock /mnt/host/c/Users/NEXTERA/Desktop/nextera-piscine/.tools/runner work --candidate /mnt/host/c/Users/NEXTERA/nextera-judge-artifacts/candidate.json --layouts /mnt/host/c/Users/NEXTERA/nextera-judge-artifacts --runner-image sha256:d72033e846afeeae5f14e0970bc54f60c55b34a90f785c77546d270e6cfe80b6 --storage-url http://127.0.0.1:54321 --storage-token-file /tmp/storage-reader.jwt --local-fixtures
