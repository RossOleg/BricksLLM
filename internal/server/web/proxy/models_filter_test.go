package proxy

import (
	"encoding/json"
	"testing"

	"github.com/bricks-cloud/bricksllm/internal/provider"
)

const catalogue = `{"object":"list","data":[
	{"id":"gpt-5.4-nano","object":"model","owned_by":"openai","created":1},
	{"id":"gpt-6-astra","object":"model","owned_by":"openai","created":2},
	{"id":"whisper-1","object":"model","owned_by":"openai","created":3}
]}`

func ids(t *testing.T, body []byte) []string {
	t.Helper()

	list := &modelList{}
	if err := json.Unmarshal(body, list); err != nil {
		t.Fatal(err)
	}

	out := []string{}
	for _, raw := range list.Data {
		entry := &modelEntry{}
		if err := json.Unmarshal(raw, entry); err != nil {
			t.Fatal(err)
		}
		out = append(out, entry.Id)
	}

	return out
}

func TestModelListIsNarrowedToWhatTheKeyMayUse(t *testing.T) {
	settings := []*provider.Setting{{AllowedModels: []string{"gpt-5.4-nano", "whisper-1"}}}

	filtered, changed := filterModelList([]byte(catalogue), settings)
	if !changed {
		t.Fatal("a restricted key must see a narrowed catalogue")
	}

	got := ids(t, filtered)
	if len(got) != 2 || got[0] != "gpt-5.4-nano" || got[1] != "whisper-1" {
		t.Fatalf("models = %v", got)
	}

	// Поля, о которых фильтр ничего не знает, должны доехать как были.
	list := &modelList{}
	if err := json.Unmarshal(filtered, list); err != nil {
		t.Fatal(err)
	}

	var entry map[string]any
	if err := json.Unmarshal(list.Data[0], &entry); err != nil {
		t.Fatal(err)
	}

	if entry["owned_by"] != "openai" || entry["created"] == nil {
		t.Fatalf("fields were lost: %v", entry)
	}
}

func TestModelListIsUntouchedWithoutARestriction(t *testing.T) {
	cases := map[string][]*provider.Setting{
		"без настроек":             nil,
		"пустой список моделей":    {{AllowedModels: nil}},
		"одна из настроек открыта": {{AllowedModels: []string{"gpt-5.4-nano"}}, {AllowedModels: nil}},
	}

	for name, settings := range cases {
		t.Run(name, func(t *testing.T) {
			filtered, changed := filterModelList([]byte(catalogue), settings)
			if changed {
				t.Fatal("каталог не должен был измениться")
			}

			if len(ids(t, filtered)) != 3 {
				t.Fatal("модели пропали там, где ограничения нет")
			}
		})
	}
}

func TestModelListSurvivesAnUnexpectedBody(t *testing.T) {
	settings := []*provider.Setting{{AllowedModels: []string{"gpt-5.4-nano"}}}

	for _, body := range []string{
		`{"error":{"message":"nope"}}`,
		`not json at all`,
		`{"object":"list"}`,
		``,
	} {
		filtered, changed := filterModelList([]byte(body), settings)
		if changed {
			t.Fatalf("тело %q не является каталогом и должно уйти как есть", body)
		}

		if string(filtered) != body {
			t.Fatalf("тело изменено: %q", string(filtered))
		}
	}
}
