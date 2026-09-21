package recorder

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/event"
	"go.uber.org/zap"
)

type recordingStore struct {
	mu      sync.Mutex
	batches [][]*event.Event
	block   chan struct{}
	err     error
}

func (s *recordingStore) InsertEvents(events []*event.Event) error {
	if s.block != nil {
		<-s.block
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// The batcher reuses its slice, so what is kept here has to be a copy.
	batch := make([]*event.Event, len(events))
	copy(batch, events)
	s.batches = append(s.batches, batch)

	return s.err
}

func (s *recordingStore) written() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	count := 0
	for _, batch := range s.batches {
		count += len(batch)
	}

	return count
}

func (s *recordingStore) sizes() []int {
	s.mu.Lock()
	defer s.mu.Unlock()

	sizes := []int{}
	for _, batch := range s.batches {
		sizes = append(sizes, len(batch))
	}

	return sizes
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}

		time.Sleep(time.Millisecond)
	}

	t.Fatalf("timed out waiting for %s", what)
}

func TestAFullBatchIsWrittenAtOnce(t *testing.T) {
	store := &recordingStore{}
	// One writer and a long interval, so that only a full batch can flush.
	b := NewEventBatcher(store, zap.NewNop(), 100, 10, 1, time.Hour)
	b.Start()
	defer b.Stop()

	for i := 0; i < 10; i++ {
		if err := b.InsertEvent(&event.Event{Id: "e"}); err != nil {
			t.Fatal(err)
		}
	}

	waitFor(t, "the batch to be written", func() bool { return store.written() == 10 })

	if sizes := store.sizes(); len(sizes) != 1 || sizes[0] != 10 {
		t.Fatalf("batches: %v", sizes)
	}
}

// An idle gateway must not leave the last few requests unwritten until enough
// more arrive to fill a batch.
func TestAPartialBatchIsWrittenOnTheInterval(t *testing.T) {
	store := &recordingStore{}
	b := NewEventBatcher(store, zap.NewNop(), 100, 50, 1, 10*time.Millisecond)
	b.Start()
	defer b.Stop()

	if err := b.InsertEvent(&event.Event{Id: "e"}); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "the interval flush", func() bool { return store.written() == 1 })
}

// The point of the whole type: handing an event over never waits for the
// database, whatever the database is doing.
func TestHandingOverAnEventNeverBlocks(t *testing.T) {
	store := &recordingStore{block: make(chan struct{})}
	b := NewEventBatcher(store, zap.NewNop(), 4, 1, 1, time.Hour)
	b.Start()

	defer func() {
		close(store.block)
		b.Stop()
	}()

	start := time.Now()

	dropped := 0
	for i := 0; i < 50; i++ {
		if err := b.InsertEvent(&event.Event{Id: "e"}); err != nil {
			dropped++
		}
	}

	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("handing over 50 events took %v against a stuck database", elapsed)
	}

	if dropped == 0 {
		t.Fatal("a queue of 4 swallowed 50 events against a stuck database")
	}
}

func TestStopWritesWhatIsStillQueued(t *testing.T) {
	store := &recordingStore{}
	b := NewEventBatcher(store, zap.NewNop(), 100, 1000, 1, time.Hour)
	b.Start()

	for i := 0; i < 20; i++ {
		if err := b.InsertEvent(&event.Event{Id: "e"}); err != nil {
			t.Fatal(err)
		}
	}

	// Neither the size nor the interval can have flushed these.
	b.Stop()

	if store.written() != 20 {
		t.Fatalf("written on shutdown: %d", store.written())
	}
}

// A database that refuses the batch must not take the writer down with it.
func TestAFailedBatchDoesNotStopTheWriter(t *testing.T) {
	store := &recordingStore{err: errors.New("nope")}
	b := NewEventBatcher(store, zap.NewNop(), 100, 1, 1, time.Hour)
	b.Start()
	defer b.Stop()

	for i := 0; i < 3; i++ {
		if err := b.InsertEvent(&event.Event{Id: "e"}); err != nil {
			t.Fatal(err)
		}
	}

	waitFor(t, "the writer to keep going after a failure", func() bool { return store.written() == 3 })
}
