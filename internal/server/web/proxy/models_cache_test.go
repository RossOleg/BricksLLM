package proxy

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/provider"
	"github.com/bricks-cloud/bricksllm/internal/util"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type stubCache struct {
	entries map[string][]byte
	ttl     time.Duration
}

func (s *stubCache) GetBytes(key string) ([]byte, error) {
	if value, ok := s.entries[key]; ok {
		return value, nil
	}

	return nil, errors.New("not found")
}

func (s *stubCache) StoreBytes(key string, value []byte, ttl time.Duration) error {
	s.entries[key] = value
	s.ttl = ttl

	return nil
}

// upstream answers every request with the given status and body, and counts how
// many times it was asked - which is the whole point of the cache.
type upstream struct {
	status int
	body   string
	calls  int
}

func (u *upstream) RoundTrip(req *http.Request) (*http.Response, error) {
	u.calls++

	return &http.Response{
		StatusCode: u.status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewBufferString(u.body)),
		Request:    req,
	}, nil
}

func listModels(t *testing.T, ca cache, up *upstream, ttl time.Duration, settings []*provider.Setting) *httptest.ResponseRecorder {
	t.Helper()

	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, ModelsListPath, nil)
	c.Request.Header.Set("Authorization", "Bearer sk-upstream")
	util.SetLogToCtx(c, zap.NewNop())
	c.Set("settings", settings)
	c.Set("requestTimeout", time.Minute)

	getListModelsHandler(true, false, http.Client{Transport: up}, ca, ttl)(c)

	return w
}

func TestCatalogueIsAskedForOnceAndServedFromTheCacheAfter(t *testing.T) {
	ca := &stubCache{entries: map[string][]byte{}}
	up := &upstream{status: http.StatusOK, body: catalogue}
	settings := []*provider.Setting{{AllowedModels: []string{"gpt-5.4-nano", "whisper-1"}}}

	for i := 0; i < 3; i++ {
		w := listModels(t, ca, up, time.Hour, settings)

		if w.Code != http.StatusOK {
			t.Fatalf("listing %d answered %d", i, w.Code)
		}

		if got := ids(t, w.Body.Bytes()); len(got) != 2 {
			t.Fatalf("listing %d was not narrowed to the allowed models: %v", i, got)
		}
	}

	if up.calls != 1 {
		t.Fatalf("the provider was asked %d times", up.calls)
	}

	if ca.ttl != time.Hour {
		t.Fatalf("the entry was stored with ttl %v", ca.ttl)
	}
}

// What goes into the cache is the provider's answer, not the narrowed one: the
// restriction belongs to the provider setting, so a second key on the same
// account has to be able to see its own slice of the same entry.
func TestTheCacheHoldsTheWholeCatalogue(t *testing.T) {
	ca := &stubCache{entries: map[string][]byte{}}
	up := &upstream{status: http.StatusOK, body: catalogue}

	listModels(t, ca, up, time.Hour, []*provider.Setting{{AllowedModels: []string{"whisper-1"}}})

	if len(ca.entries) != 1 {
		t.Fatalf("entries stored: %d", len(ca.entries))
	}

	for _, stored := range ca.entries {
		if got := ids(t, stored); len(got) != 3 {
			t.Fatalf("the stored catalogue was narrowed: %v", got)
		}
	}

	// And an unrestricted key on the same account reads that entry whole.
	w := listModels(t, ca, up, time.Hour, nil)
	if got := ids(t, w.Body.Bytes()); len(got) != 3 {
		t.Fatalf("an unrestricted key saw %v", got)
	}

	if up.calls != 1 {
		t.Fatalf("the provider was asked %d times", up.calls)
	}
}

func TestARefusalIsNotCached(t *testing.T) {
	ca := &stubCache{entries: map[string][]byte{}}
	up := &upstream{status: http.StatusUnauthorized, body: `{"error":{"message":"invalid api key"}}`}

	w := listModels(t, ca, up, time.Hour, nil)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("the refusal was answered with %d", w.Code)
	}

	if len(ca.entries) != 0 {
		t.Fatal("a rejected key was cached and would outlive the fix")
	}
}

func TestZeroTtlSendsEveryListingUpstream(t *testing.T) {
	ca := &stubCache{entries: map[string][]byte{}}
	up := &upstream{status: http.StatusOK, body: catalogue}

	listModels(t, ca, up, 0, nil)
	listModels(t, ca, up, 0, nil)

	if up.calls != 2 {
		t.Fatalf("the provider was asked %d times", up.calls)
	}

	if len(ca.entries) != 0 {
		t.Fatal("the cache was written to although it is switched off")
	}
}

// Two accounts must not share an entry, or rotating a key would keep serving
// the catalogue of the one it replaced.
func TestEachUpstreamKeyGetsItsOwnEntry(t *testing.T) {
	if modelsCacheKey("Bearer sk-one") == modelsCacheKey("Bearer sk-two") {
		t.Fatal("two keys share a cache entry")
	}

	if key := modelsCacheKey("Bearer sk-one"); bytes.Contains([]byte(key), []byte("sk-one")) {
		t.Fatalf("the cache key carries the api key: %s", key)
	}
}
