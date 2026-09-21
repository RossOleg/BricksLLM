package redis

import (
	"context"
	"encoding/json"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/key"
	"github.com/redis/go-redis/v9"
)

type KeysCache struct {
	client *redis.Client
	wt     time.Duration
	rt     time.Duration
}

func NewKeysCache(c *redis.Client, wt time.Duration, rt time.Duration) *KeysCache {
	return &KeysCache{
		client: c,
		wt:     wt,
		rt:     rt,
	}
}

func (c *KeysCache) Set(pid string, value any, ttl time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), c.wt)
	defer cancel()
	err := c.client.Set(ctx, pid, value, ttl).Err()
	if err != nil {
		return err
	}

	return nil
}

func (c *KeysCache) Delete(pid string) error {
	ctx, cancel := context.WithTimeout(context.Background(), c.wt)
	defer cancel()
	err := c.client.Del(ctx, pid).Err()
	if err != nil {
		return err
	}

	return nil
}

// GetAny returns the first key stored under any of the given ids, asking for all
// of them in one round trip.
//
// A key is stored either hashed or exactly as it was issued, and which of the
// two it is cannot be told from the key itself. Asking for both at once is what
// keeps the other form from costing a second round trip - and, when it misses, a
// query against the keys table - on every proxied request.
func (c *KeysCache) GetAny(ids ...string) (*key.ResponseKey, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), c.rt)
	defer cancel()

	values, err := c.client.MGet(ctx, ids...).Result()
	if err != nil {
		return nil, err
	}

	for _, value := range values {
		raw, ok := value.(string)
		if !ok || len(raw) == 0 {
			continue
		}

		k := &key.ResponseKey{}
		if err := json.Unmarshal([]byte(raw), k); err != nil {
			continue
		}

		return k, nil
	}

	return nil, nil
}

func (c *KeysCache) Get(pid string) (*key.ResponseKey, error) {
	ctx, cancel := context.WithTimeout(context.Background(), c.rt)
	defer cancel()

	result := c.client.Get(ctx, pid)
	err := result.Err()
	if err != nil {
		return nil, err
	}

	bs, err := result.Bytes()
	if err != nil {
		return nil, err
	}

	k := &key.ResponseKey{}
	err = json.Unmarshal(bs, k)
	if err != nil {
		return nil, err
	}

	return k, nil
}
