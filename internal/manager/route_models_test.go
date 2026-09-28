package manager

import "testing"

func TestKindOfModel(t *testing.T) {
	cases := []struct {
		provider, model string
		want            modelKind
	}{
		// Models added to the price table are usable in a route without
		// touching this package.
		{"openai", "gpt-5.4", chatModel},
		{"openai", "gpt-5.4-mini", chatModel},
		{"openai", "gpt-4o", chatModel},
		// A pinned snapshot is priced as its base model, and so accepted.
		{"openai", "gpt-5.4-2026-03-05", chatModel},
		{"openai", "text-embedding-3-small", embeddingModel},
		{"azure", "gpt-4o", chatModel},
		{"azure", "ada", embeddingModel},
		// Not priced means not billable, so not accepted.
		{"openai", "gpt-made-up", unknownModel},
		{"azure", "gpt-5.4", unknownModel},
		{"anthropic", "gpt-4o", unknownModel},
	}

	for _, c := range cases {
		if got := kindOfModel(c.provider, c.model); got != c.want {
			t.Errorf("kindOfModel(%q, %q) = %v, want %v", c.provider, c.model, got, c.want)
		}
	}
}

func TestGetRouteModelsListsThePriceTable(t *testing.T) {
	models := (&RouteManager{}).GetRouteModels()

	for provider, list := range models {
		for _, m := range list.Chat {
			if kindOfModel(provider, m) != chatModel {
				t.Errorf("%s chat list offers %s, which validation would refuse", provider, m)
			}
		}
		for _, m := range list.Embeddings {
			if kindOfModel(provider, m) != embeddingModel {
				t.Errorf("%s embeddings list offers %s, which validation would refuse", provider, m)
			}
		}
	}

	if len(models["openai"].Chat) == 0 {
		t.Fatal("openai offers no chat models")
	}
}
