package proxy

import "math"

// CreditsScale turns a dollar amount into the credits a client is shown.
//
// # What this is for, and what it is not
//
// A plain multiplication is recovered from a single observation: see one balance,
// know one spend, divide, and every other number is readable from then on. The
// scale below is shaped so that one observation is not enough - the ratio between
// dollars and credits is different at every amount, so dividing gives an answer
// that is only right at the point it was measured.
//
// It is still concealment, not encryption. Someone who can send requests through
// the gateway and watch their own balance move can fit the curve from enough
// points; nothing that reports a balance at all can prevent that. What this does
// buy is that a number quoted in a support ticket, a screenshot or a log line
// cannot be turned back into dollars, and that is the case worth covering.
//
// The shape is public - this file is - and the parameters are not. They come from
// the environment and appear in no response and no log.
type CreditsScale struct {
	// rate is the credits of one dollar of spend. With exponent other than 1 it is
	// no longer "credits per dollar" at any other amount, which is the point.
	rate float64

	// exponent bends the curve. Anything other than 1 makes the scale
	// disproportionate: twice the spend is not twice the credits.
	exponent float64

	// offset is added to every non-zero result, so the curve does not pass through
	// the origin and cannot be extrapolated from small amounts.
	offset int64

	// step quantises the result. Spend rounds up to a multiple of it and an
	// allowance rounds down, so small differences collapse into the same number
	// and a cheap request need not move the balance at all.
	step int64
}

func NewCreditsScale(rate, exponent float64, offset, step int64) CreditsScale {
	// The scale has to be monotonic: a balance that can fall as spend grows would
	// be worse than a readable one. A non-positive exponent or step would break
	// that, so they fall back to the neutral value rather than being honoured.
	if exponent <= 0 {
		exponent = 1
	}

	if step <= 0 {
		step = 1
	}

	if offset < 0 {
		offset = 0
	}

	return CreditsScale{
		rate:     rate,
		exponent: exponent,
		offset:   offset,
		step:     step,
	}
}

// enabled reports whether this gateway speaks credits at all.
func (s CreditsScale) enabled() bool {
	return s.rate > 0
}

func (s CreditsScale) raw(usd float64) float64 {
	return s.rate * math.Pow(usd, s.exponent)
}

// spent converts what a key has used. It rounds away from zero at every step, so
// the amount shown as used is never smaller than the amount actually used.
func (s CreditsScale) spent(usd float64) int64 {
	if usd <= 0 {
		return 0
	}

	credits := int64(math.Ceil(s.raw(usd))) + s.offset

	if remainder := credits % s.step; remainder != 0 {
		credits += s.step - remainder
	}

	return credits
}

// allowance converts a key's limit. It rounds the other way for the same reason:
// between the two, what is left over never looks larger than it is.
//
// A limit that exists always converts to at least one credit. Rounding a small
// limit down to nothing would read as "no limit at all" - the one error this
// whole rounding scheme exists to avoid.
func (s CreditsScale) allowance(usd float64) int64 {
	if usd <= 0 {
		return 0
	}

	credits := int64(math.Floor(s.raw(usd))) + s.offset

	credits -= credits % s.step

	if credits < 1 {
		credits = 1
	}

	return credits
}
