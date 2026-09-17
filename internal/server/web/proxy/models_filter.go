package proxy

import (
	"encoding/json"

	"github.com/bricks-cloud/bricksllm/internal/provider"
)

// modelList is the shape of the /v1/models answer: a list of objects that each
// carry an id, and whatever else the provider felt like adding.
//
// The entries are kept as raw json so that filtering hands back exactly what the
// provider sent for the models that survive, fields we know nothing about
// included.
type modelList struct {
	Object string            `json:"object"`
	Data   []json.RawMessage `json:"data"`
}

type modelEntry struct {
	Id string `json:"id"`
}

// filterModelList narrows a /v1/models answer to the models the key is actually
// allowed to use.
//
// Without this, allowedModels on a provider setting is only half a restriction:
// requests to other models are refused, but the catalogue still advertises every
// model the upstream account has - which is how a picker ends up offering
// hundreds of entries, most of which would be rejected on use.
//
// Anything unexpected - a body that is not a model list, an entry without an id -
// leaves the response exactly as it came. A filter is not worth breaking a
// passthrough over.
func filterModelList(body []byte, settings []*provider.Setting) ([]byte, bool) {
	if !modelsAreRestricted(settings) {
		return body, false
	}

	list := &modelList{}
	if err := json.Unmarshal(body, list); err != nil || list.Object != "list" || list.Data == nil {
		return body, false
	}

	kept := make([]json.RawMessage, 0, len(list.Data))

	for _, raw := range list.Data {
		entry := &modelEntry{}
		if err := json.Unmarshal(raw, entry); err != nil || len(entry.Id) == 0 {
			continue
		}

		if isModelAllowed(entry.Id, settings) {
			kept = append(kept, raw)
		}
	}

	list.Data = kept

	filtered, err := json.Marshal(list)
	if err != nil {
		return body, false
	}

	return filtered, true
}

// modelsAreRestricted reports whether any restriction applies at all.
//
// isModelAllowed lets everything through as soon as one attached setting has an
// empty list, and the same has to hold here: a key that is not restricted must
// see the full catalogue rather than an empty one.
func modelsAreRestricted(settings []*provider.Setting) bool {
	if len(settings) == 0 {
		return false
	}

	for _, setting := range settings {
		if setting == nil || len(setting.AllowedModels) == 0 {
			return false
		}
	}

	return true
}

// settingsFromContext reads the provider settings the middleware resolved for
// this request.
func settingsFromContext(value any, ok bool) []*provider.Setting {
	if !ok {
		return nil
	}

	settings, _ := value.([]*provider.Setting)
	return settings
}
