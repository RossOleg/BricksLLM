package postgresql

import (
	"net/http"
	"testing"

	"github.com/bricks-cloud/bricksllm/internal/event"
)

const day1 int64 = 1758412800 // 2025-09-21 00:00:00 UTC
const day2 int64 = day1 + secondsInDay

func TestABatchIsFoldedIntoOneRowPerKeyAndDay(t *testing.T) {
	events := []*event.Event{
		{CreatedAt: day1 + 10, KeyId: "a", CostInUsd: 0.5, LatencyInMs: 100, PromptTokenCount: 3, CompletionTokenCount: 7, Status: http.StatusOK},
		{CreatedAt: day1 + 20, KeyId: "a", CostInUsd: 0.25, LatencyInMs: 50, PromptTokenCount: 1, CompletionTokenCount: 2, Status: http.StatusTooManyRequests},
		{CreatedAt: day2 + 30, KeyId: "a", CostInUsd: 1, LatencyInMs: 10, Status: http.StatusOK},
		{CreatedAt: day1 + 40, KeyId: "b", CostInUsd: 2, LatencyInMs: 70, Status: http.StatusOK},
	}

	rollups := rollUpByDay(events)

	if len(rollups) != 3 {
		t.Fatalf("buckets: %d", len(rollups))
	}

	first := rollups[0]
	if first.day != day1 || first.keyId != "a" {
		t.Fatalf("first bucket is %d/%s", first.day, first.keyId)
	}

	if first.numOfRequests != 2 {
		t.Fatalf("requests: %d", first.numOfRequests)
	}

	if first.costInUsd != 0.75 || first.latencyInMs != 150 {
		t.Fatalf("cost %v latency %d", first.costInUsd, first.latencyInMs)
	}

	if first.promptTokenCount != 4 || first.completionTokenCount != 9 {
		t.Fatalf("tokens %d/%d", first.promptTokenCount, first.completionTokenCount)
	}

	// Only the 200 counts as a success; the rate limited one still happened.
	if first.successCount != 1 {
		t.Fatalf("successes: %d", first.successCount)
	}
}

// Concurrent writers touching the same buckets in different orders deadlock
// against each other, so the order a batch upserts in has to be fixed.
func TestBucketsComeOutInAFixedOrder(t *testing.T) {
	events := []*event.Event{
		{CreatedAt: day2, KeyId: "b"},
		{CreatedAt: day1, KeyId: "b"},
		{CreatedAt: day2, KeyId: "a"},
		{CreatedAt: day1, KeyId: "a"},
	}

	rollups := rollUpByDay(events)

	want := []struct {
		day   int64
		keyId string
	}{{day1, "a"}, {day1, "b"}, {day2, "a"}, {day2, "b"}}

	for i, w := range want {
		if rollups[i].day != w.day || rollups[i].keyId != w.keyId {
			t.Fatalf("bucket %d is %d/%s, wanted %d/%s", i, rollups[i].day, rollups[i].keyId, w.day, w.keyId)
		}
	}
}

func TestABrokenTimestampLandsInABucketOfItsOwn(t *testing.T) {
	rollups := rollUpByDay([]*event.Event{{CreatedAt: -5, KeyId: "a"}})

	if len(rollups) != 1 || rollups[0].day != 0 {
		t.Fatalf("rollups: %+v", rollups)
	}
}

func TestPlaceholdersAreNumberedAcrossRows(t *testing.T) {
	if got := valueTuples(1, 3); got != "($1,$2,$3)" {
		t.Fatal(got)
	}

	if got := valueTuples(2, 2); got != "($1,$2),($3,$4)" {
		t.Fatal(got)
	}
}

// The column list and the values pulled out of an event are one thing in two
// halves, and a mismatch would shift every value by one column.
func TestTheColumnListAndTheValuesAgree(t *testing.T) {
	if got := len(eventFields(&event.Event{})); got != eventInsertColumnCount {
		t.Fatalf("%d values for %d columns", got, eventInsertColumnCount)
	}
}
