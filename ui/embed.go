// Package ui carries the admin panel that ships inside the binary.
//
// The panel is served from the admin server itself, at /admin, and that is the
// point: same origin means no CORS to configure, no preflight that cannot carry
// an api key, and a session cookie that the browser simply sends. It also means
// one artefact to deploy - no second web server, no second runtime.
//
// dist is the built output of the sources next to it, and it is not committed:
// a build checked into git drifts from the sources it came from, and nothing
// catches it - the binary just ships a stale interface. The Dockerfiles build it
// in their own stage, so what gets embedded always matches what is in the repo.
//
// Locally:
//
//	cd ui && npm install && npm run build
//
// The directory itself is committed, holding nothing but a placeholder, because
// //go:embed reads it at compile time: without it even go build would fail. A
// binary built that way serves a plain message instead of the panel.
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
