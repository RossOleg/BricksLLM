package manager

import (
	"errors"
	"fmt"
	"strings"
	"time"

	internal_errors "github.com/bricks-cloud/bricksllm/internal/errors"
	"github.com/bricks-cloud/bricksllm/internal/provider"
	"github.com/bricks-cloud/bricksllm/internal/provider/azure"
	"github.com/bricks-cloud/bricksllm/internal/provider/openai"
	"github.com/bricks-cloud/bricksllm/internal/route"
	"github.com/bricks-cloud/bricksllm/internal/util"
)

type RoutesStorage interface {
	CreateRoute(r *route.Route) (*route.Route, error)
	GetRoute(id string) (*route.Route, error)
	GetRoutes() ([]*route.Route, error)
	GetRouteByPath(path string) (*route.Route, error)
	DeleteRoute(id string) error
}

type RoutesMemStorage interface {
	GetRoute(id string) *route.Route
}

type PsManager interface {
	GetSettingsViaCache(ids []string) ([]*provider.Setting, error)
}

type RouteManager struct {
	s  RoutesStorage
	ks Storage
	ms RoutesMemStorage
	ps PsManager
}

func NewRouteManager(s RoutesStorage, ks Storage, ms RoutesMemStorage, psm PsManager) *RouteManager {
	return &RouteManager{
		s:  s,
		ks: ks,
		ms: ms,
		ps: psm,
	}
}

func (m *RouteManager) GetRouteFromMemDb(path string) *route.Route {
	return m.ms.GetRoute(path)
}

func (m *RouteManager) GetRoute(id string) (*route.Route, error) {
	return m.s.GetRoute(id)
}

func (m *RouteManager) DeleteRoute(id string) error {
	return m.s.DeleteRoute(id)
}

func (m *RouteManager) GetRoutes() ([]*route.Route, error) {
	return m.s.GetRoutes()
}

func (m *RouteManager) CreateRoute(r *route.Route) (*route.Route, error) {
	r.CreatedAt = time.Now().Unix()
	r.UpdatedAt = time.Now().Unix()
	r.Id = util.NewUuid()

	if err := m.validateRoute(r); err != nil {
		return nil, err
	}

	addDefaultValues(r)

	return m.s.CreateRoute(r)
}

func addDefaultValues(r *route.Route) {
	if r.CacheConfig != nil && r.CacheConfig.Enabled && len(r.CacheConfig.Ttl) == 0 {
		r.CacheConfig.Ttl = "168h"
	}

	for _, step := range r.Steps {
		if len(step.Timeout) == 0 {
			step.Timeout = "5m"
		}
	}

}

// The models a route step may use come from the price tables of the providers,
// not from a list kept here. This used to be four hardcoded slices that stopped
// at gpt-4o and were never updated when models were added to the price table,
// so a route could not use anything newer. A model that is not priced would be
// recorded as free anyway, so "priced" is the right test for "supported".

// modelKind is what a step's model does: routes may not mix the two, because
// one request body cannot be both a chat completion and an embeddings call.
type modelKind int

const (
	unknownModel modelKind = iota
	chatModel
	embeddingModel
)

func kindOfModel(provider, model string) modelKind {
	switch provider {
	case "openai":
		if openai.IsEmbeddingModel(model) {
			return embeddingModel
		}
		if openai.IsChatModel(model) {
			return chatModel
		}
	case "azure":
		if azure.IsEmbeddingModel(model) {
			return embeddingModel
		}
		if azure.IsChatModel(model) {
			return chatModel
		}
	}

	return unknownModel
}

var supportedProviders = []string{
	"openai",
	"azure",
}

// GetRouteModels lists, per provider, the models a route step may use.
func (m *RouteManager) GetRouteModels() map[string]route.Models {
	return map[string]route.Models{
		"openai": {Chat: openai.ChatModels(), Embeddings: openai.EmbeddingModels()},
		"azure":  {Chat: azure.ChatModels(), Embeddings: azure.EmbeddingModels()},
	}
}

func contains(target string, source []string) bool {
	for _, s := range source {
		if s == target {
			return true
		}
	}

	return false
}

func (m *RouteManager) validateRoute(r *route.Route) error {
	fields := []string{}

	if len(r.Name) == 0 {
		fields = append(fields, "name")
	}

	if len(r.Path) == 0 {
		fields = append(fields, "path")
	}

	if len(r.KeyIds) == 0 {
		fields = append(fields, "keyIds")
	}

	if len(r.Steps) == 0 {
		fields = append(fields, "steps")
	}

	if len(r.RetryStrategy) != 0 && r.RetryStrategy != "exponential" && r.RetryStrategy != "constant" {
		fields = append(fields, "retryStrategy")
	}

	routeKind := unknownModel

	for index, step := range r.Steps {
		if len(step.Provider) == 0 {
			fields = append(fields, fmt.Sprintf("steps.[%d].provider", index))
		}

		if len(step.RetryInterval) != 0 {
			_, err := time.ParseDuration(step.RetryInterval)
			if err != nil {
				fields = append(fields, fmt.Sprintf("steps.[%d].retryInterval", index))
			}

			if !strings.HasSuffix(step.RetryInterval, "s") && !strings.HasSuffix(step.RetryInterval, "ms") {
				fields = append(fields, fmt.Sprintf("steps.[%d].retryInterval", index))
			}
		}

		if !contains(step.Provider, supportedProviders) {
			return fmt.Errorf("steps.[%d].provider is not supported. Only azure and openai are supported", index)
		}

		if step.Provider == "azure" {
			apiVersion := step.Params["apiVersion"]
			if len(apiVersion) == 0 {
				fields = append(fields, fmt.Sprintf("steps.[%d].params.apiVersion", index))
			}

			deploymentId := step.Params["deploymentId"]
			if len(deploymentId) == 0 {
				fields = append(fields, fmt.Sprintf("steps.[%d].params.deploymentId", index))
			}
		}

		if len(step.Model) == 0 {
			fields = append(fields, fmt.Sprintf("steps.[%d].model", index))
		}

		if val, ok := step.RequestParams["frequency_penalty"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.frequency_penalty", index))
			}
		}

		if val, ok := step.RequestParams["max_tokens"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.max_tokens", index))
			}
		}

		if val, ok := step.RequestParams["temperature"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.temperature", index))
			}
		}

		if val, ok := step.RequestParams["top_p"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.top_p", index))
			}
		}

		if val, ok := step.RequestParams["n"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.n", index))
			}
		}

		if val, ok := step.RequestParams["stop"]; ok {
			parsed, ok := val.([]any)
			if !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.stop", index))
			}

			if ok {
				converted := route.ConvertToArrayOfStrings(parsed)
				if len(converted) == 0 {
					fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.stop", index))
				}
			}
		}

		if val, ok := step.RequestParams["presence_penalty"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.presence_penalty", index))
			}
		}

		if val, ok := step.RequestParams["seed"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.seed", index))
			}
		}

		if val, ok := step.RequestParams["logit_bias"]; ok {
			parsed, ok := val.(map[string]any)
			if !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.logit_bias", index))
			}

			if ok {
				converted := route.ConvertToMapOfIntegers(parsed)
				if len(converted) == 0 {
					fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.logit_bias", index))
				}
			}
		}

		if val, ok := step.RequestParams["logprobs"]; ok {
			if _, ok := val.(bool); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.logprobs", index))
			}
		}

		if val, ok := step.RequestParams["top_logprobs"]; ok {
			if _, ok := val.(float64); !ok {
				fields = append(fields, fmt.Sprintf("steps.[%d].requestParams.top_logprobs", index))
			}
		}

		kind := kindOfModel(step.Provider, step.Model)
		if kind == unknownModel {
			return fmt.Errorf("steps.[%d].model %s is not in the %s price table, so the gateway could not bill it", index, step.Model, step.Provider)
		}

		if index == 0 {
			routeKind = kind
		} else if kind != routeKind {
			return errors.New("steps must have congruent models. Chat completion and embedding models cannot be in the same route config")
		}
	}

	if r.CacheConfig == nil {
		fields = append(fields, "cacheConfig")
	}

	if r.CacheConfig != nil && len(r.CacheConfig.Ttl) != 0 {
		parsed, err := time.ParseDuration(r.CacheConfig.Ttl)
		if err != nil {
			fields = append(fields, "cacheConfig.ttl")
		}

		max := time.Hour * 720

		if parsed > max {
			return internal_errors.NewValidationError("cacheConfig.ttl exceedes 30 days")
		}
	}

	found, err := m.ks.GetKeys(nil, r.KeyIds, "")
	if err != nil {
		return err
	}

	for _, key := range found {
		settingIds := key.GetSettingIds()
		settings, err := m.ps.GetSettingsViaCache(settingIds)
		if err != nil {
			return err
		}

		if !r.ValidateSettings(settings) {
			return errors.New("provider settings assosciated with the key cannot for accessing models specified in the route")
		}
	}

	_, err = m.s.GetRouteByPath(r.Path)
	if err == nil {
		return internal_errors.NewValidationError("path is not unique")
	}

	if _, ok := err.(notFoundError); !ok {
		return err
	}

	if len(found) != len(r.KeyIds) {
		return internal_errors.NewValidationError("specified key ids are not found")
	}

	if len(fields) != 0 {
		return internal_errors.NewValidationError(fmt.Sprintf("invalid fields in route: %s", strings.Join(fields, ",")))
	}

	return nil
}
