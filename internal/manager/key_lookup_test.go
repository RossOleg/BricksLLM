package manager

import (
	"testing"
	"time"

	internal_errors "github.com/bricks-cloud/bricksllm/internal/errors"
	"github.com/bricks-cloud/bricksllm/internal/hasher"
	"github.com/bricks-cloud/bricksllm/internal/key"
	"github.com/bricks-cloud/bricksllm/internal/policy"
	"github.com/bricks-cloud/bricksllm/internal/provider"
)

// countingCache records what was asked for, so that a test can say how many
// round trips a lookup took.
type countingCache struct {
	stored map[string]*key.ResponseKey
	gets   int
	multi  int
}

func (c *countingCache) Set(keyId string, value interface{}, ttl time.Duration) error {
	return nil
}

func (c *countingCache) Delete(keyId string) error { return nil }

func (c *countingCache) Get(keyId string) (*key.ResponseKey, error) {
	c.gets++

	if k, ok := c.stored[keyId]; ok {
		return k, nil
	}

	return nil, nil
}

func (c *countingCache) GetAny(keyIds ...string) (*key.ResponseKey, error) {
	c.multi++

	for _, id := range keyIds {
		if k, ok := c.stored[id]; ok {
			return k, nil
		}
	}

	return nil, nil
}

// refusingStore stands for the keys table. A test that reaches it has found a
// query on the request path.
type refusingStore struct {
	t       *testing.T
	allowed map[string]*key.ResponseKey
	queries int
}

func (s *refusingStore) GetKeyByHash(hash string) (*key.ResponseKey, error) {
	s.queries++

	if k, ok := s.allowed[hash]; ok {
		return k, nil
	}

	return nil, internal_errors.NewNotFoundError("key is not found using hash")
}

func (s *refusingStore) GetKeys(tags, keyIds []string, provider string) ([]*key.ResponseKey, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) GetKeysV2(tags []string, untagged bool, keyIds []string, revoked *bool, limit, offset int, name, order string, returnCount bool) (*key.GetKeysResponse, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) UpdateKey(id string, k *key.UpdateKey) (*key.ResponseKey, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) CreateKey(k *key.RequestKey) (*key.ResponseKey, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) DeleteKey(id string) error {
	s.t.Fatal("unexpected call")
	return nil
}

func (s *refusingStore) GetProviderSetting(id string, withSecret bool) (*provider.Setting, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) GetPolicyById(id string) (*policy.Policy, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) GetProviderSettings(withSecret bool, ids []string) ([]*provider.Setting, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

func (s *refusingStore) GetKey(keyId string) (*key.ResponseKey, error) {
	s.t.Fatal("unexpected call")
	return nil, nil
}

// A key issued with isKeyNotHashed is stored by value. Looking for the hashed
// form first used to miss in redis and then query the keys table, on every
// proxied request, before the form that exists was ever tried.
func TestAKeyStoredByValueIsFoundWithoutTouchingTheDatabase(t *testing.T) {
	raw := "dam-fa874107-30bc-4007-b4b3-fed5d7320e18"
	cache := &countingCache{stored: map[string]*key.ResponseKey{raw: {KeyId: "k1"}}}
	store := &refusingStore{t: t, allowed: map[string]*key.ResponseKey{}}

	m := NewManager(store, nil, nil, nil, cache)

	k, err := m.GetKeyViaEitherForm(raw)
	if err != nil {
		t.Fatal(err)
	}

	if k == nil || k.KeyId != "k1" {
		t.Fatalf("key: %+v", k)
	}

	if store.queries != 0 {
		t.Fatalf("the keys table was queried %d times for a cached key", store.queries)
	}

	if cache.multi != 1 || cache.gets != 0 {
		t.Fatalf("round trips: %d multi, %d single", cache.multi, cache.gets)
	}
}

func TestAHashedKeyIsFoundInTheSameRoundTrip(t *testing.T) {
	raw := "sk-somebody-elses-key"
	cache := &countingCache{stored: map[string]*key.ResponseKey{hasher.Hash(raw): {KeyId: "k2"}}}
	store := &refusingStore{t: t, allowed: map[string]*key.ResponseKey{}}

	m := NewManager(store, nil, nil, nil, cache)

	k, err := m.GetKeyViaEitherForm(raw)
	if err != nil {
		t.Fatal(err)
	}

	if k == nil || k.KeyId != "k2" {
		t.Fatalf("key: %+v", k)
	}

	if store.queries != 0 || cache.multi != 1 {
		t.Fatalf("queries %d, multi %d", store.queries, cache.multi)
	}
}

// A cold cache still has to find the key, and fill the cache on the way.
func TestAColdCacheFallsBackToTheStore(t *testing.T) {
	raw := "dam-cold"
	cache := &countingCache{stored: map[string]*key.ResponseKey{}}
	store := &refusingStore{t: t, allowed: map[string]*key.ResponseKey{raw: {KeyId: "k3"}}}

	m := NewManager(store, nil, nil, nil, cache)

	k, err := m.GetKeyViaEitherForm(raw)
	if err != nil {
		t.Fatal(err)
	}

	if k == nil || k.KeyId != "k3" {
		t.Fatalf("key: %+v", k)
	}
}

// An unknown key has to come back as a not found error, because that is what
// the callers turn into a 401 rather than a 500.
func TestAnUnknownKeyIsReportedAsNotFound(t *testing.T) {
	cache := &countingCache{stored: map[string]*key.ResponseKey{}}
	store := &refusingStore{t: t, allowed: map[string]*key.ResponseKey{}}

	m := NewManager(store, nil, nil, nil, cache)

	k, err := m.GetKeyViaEitherForm("dam-nobody")
	if k != nil {
		t.Fatalf("key: %+v", k)
	}

	if _, ok := err.(interface{ Error() string }); !ok || err == nil {
		t.Fatalf("error: %v", err)
	}

	if _, ok := err.(*internal_errors.NotFoundError); !ok {
		t.Fatalf("error type: %T", err)
	}
}
