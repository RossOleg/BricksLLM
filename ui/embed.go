// Package ui carries the admin panel that ships inside the binary.
//
// The panel is served from the admin server itself, at /admin, and that is the
// point: same origin means no CORS to configure, no preflight that cannot carry
// an api key, and a session cookie that the browser simply sends. It also means
// one artefact to deploy - no second web server, no second runtime.
//
// dist is the built output of the sources next to it. Rebuild it with
//
//	cd ui && npm install && npm run build
//
// and commit the result: the Go build embeds it, so a checkout without it does
// not compile.
package ui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Assets returns the built panel rooted at its index.html.
func Assets() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
