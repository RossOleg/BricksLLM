package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/hasher"
	"github.com/bricks-cloud/bricksllm/internal/provider"
	"github.com/bricks-cloud/bricksllm/internal/telemetry"
	"github.com/bricks-cloud/bricksllm/internal/util"
	"github.com/gin-gonic/gin"
	goopenai "github.com/sashabaranov/go-openai"
	"go.uber.org/zap"
)

// ModelsListPath is the catalogue listing, kept in one place because three
// different files have to agree on which route it is.
const ModelsListPath = "/api/providers/openai/v1/models"

// modelsCacheKey is the cache entry for one upstream account.
//
// The entry is keyed by the upstream key rather than by the provider setting:
// the answer belongs to the account, so two settings holding the same key share
// it, and rotating a key silently starts a new entry instead of serving the old
// account's catalogue.
//
// The key itself is hashed and never stored - what lands in redis is a hash of
// a hash, and nothing in this package logs either.
func modelsCacheKey(authorization string) string {
	return "models:openai:v1:" + hasher.Hash(authorization)
}

// getListModelsHandler answers GET /v1/models, from redis when it can.
//
// The catalogue is free to ask for, identical for every holder of the same
// upstream key, and changes when OpenAI ships a model - yet clients ask for it
// on every settings save and before batches of work, and each ask costs an
// upstream round trip. Caching it turns that into a redis read.
//
// The upstream answer is cached before it is narrowed to what the key may use:
// the restriction belongs to the provider setting, not to the account, so the
// filter has to run per request over the shared entry.
func getListModelsHandler(prod, private bool, client http.Client, ca cache, ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)

		tags := []string{
			fmt.Sprintf("path:%s", c.FullPath()),
		}

		telemetry.Incr("bricksllm.proxy.get_list_models_handler.requests", tags, 1)

		if c == nil || c.Request == nil {
			JSON(c, http.StatusInternalServerError, "[BricksLLM] context is empty")
			return
		}

		settings := settingsFromContext(c.Get("settings"))
		cacheKey := modelsCacheKey(c.Request.Header.Get("Authorization"))

		if ttl > 0 {
			// A miss is the ordinary state after a restart or once the entry
			// expires, and redis being unreachable looks the same from here. Both
			// mean the same thing - ask the provider - so neither is an error.
			if cached, err := ca.GetBytes(cacheKey); err == nil && len(cached) != 0 {
				telemetry.Incr("bricksllm.proxy.get_list_models_handler.cache_hit", tags, 1)
				respondWithCatalogue(c, log, cached, settings, prod)
				return
			}

			telemetry.Incr("bricksllm.proxy.get_list_models_handler.cache_miss", tags, 1)
		}

		ctx, cancel := context.WithTimeout(context.Background(), c.GetDuration("requestTimeout"))
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.openai.com/v1/models", nil)
		if err != nil {
			logError(log, "error when creating openai list models request", prod, err)
			JSON(c, http.StatusInternalServerError, "[BricksLLM] failed to create openai http request")
			return
		}

		copyHttpHeaders(c.Request, req, c.GetBool("removeUserAgent"))

		// copyHttpHeaders asks for any encoding, which leaves it to the provider
		// whether the body arrives compressed. Here the body is parsed, filtered
		// and stored, so it has to be plain json: dropping the header lets the
		// transport negotiate gzip and unwrap it before we ever see it.
		req.Header.Del("Accept-Encoding")

		start := time.Now()

		res, err := client.Do(req)
		if err != nil {
			telemetry.Incr("bricksllm.proxy.get_list_models_handler.http_client_error", tags, 1)
			logError(log, "error when listing openai models", prod, err)
			JSON(c, http.StatusInternalServerError, "[BricksLLM] failed to send list models request to openai")
			return
		}
		defer res.Body.Close()

		dur := time.Since(start)
		telemetry.Timing("bricksllm.proxy.get_list_models_handler.latency", dur, tags, 1)

		body, err := io.ReadAll(res.Body)
		if err != nil {
			logError(log, "error when reading openai list models response body", prod, err)
			JSON(c, http.StatusInternalServerError, "[BricksLLM] failed to read openai list models response body")
			return
		}

		if res.StatusCode != http.StatusOK {
			telemetry.Incr("bricksllm.proxy.get_list_models_handler.error_response", tags, 1)

			errorRes := &goopenai.ErrorResponse{}
			if err := json.Unmarshal(body, errorRes); err != nil {
				logError(log, "error when unmarshalling openai list models error response body", prod, err)
			}

			logOpenAiError(log, prod, errorRes)

			// A refusal is not cached: it is usually a key that was just typed
			// wrong, and holding on to it would outlive the fix.
			for name, values := range res.Header {
				for _, value := range values {
					c.Header(name, value)
				}
			}

			c.Data(res.StatusCode, res.Header.Get("content-type"), body)
			return
		}

		telemetry.Incr("bricksllm.proxy.get_list_models_handler.success", tags, 1)
		telemetry.Timing("bricksllm.proxy.get_list_models_handler.success_latency", dur, tags, 1)

		if ttl > 0 {
			if err := ca.StoreBytes(cacheKey, body, ttl); err != nil {
				telemetry.Incr("bricksllm.proxy.get_list_models_handler.cache_store_error", tags, 1)
				logError(log, "error when caching the openai model catalogue", prod, err)
			}
		}

		respondWithCatalogue(c, log, body, settings, prod)
	}
}

// respondWithCatalogue narrows the catalogue to what this key may use and sends
// it.
//
// Without the narrowing, allowedModels on a provider setting is only half a
// restriction: requests to other models are refused, but the catalogue still
// advertises every model the upstream account has.
func respondWithCatalogue(c *gin.Context, log *zap.Logger, catalogue []byte, settings []*provider.Setting, prod bool) {
	if filtered, changed := filterModelList(catalogue, settings); changed {
		catalogue = filtered
	}

	logListModelsResponse(log, catalogue, prod)

	c.Data(http.StatusOK, "application/json", catalogue)
}
