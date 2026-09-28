package openai

import (
	"sort"
	"strings"
)

// The price table above is the one list of models this gateway knows. Anything
// else that needs to ask "is this a model we support" - route validation, the
// model picker in the panel - reads it through these functions rather than
// keeping a list of its own. A separate list goes stale the day a model is added
// here, and a model that is accepted but not priced is recorded as free.

// IsChatModel reports whether model is priced as a chat completion model,
// including a pinned snapshot of one and a fine-tune of one.
func IsChatModel(model string) bool {
	_, ok := lookupModelCost(OpenAiPerThousandTokenCost["completion"], model)
	return ok
}

// IsEmbeddingModel reports whether model is priced as an embeddings model.
func IsEmbeddingModel(model string) bool {
	_, ok := lookupModelCost(OpenAiPerThousandTokenCost["embeddings"], model)
	return ok
}

// ChatModels lists the priced chat models, sorted. The finetune-* entries are
// how the table prices fine-tunes, not names anyone can call, so they are left
// out; a real ft:... name is still accepted by IsChatModel.
func ChatModels() []string {
	return modelNames(OpenAiPerThousandTokenCost["completion"])
}

// EmbeddingModels lists the priced embeddings models, sorted.
func EmbeddingModels() []string {
	return modelNames(OpenAiPerThousandTokenCost["embeddings"])
}

func modelNames(costs map[string]float64) []string {
	names := make([]string, 0, len(costs))

	for name := range costs {
		if strings.HasPrefix(name, "finetune-") {
			continue
		}

		names = append(names, name)
	}

	sort.Strings(names)

	return names
}
