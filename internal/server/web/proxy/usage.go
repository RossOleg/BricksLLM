package proxy

import (
	"net/http"
	"strings"

	"github.com/bricks-cloud/bricksllm/internal/hasher"
	"github.com/bricks-cloud/bricksllm/internal/key"
	"github.com/bricks-cloud/bricksllm/internal/telemetry"
	"github.com/gin-gonic/gin"
)

// costStorage keeps the lifetime spend of a key in micro dollars. It is the very
// counter the validator compares against costLimitInUsd before letting a request
// through, so what these endpoints report and what the gateway enforces cannot
// drift apart.
type costStorage interface {
	GetCounter(keyId string) (int64, error)
}

// costLimitCache keeps the spend of the current cost limit window, for keys that
// are capped per minute/hour/day instead of for their whole life.
type costLimitCache interface {
	GetCounter(keyId string, rateLimitUnit key.TimeUnit) (int64, error)
}

const microDollarsInUsd = 1000000.0

// UsageResponse carries no secrets: a caller authenticates with its own key and
// learns only what that key has spent. It says nothing about any other key, and
// the key value itself is never echoed back.
type UsageResponse struct {
	KeyId                  string  `json:"keyId"`
	Name                   string  `json:"name"`
	CreatedAt              int64   `json:"createdAt"`
	SpentInUsd             float64 `json:"spentInUsd"`
	CostLimitInUsd         float64 `json:"costLimitInUsd"`
	SpentInUsdOverTime     float64 `json:"spentInUsdOverTime"`
	CostLimitInUsdOverTime float64 `json:"costLimitInUsdOverTime"`
	CostLimitInUsdUnit     string  `json:"costLimitInUsdUnit"`
}

// CreditsResponse is the same balance with the money taken out of it: a client
// that must not learn what a request costs gets this one instead, and the rate
// never leaves this process.
//
// Limit and Remaining are null when the key has no limit at all.
type CreditsResponse struct {
	KeyId     string `json:"keyId"`
	Name      string `json:"name"`
	Used      int64  `json:"used"`
	Limit     *int64 `json:"limit"`
	Remaining *int64 `json:"remaining"`

	// LimitUnit is empty when the limit covers the whole life of the key, and
	// holds the window (d, h, m) when the key is capped per period instead - the
	// balance then belongs to the current window and resets with it.
	LimitUnit string `json:"limitUnit"`
}

// keyUsage is what both handlers read before they decide how to phrase it.
type keyUsage struct {
	key *key.ResponseKey

	spentLifetime float64
	limitLifetime float64

	spentWindow float64
	limitWindow float64

	// windowed says which of the two pairs is the balance that matters for this
	// key.
	windowed bool
}

func (u *keyUsage) spent() float64 {
	if u.windowed {
		return u.spentWindow
	}

	return u.spentLifetime
}

func (u *keyUsage) limit() float64 {
	if u.windowed {
		return u.limitWindow
	}

	return u.limitLifetime
}

// getApiKeyFromRequest mirrors the header precedence of the authenticator, so
// that a client which can call the proxy can call these endpoints the same way.
func getApiKeyFromRequest(req *http.Request) string {
	candidates := []string{
		req.Header.Get("x-api-key"),
		req.Header.Get("api-key"),
	}

	split := strings.Split(req.Header.Get("Authorization"), " ")
	if len(split) >= 2 {
		candidates = append(candidates, split[1])
	}

	for _, candidate := range candidates {
		if len(candidate) != 0 {
			return candidate
		}
	}

	return ""
}

// resolveKeyUsage authenticates the key that signs the request and reads what it
// has spent. On failure it answers the request itself and reports false.
//
// It exists so that a client holding one key can see its own balance without
// being handed an admin token. The admin API can only be filtered by
// keyId/tags/provider and has no lookup by key value, so the same question asked
// there means pulling the key list of the whole installation - other customers'
// secrets included - to find a single row. Nothing here reads more than the
// caller's own key.
func resolveKeyUsage(c *gin.Context, m KeyManager, cs costStorage, clc costLimitCache, metric string) (*keyUsage, bool) {
	raw := getApiKeyFromRequest(c.Request)
	if len(raw) == 0 {
		JSON(c, http.StatusUnauthorized, "[BricksLLM] api key not found in header")
		return nil, false
	}

	k, err := m.GetKeyViaCache(hasher.Hash(raw))

	if k == nil {
		// Keys issued before hashing was introduced are stored by value.
		k, err = m.GetKeyViaCache(raw)
	}

	if err != nil {
		// An unknown key comes back as an error, not as a nil key, exactly as it
		// does on the provider routes.
		if _, ok := err.(notFoundError); ok {
			telemetry.Incr(metric+".key_not_found", nil, 1)
			JSON(c, http.StatusUnauthorized, "[BricksLLM] key is not found")
			return nil, false
		}

		telemetry.Incr(metric+".get_key_error", nil, 1)
		JSON(c, http.StatusInternalServerError, "[BricksLLM] internal authentication error")
		return nil, false
	}

	// A revoked key is rejected here exactly as it is on the provider routes:
	// revocation has to mean the key opens nothing at all.
	if k == nil || k.Revoked {
		telemetry.Incr(metric+".key_not_found", nil, 1)
		JSON(c, http.StatusUnauthorized, "[BricksLLM] key is not found")
		return nil, false
	}

	spent, err := cs.GetCounter(k.KeyId)
	if err != nil {
		telemetry.Incr(metric+".get_counter_error", nil, 1)
		JSON(c, http.StatusInternalServerError, "[BricksLLM] failed to get total cost")
		return nil, false
	}

	usage := &keyUsage{
		key:           k,
		spentLifetime: float64(spent) / microDollarsInUsd,
		limitLifetime: k.CostLimitInUsd,
		limitWindow:   k.CostLimitInUsdOverTime,
	}

	if len(k.CostLimitInUsdUnit) != 0 {
		windowed, err := clc.GetCounter(k.KeyId, k.CostLimitInUsdUnit)
		if err != nil {
			telemetry.Incr(metric+".get_windowed_counter_error", nil, 1)
			JSON(c, http.StatusInternalServerError, "[BricksLLM] failed to get windowed cost")
			return nil, false
		}

		usage.spentWindow = float64(windowed) / microDollarsInUsd
	}

	// A key is capped either for its whole life or per window. When only a window
	// is set, the balance is the window's: reporting "no limit" while a daily cap
	// is in force would show more headroom than there is.
	usage.windowed = k.CostLimitInUsd <= 0 && k.CostLimitInUsdOverTime > 0

	return usage, true
}

// getUsageHandler reports the spend and the limit of the key that signs the
// request, in dollars.
//
// It stays available alongside /api/credits: the balance of a key is not secret
// from whoever holds that key, and the key is the whole access control here. What
// credits are for is the product surface, where a price per request has no
// business being shown - not for keeping the holder of a key from asking.
func getUsageHandler(m KeyManager, cs costStorage, clc costLimitCache) gin.HandlerFunc {
	const metric = "bricksllm.proxy.get_usage_handler"

	return func(c *gin.Context) {
		usage, ok := resolveKeyUsage(c, m, cs, clc, metric)
		if !ok {
			return
		}

		telemetry.Incr(metric+".success", nil, 1)

		c.JSON(http.StatusOK, UsageResponse{
			KeyId:                  usage.key.KeyId,
			Name:                   usage.key.Name,
			CreatedAt:              usage.key.CreatedAt,
			SpentInUsd:             usage.spentLifetime,
			CostLimitInUsd:         usage.limitLifetime,
			SpentInUsdOverTime:     usage.spentWindow,
			CostLimitInUsdOverTime: usage.limitWindow,
			CostLimitInUsdUnit:     string(usage.key.CostLimitInUsdUnit),
		})
	}
}

// getCreditsHandler reports the same balance in credits, so that a caller which
// must not learn what a request costs never receives a sum at all.
//
// How dollars become credits, and how far that hides them, is CreditsScale.
func getCreditsHandler(m KeyManager, cs costStorage, clc costLimitCache, scale CreditsScale) gin.HandlerFunc {
	const metric = "bricksllm.proxy.get_credits_handler"

	return func(c *gin.Context) {
		if !scale.enabled() {
			telemetry.Incr(metric+".disabled", nil, 1)
			JSON(c, http.StatusNotFound, "[BricksLLM] credits are not configured on this gateway")
			return
		}

		usage, ok := resolveKeyUsage(c, m, cs, clc, metric)
		if !ok {
			return
		}

		used := scale.spent(usage.spent())

		response := CreditsResponse{
			KeyId: usage.key.KeyId,
			Name:  usage.key.Name,
			Used:  used,
		}

		if usage.windowed {
			response.LimitUnit = string(usage.key.CostLimitInUsdUnit)
		}

		// Whether there is a limit at all is decided on the dollar figure, never on
		// the converted one: a limit that rounded down to nothing would otherwise be
		// reported as no limit.
		if limitUsd := usage.limit(); limitUsd > 0 {
			limit := scale.allowance(limitUsd)

			remaining := limit - used
			if remaining < 0 {
				remaining = 0
			}

			response.Limit = &limit
			response.Remaining = &remaining
		}

		telemetry.Incr(metric+".success", nil, 1)

		c.JSON(http.StatusOK, response)
	}
}
