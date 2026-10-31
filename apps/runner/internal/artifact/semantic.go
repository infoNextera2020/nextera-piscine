package artifact

import "encoding/json"

const ATMSemanticProfileDigest = "f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007"

// RawMessage distinguishes absence from explicit null/empty, preserving the
// preexisting strict field rejection for every legacy ABI.
func ValidSemanticProfile(contract ExecutionContract, raw json.RawMessage) bool {
	if contract.Version != 4 {
		return len(raw) == 0
	}
	var digest string
	return len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, &digest) == nil && digest == ATMSemanticProfileDigest
}
