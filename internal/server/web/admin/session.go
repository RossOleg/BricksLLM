package admin

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// SessionCookieName holds the browser session of the admin panel.
//
// The panel used to keep the admin key in localStorage and attach it to every
// request from JavaScript. That key is not a scoped token: it lists every key of
// the installation in the clear, creates and revokes keys, and reads provider
// settings - which hold the upstream provider keys. One cross-site script on the
// page, or one bad dependency in the bundle, and all of that leaves with it.
//
// So the password is exchanged once for this cookie, which is HttpOnly and
// therefore unreadable from script. The cookie is not the password and cannot be
// turned back into it: it carries a role, an expiry, and a signature over both.
const SessionCookieName = "bricksllm_session"

// sessionTtl is how long a panel login lasts before the password is asked again.
const sessionTtl = 12 * time.Hour

// Two levels of access, so that whoever issues keys day to day does not also
// hold the ability to break the gateway.
//
// RoleSupport may create keys and little else. RoleFull is everything, and is
// reached by entering the second password - which lives in this server's
// environment, not in the bundle the browser downloads. A restriction that the
// panel merely draws is not a restriction at all: the same person can open the
// developer console and call the api directly, so the line is held here.
const (
	RoleSupport = "support"
	RoleFull    = "full"
)

// roleContextKey carries the level of the current request to the handlers that
// need to answer differently for each.
const roleContextKey = "bricksllm_role"

// LoginRequest is what the panel posts to exchange a password for a session.
type LoginRequest struct {
	Password string `json:"password"`
}

// signSession builds an opaque token that this process can verify without
// keeping any session state: the role and the expiry, plus a signature over both.
//
// The signing key is derived from the full admin password, so changing it
// invalidates every session issued under the old one - which is what anyone
// rotating a leaked secret expects to happen. It also means a support session
// cannot be forged by someone who only knows the support password.
func signSession(adminPass, role string, expiry int64) string {
	payload := role + ":" + strconv.FormatInt(expiry, 10)

	mac := hmac.New(sha256.New, sessionSigningKey(adminPass))
	mac.Write([]byte(payload))

	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func sessionSigningKey(adminPass string) []byte {
	sum := sha256.Sum256([]byte("bricksllm session v2|" + adminPass))
	return sum[:]
}

// validSession reports the role a token carries, if this process issued it and
// it has not expired yet.
func validSession(adminPass, token string) (string, bool) {
	payload, signature, found := strings.Cut(token, ".")
	if !found {
		return "", false
	}

	role, rawExpiry, found := strings.Cut(payload, ":")
	if !found {
		return "", false
	}

	if role != RoleSupport && role != RoleFull {
		return "", false
	}

	expiry, err := strconv.ParseInt(rawExpiry, 10, 64)
	if err != nil {
		return "", false
	}

	if time.Now().Unix() >= expiry {
		return "", false
	}

	mac := hmac.New(sha256.New, sessionSigningKey(adminPass))
	mac.Write([]byte(payload))

	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	// Constant time, so that the comparison cannot be turned into an oracle by
	// timing how long a wrong signature takes to reject.
	if subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) != 1 {
		return "", false
	}

	return role, true
}

// isSecureRequest reports whether the response can set a Secure cookie without
// the browser dropping it.
//
// A gateway behind a TLS terminator does not see TLS itself, hence the forwarded
// header; a panel opened over plain http on a local machine would lose the
// cookie entirely if Secure were set unconditionally.
func isSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}

	return strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")
}

func setSessionCookie(c *gin.Context, value string, maxAge int) {
	// SameSite=Strict is also what keeps another site from riding this session:
	// the panel is same origin with the api, so nothing legitimate is lost.
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isSecureRequest(c),
		SameSite: http.SameSiteStrictMode,
	})
}

// getLoginHandler exchanges a password for a session.
//
// The same endpoint serves both the first sign in and the step up to full
// access: which one happened is decided by which password was sent, never by
// what the caller asks for.
func getLoginHandler(adminPass, supportPass string) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := "/api/login"

		if len(adminPass) == 0 {
			// Nothing to check against: this gateway runs without a password, so a
			// session would be a ceremony that protects nothing.
			c.JSON(http.StatusNotFound, &ErrorResponse{
				Type:     "/errors/login-disabled",
				Title:    "login is not available",
				Status:   http.StatusNotFound,
				Detail:   "this gateway runs without an admin key, so there is nothing to log in with",
				Instance: path,
			})

			return
		}

		request := &LoginRequest{}
		if err := c.ShouldBindJSON(request); err != nil {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/request-body-read",
				Title:    "request body cannot be parsed",
				Status:   http.StatusBadRequest,
				Detail:   "the body must be a json object with a password field",
				Instance: path,
			})

			return
		}

		role := ""

		// Constant time on both, and the full password is checked first so that a
		// support password that somehow equals it cannot downgrade the session.
		if subtle.ConstantTimeCompare([]byte(request.Password), []byte(adminPass)) == 1 {
			role = RoleFull
		} else if len(supportPass) != 0 &&
			subtle.ConstantTimeCompare([]byte(request.Password), []byte(supportPass)) == 1 {
			role = RoleSupport
		}

		if role == "" {
			c.JSON(http.StatusUnauthorized, &ErrorResponse{
				Type:     "/errors/unauthorized",
				Title:    "password is not valid",
				Status:   http.StatusUnauthorized,
				Detail:   "the password does not match",
				Instance: path,
			})

			return
		}

		expiry := time.Now().Add(sessionTtl)

		setSessionCookie(c, signSession(adminPass, role, expiry.Unix()), int(sessionTtl.Seconds()))

		c.JSON(http.StatusOK, gin.H{"role": role, "expiresAt": expiry.Unix()})
	}
}

// getLogoutHandler drops the session cookie.
func getLogoutHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		setSessionCookie(c, "", -1)
		c.Status(http.StatusNoContent)
	}
}

// getSessionHandler tells the panel which level it is running at, so that it can
// draw the matching amount of itself. The answer is advisory: what a session may
// actually call is decided by the middleware on every request.
func getSessionHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"role": c.GetString(roleContextKey)})
	}
}
