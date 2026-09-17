package admin

import (
	"errors"
	"fmt"
	"net/http"

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
//   - provider settings are needed because a key must name the setting it uses -
//     and they come back with their secrets stripped, see redactSettings;
//   - the spend of a single key answers "how much has this customer used".
//
// What is not in it: every write that changes how the proxy behaves - provider
// settings, routes, custom providers, policies, users - and every change to an
// existing key. Events are left out too: they are harmless to the gateway but
// they hold the prompts and images customers sent.
var supportRoutes = map[string]bool{
	"PUT /api/key-management/keys":     true,
	"GET /api/key-management/keys":     true,
	"POST /api/v2/key-management/keys": true,
	"GET /api/provider-settings":       true,
	"GET /api/reporting/keys/:id":      true,
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
func applySupportKeyPolicy(rk *key.RequestKey) error {
	if rk.CostLimitInUsd <= 0 {
		return errors.New("costLimitInUsd is required and must be greater than zero")
	}

	for _, field := range supportKeyFields {
		if field.set(rk) {
			return fmt.Errorf("%s can only be set with the full admin password", field.name)
		}
	}

	rk.Tags = []string{SupportKeyTag}

	return nil
}
