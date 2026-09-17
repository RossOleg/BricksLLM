package admin

import (
	"net/http"
	"strings"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/util"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// openToAnyone lists what answers before authentication.
//
// The health check carries no data and is what tells a container this process is
// alive. The panel and its assets are the login screen itself - they have to load
// for the password to be typed at all - and they contain nothing but the bundle
// that every client downloads. Login and logout do their own checking.
func openToAnyone(path string) bool {
	switch path {
	case "/api/health", "/api/login", "/api/logout":
		return true
	}

	return path == panelPrefix || strings.HasPrefix(path, panelPrefix+"/")
}

// requestRole reports the level of the caller: the admin key or the support key
// in a header, for scripts and curl, or the session cookie the panel gets from
// /api/login.
func requestRole(c *gin.Context, adminPass, supportPass string) (string, bool) {
	if presented := c.Request.Header.Get("X-API-KEY"); len(presented) != 0 {
		if presented == adminPass {
			return RoleFull, true
		}

		if len(supportPass) != 0 && presented == supportPass {
			return RoleSupport, true
		}

		return "", false
	}

	cookie, err := c.Request.Cookie(SessionCookieName)
	if err != nil {
		return "", false
	}

	return validSession(adminPass, cookie.Value)
}

func getAdminLoggerMiddleware(log *zap.Logger, prefix string, prod bool, adminPass, supportPass string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(adminPass) != 0 && !openToAnyone(c.FullPath()) {
			role, ok := requestRole(c, adminPass, supportPass)
			if !ok {
				// A rejected request used to be answered with an empty 200, which no
				// client could tell apart from an empty result - and which let the
				// health check pass only by accident.
				c.AbortWithStatusJSON(http.StatusUnauthorized, &ErrorResponse{
					Type:     "/errors/unauthorized",
					Title:    "api key is not valid",
					Status:   http.StatusUnauthorized,
					Detail:   "sign in at /admin, or send the admin key in the X-API-KEY header",
					Instance: c.FullPath(),
				})

				return
			}

			// The panel hides what a support session cannot do, but hiding is not
			// enforcing: the same person can call the api straight from a console.
			// This is where it is actually decided.
			if role == RoleSupport && !supportMayCall(c.Request.Method, c.FullPath()) {
				forbidden(c)
				return
			}

			c.Set(roleContextKey, role)
		}

		if len(adminPass) == 0 {
			// No password at all means no levels either: everything is open, and the
			// panel should not draw itself as if it were restricted.
			c.Set(roleContextKey, RoleFull)
		}

		cid := util.NewUuid()
		c.Set(util.STRING_CORRELATION_ID, cid)
		logWithCid := log.With(zap.String(util.STRING_CORRELATION_ID, cid))
		util.SetLogToCtx(c, logWithCid)

		start := time.Now()
		c.Next()
		latency := time.Since(start).Milliseconds()
		if !prod {
			logWithCid.Sugar().Infof("%s | %d | %s | %s | %dms", prefix, c.Writer.Status(), c.Request.Method, c.FullPath(), latency)
		}

		if prod {
			logWithCid.Info("request to admin management api",
				zap.Int("code", c.Writer.Status()),
				zap.String("method", c.Request.Method),
				zap.String("path", c.FullPath()),
				zap.Int64("lantecyInMs", latency),
			)
		}
	}
}
