package azure

import "sort"

// As with openai, the price table is the list of models this gateway supports on
// Azure; route validation and the panel read it through these functions. Azure
// prices by exact name, so there is no snapshot fallback here.

// IsChatModel reports whether model is priced as an Azure chat model.
func IsChatModel(model string) bool {
	_, ok := AzureOpenAiPerThousandTokenCost["completion"][model]
	return ok
}

// IsEmbeddingModel reports whether model is priced as an Azure embeddings model.
func IsEmbeddingModel(model string) bool {
	_, ok := AzureOpenAiPerThousandTokenCost["embeddings"][model]
	return ok
}

// ChatModels lists the priced Azure chat models, sorted.
func ChatModels() []string {
	return modelNames(AzureOpenAiPerThousandTokenCost["completion"])
}

// EmbeddingModels lists the priced Azure embeddings models, sorted.
func EmbeddingModels() []string {
	return modelNames(AzureOpenAiPerThousandTokenCost["embeddings"])
}

func modelNames(costs map[string]float64) []string {
	names := make([]string, 0, len(costs))
	for name := range costs {
		names = append(names, name)
	}

	sort.Strings(names)

	return names
}
