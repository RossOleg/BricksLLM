package proxy

import (
	"math"
	"testing"
)

// The scale is allowed to hide what a request costs. It is not allowed to lie
// about the balance, and these are the properties that keep the two apart.
func TestCreditsScaleIsMonotonic(t *testing.T) {
	scale := NewCreditsScale(1000, 0.87, 137, 25)

	previousSpent := int64(-1)
	previousAllowance := int64(-1)

	for cents := 0; cents <= 100000; cents += 7 {
		usd := float64(cents) / 100

		spent := scale.spent(usd)
		if spent < previousSpent {
			t.Fatalf("spend fell at %.2f: %d after %d", usd, spent, previousSpent)
		}

		previousSpent = spent

		allowance := scale.allowance(usd)
		if allowance < previousAllowance {
			t.Fatalf("allowance fell at %.2f: %d after %d", usd, allowance, previousAllowance)
		}

		previousAllowance = allowance
	}
}

func TestCreditsScaleNeverOverstatesWhatIsLeft(t *testing.T) {
	scale := NewCreditsScale(1000, 0.87, 137, 25)

	// Whatever the amounts, the credits left may not exceed the dollars left
	// converted on the same scale - that is the one direction that must not fail.
	for limitCents := 100; limitCents <= 50000; limitCents += 311 {
		for usedCents := 0; usedCents <= limitCents; usedCents += 97 {
			limitUsd := float64(limitCents) / 100
			usedUsd := float64(usedCents) / 100

			remaining := scale.allowance(limitUsd) - scale.spent(usedUsd)
			if remaining < 0 {
				remaining = 0
			}

			honest := scale.allowance(limitUsd - usedUsd)

			if remaining > honest {
				t.Fatalf("limit %.2f used %.2f: %d credits left, honestly %d",
					limitUsd, usedUsd, remaining, honest)
			}
		}
	}
}

func TestCreditsScaleIsNotProportional(t *testing.T) {
	scale := NewCreditsScale(1000, 0.87, 137, 25)

	// One observation must not give the scale away: the credits of a dollar,
	// applied to ten dollars, has to be wrong by a wide margin.
	one := scale.spent(1)
	ten := scale.spent(10)

	guessed := one * 10

	if math.Abs(float64(ten-guessed))/float64(ten) < 0.2 {
		t.Fatalf("extrapolating from one dollar lands within 20%%: %d guessed, %d real", guessed, ten)
	}
}

func TestCreditsScaleEdges(t *testing.T) {
	scale := NewCreditsScale(1000, 0.87, 137, 25)

	if got := scale.spent(0); got != 0 {
		t.Fatalf("nothing spent must read as zero, got %d", got)
	}

	if got := scale.allowance(0); got != 0 {
		t.Fatalf("no limit must read as zero, got %d", got)
	}

	// A limit that exists may never round down to nothing: that would read as no
	// limit at all.
	tiny := NewCreditsScale(0.001, 1, 0, 1000)
	if got := tiny.allowance(0.01); got < 1 {
		t.Fatalf("a real limit rounded away to %d", got)
	}

	// Nonsense parameters fall back to the neutral scale instead of breaking the
	// balance.
	broken := NewCreditsScale(1000, -3, -5, 0)
	if broken.spent(2) != 2000 || broken.allowance(2) != 2000 {
		t.Fatalf("the fallback scale is not plain: %d / %d", broken.spent(2), broken.allowance(2))
	}

	if NewCreditsScale(0, 1, 0, 1).enabled() {
		t.Fatal("a zero rate must leave credits off")
	}
}

func TestCreditsScaleQuantises(t *testing.T) {
	scale := NewCreditsScale(1000, 0.87, 137, 25)

	// Two spends a hundredth of a cent apart must not be distinguishable by the
	// balance they produce.
	if scale.spent(1.0000) != scale.spent(1.0001) {
		t.Fatal("the balance moves on a hundredth of a cent")
	}

	if got := scale.spent(3.33) % 25; got != 0 {
		t.Fatalf("the result is not on the step: remainder %d", got)
	}
}
