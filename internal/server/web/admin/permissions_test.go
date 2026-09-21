package admin

import (
	"strings"
	"testing"

	"github.com/bricks-cloud/bricksllm/internal/key"
	"github.com/bricks-cloud/bricksllm/internal/provider"
)

func supportKey() *key.RequestKey {
	return &key.RequestKey{
		Name:           "a customer",
		Key:            "dam-fa874107-30bc-4007-b4b3-fed5d7320e18",
		CostLimitInUsd: 10,
	}
}

var oneSetting = []*provider.Setting{{Id: "setting-1"}}

func TestASupportKeyIsIssuedWithLoggingOff(t *testing.T) {
	rk := supportKey()

	if err := applySupportKeyPolicy(rk, oneSetting, ""); err != nil {
		t.Fatal(err)
	}

	if rk.ShouldLogRequest || rk.ShouldLogResponse {
		t.Fatal("a support key was issued with logging on")
	}

	if len(rk.SettingIds) != 1 || rk.SettingIds[0] != "setting-1" {
		t.Fatalf("provider setting: %v", rk.SettingIds)
	}

	if len(rk.Tags) != 1 || rk.Tags[0] != SupportKeyTag {
		t.Fatalf("tags: %v", rk.Tags)
	}
}

// The panel does not draw the switches for a support session, but drawing is not
// enforcing: the same person can post whatever they like straight to the api.
func TestASupportSessionCannotTurnLoggingOn(t *testing.T) {
	for _, field := range []struct {
		name string
		turn func(rk *key.RequestKey)
	}{
		{"shouldLogRequest", func(rk *key.RequestKey) { rk.ShouldLogRequest = true }},
		{"shouldLogResponse", func(rk *key.RequestKey) { rk.ShouldLogResponse = true }},
	} {
		t.Run(field.name, func(t *testing.T) {
			rk := supportKey()
			field.turn(rk)

			err := applySupportKeyPolicy(rk, oneSetting, "")
			if err == nil {
				t.Fatal("logging was accepted from a support session")
			}

			if !strings.Contains(err.Error(), field.name) {
				t.Fatalf("the refusal does not name the field: %v", err)
			}
		})
	}
}

func TestASupportKeyStillNeedsALimitAndAGeneratedValue(t *testing.T) {
	noLimit := supportKey()
	noLimit.CostLimitInUsd = 0

	if err := applySupportKeyPolicy(noLimit, oneSetting, ""); err == nil {
		t.Fatal("a key without a cost limit was accepted")
	}

	typed := supportKey()
	typed.Key = "my-own-key"

	if err := applySupportKeyPolicy(typed, oneSetting, ""); err == nil {
		t.Fatal("a typed key was accepted")
	}
}
