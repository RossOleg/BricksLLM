package admin

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// panelPrefix is where the embedded admin panel lives.
const panelPrefix = "/admin"

// panelContentTypes is what the panel actually ships.
//
// mime.TypeByExtension is not trusted on its own because on Windows it answers
// from the registry, where .js has been known to come back as text/plain - which
// a browser then refuses to execute as a module. This table is the same on every
// machine that builds this binary.
var panelContentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".webp":  "image/webp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".txt":   "text/plain; charset=utf-8",
	".map":   "application/json",
}

func panelContentType(name string) string {
	extension := strings.ToLower(path.Ext(name))

	if known, ok := panelContentTypes[extension]; ok {
		return known
	}

	if guessed := mime.TypeByExtension(extension); guessed != "" {
		return guessed
	}

	return "application/octet-stream"
}

// registerPanel serves the panel from the binary, same origin with the api it
// talks to. That is what removes CORS from the picture: there is no second
// origin, so there is no preflight - which could never have carried the api key
// header anyway.
func registerPanel(router *gin.Engine, assets fs.FS) {
	serve := func(c *gin.Context) {
		requested := strings.TrimPrefix(c.Param("path"), "/")

		if requested == "" {
			requested = "index.html"
		}

		data, err := fs.ReadFile(assets, requested)
		if err != nil {
			// The panel routes in the browser, so a path this file system does not
			// know is handed the shell rather than a 404: reloading /admin/keys has
			// to work.
			requested = "index.html"

			data, err = fs.ReadFile(assets, requested)
			if err != nil {
				c.JSON(http.StatusNotFound, &ErrorResponse{
					Type:     "/errors/panel-missing",
					Title:    "admin panel is not built into this binary",
					Status:   http.StatusNotFound,
					Detail:   "build it with npm run build in ui, then rebuild the binary",
					Instance: c.FullPath(),
				})

				return
			}
		}

		if requested == "index.html" {
			// The shell names the hashed bundles, so caching it would pin the panel
			// to an old build across a deploy.
			c.Header("Cache-Control", "no-store")
		} else {
			// Everything else carries a content hash in its name and can be kept.
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		}

		// Written directly rather than through http.FileServer, which answers a
		// request for index.html with a redirect to "./" - and would bounce /admin/
		// back and forth.
		c.Data(http.StatusOK, panelContentType(requested), data)
	}

	// Only the wildcard is registered. Gin redirects /admin to /admin/ by itself
	// for a route shaped like this; registering the bare path as well would make
	// the two redirect to each other.
	router.GET(panelPrefix+"/*path", serve)
	router.HEAD(panelPrefix+"/*path", serve)
}
