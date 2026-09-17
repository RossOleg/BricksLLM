package admin

import (
	"net/http"

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
