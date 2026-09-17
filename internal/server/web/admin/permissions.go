package admin

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"

	"github.com/bricks-cloud/bricksllm/internal/key"
	"github.com/bricks-cloud/bricksllm/internal/provider"
	"github.com/gin-gonic/gin"
)

// supportRoutes is everything a support session may call.
//
// The list is deliberately an allow list rather than a deny list: a route added
// to this server later is out of reach until someone decides otherwise, which is
// the safe direction for a level whose whole purpose is "cannot break the
// gateway".
//
// What is in it and why:
//   - creating a key is the job;
//   - listing keys is how you check what already exists before issuing another;
//   - the spend of a single key answers "how much has this customer used".
//
// Provider settings are not in it: a support session never names one, because
// the server picks it - see resolveSupportSetting.
//
// What is not in it: every write that changes how the proxy behaves - provider
// settings, routes, custom providers, policies, users - and every change to an
// existing key. Events are left out too: they are harmless to the gateway but
// they hold the prompts and images customers sent.
var supportRoutes = map[string]bool{
	"PUT /api/key-management/keys":     true,
	"GET /api/key-management/keys":     true,
	"POST /api/v2/key-management/keys": true,
	"GET /api/reporting/keys/:id":      true,
	"POST /api/reporting/keys":         true,
}

func supportMayCall(method, route string) bool {
	return supportRoutes[method+" "+route]
}

// redactSettings copies provider settings without the secrets in them.
//
// A support session needs to know which settings exist, to point a new key at
// one. It must not learn the upstream provider key that sits in the same object,
// which is what GET /api/provider-settings hands out in full.
//
// The originals belong to a shared cache, so they are copied rather than edited.
func redactSettings(settings []*provider.Setting) []*provider.Setting {
	redacted := make([]*provider.Setting, 0, len(settings))

	for _, setting := range settings {
		if setting == nil {
			continue
		}

		clone := *setting
		clone.Setting = nil

		redacted = append(redacted, &clone)
	}

	return redacted
}

// forbidden answers a request that the current level is not allowed to make.
func forbidden(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, &ErrorResponse{
		Type:     "/errors/forbidden",
		Title:    "this session may only issue keys",
		Status:   http.StatusForbidden,
		Detail:   "unlock the panel with the full admin password to do this",
		Instance: c.FullPath(),
	})
}

// SupportKeyTag is the group every key a support session issues belongs to.
//
// It is set here rather than taken from the request: the grouping is the
// operator's, not the caller's, and "find every key support handed out" has to
// keep working even if a client forgets to send it.
const SupportKeyTag = "client"

// supportKeyFields are the fields a support session may not set on a new key.
//
// They are all ways to shape the limit, and a level that exists so that keys
// cannot be handed out unbounded has no business with them. The cost limit
// itself is required instead - see applySupportKeyPolicy.
var supportKeyFields = []struct {
	name string
	set  func(rk *key.RequestKey) bool
}{
	{"costLimitInUsdOverTime", func(rk *key.RequestKey) bool { return rk.CostLimitInUsdOverTime != 0 }},
	{"costLimitInUsdUnit", func(rk *key.RequestKey) bool { return len(rk.CostLimitInUsdUnit) != 0 }},
	{"rateLimitOverTime", func(rk *key.RequestKey) bool { return rk.RateLimitOverTime != 0 }},
	{"rateLimitUnit", func(rk *key.RequestKey) bool { return len(rk.RateLimitUnit) != 0 }},
	{"ttl", func(rk *key.RequestKey) bool { return len(rk.Ttl) != 0 }},
	{"allowedPaths", func(rk *key.RequestKey) bool { return len(rk.AllowedPaths) != 0 }},
	{"policyId", func(rk *key.RequestKey) bool { return len(rk.PolicyId) != 0 }},
	{"rotationEnabled", func(rk *key.RequestKey) bool { return rk.RotationEnabled }},
}

// applySupportKeyPolicy narrows a new key to what a support session may issue.
//
// The panel draws only the fields below, but drawing is not enforcing: the same
// person can post whatever they like straight to the api. This is where it is
// decided.
// supportKeyValue is the shape of a key a support session may hand out: our own
// prefix and a uuid. The panel generates it and never lets it be typed, and this
// keeps that true for anything that talks to the api directly.
//
// The prefix is what tells the rest of the platform the key is ours - it is the
// same check the catalog side makes before asking this gateway about a balance.
var supportKeyValue = regexp.MustCompile(`^dam-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// resolveSupportSetting decides which provider setting a support key points at.
//
// A support session is never asked to choose, so the answer has to be
// unambiguous: the configured one, or the only one there is.
func resolveSupportSetting(settings []*provider.Setting, configured string) (string, error) {
	if len(configured) != 0 {
		for _, setting := range settings {
			if setting != nil && setting.Id == configured {
				return configured, nil
			}
		}

		return "", fmt.Errorf("SUPPORT_SETTING_ID names a provider setting that does not exist: %s", configured)
	}

	if len(settings) == 1 && settings[0] != nil {
		return settings[0].Id, nil
	}

	if len(settings) == 0 {
		return "", errors.New("this gateway has no provider settings yet, so there is nothing for a key to use")
	}

	return "", errors.New("this gateway has several provider settings; set SUPPORT_SETTING_ID to say which one support issues keys for")
}

func applySupportKeyPolicy(rk *key.RequestKey, settings []*provider.Setting, configuredSetting string) error {
	if rk.CostLimitInUsd <= 0 {
		return errors.New("costLimitInUsd is required and must be greater than zero")
	}

	if !supportKeyValue.MatchString(rk.Key) {
		return errors.New("the key has to be a generated one: dam- followed by a uuid")
	}

	settingId, err := resolveSupportSetting(settings, configuredSetting)
	if err != nil {
		return err
	}

	// Chosen here rather than taken from the request, so that a support session
	// cannot point a key at a provider setting it was never meant to use.
	rk.SettingId = ""
	rk.SettingIds = []string{settingId}

	for _, field := range supportKeyFields {
		if field.set(rk) {
			return fmt.Errorf("%s can only be set with the full admin password", field.name)
		}
	}

	rk.Tags = []string{SupportKeyTag}

	return nil
}
