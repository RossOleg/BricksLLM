package recorder

import (
	"errors"
	"sync"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/event"
	"github.com/bricks-cloud/bricksllm/internal/telemetry"
	"go.uber.org/zap"
)

// BatchStore writes a batch of events in one go.
type BatchStore interface {
	InsertEvents(events []*event.Event) error
}

// EventBatcher takes events off the request path and writes them in batches.
//
// Two things happen when a proxied request finishes: the spend is counted, and
// the request is written to the history. The first is a counter in redis and
// takes a fraction of a millisecond; the second is a row with the whole request
// and response in it. Done inline, the second one decides how fast the first one
// can happen - and the event pipeline hands back to the request goroutine, so it
// ends up deciding how fast the proxy answers.
//
// So the history is written here instead: handing an event over never blocks,
// and the rows are batched, which costs about a quarter per event of what one
// insert per event costs.
//
// The trade for that is at the far end: when the queue is full, events are
// dropped and counted, not waited for. That is a deliberate asymmetry - spend is
// already recorded in redis by the time an event gets here, so what a drop costs
// is a line missing from the history, never money that stops being counted.
type EventBatcher struct {
	queue    chan *event.Event
	store    BatchStore
	log      *zap.Logger
	size     int
	interval time.Duration
	writers  int
	done     chan struct{}
	wg       sync.WaitGroup
	stopOnce sync.Once
}

func NewEventBatcher(store BatchStore, log *zap.Logger, capacity, size, writers int, interval time.Duration) *EventBatcher {
	if capacity <= 0 {
		capacity = 1
	}

	if size <= 0 {
		size = 1
	}

	if writers <= 0 {
		writers = 1
	}

	if interval <= 0 {
		interval = time.Second
	}

	return &EventBatcher{
		queue:    make(chan *event.Event, capacity),
		store:    store,
		log:      log,
		size:     size,
		interval: interval,
		writers:  writers,
		done:     make(chan struct{}),
	}
}

// InsertEvent hands an event to the writers, or gives up on it.
//
// It never blocks: everything this is called from is finishing a request that
// has already been answered, and making that wait for the history is what this
// type exists to avoid.
func (b *EventBatcher) InsertEvent(e *event.Event) error {
	select {
	case b.queue <- e:
		return nil
	default:
		telemetry.Incr("bricksllm.recorder.event_batcher.dropped", nil, 1)
		return errors.New("event queue is full, dropping the event")
	}
}

func (b *EventBatcher) Start() {
	for i := 0; i < b.writers; i++ {
		b.wg.Add(1)
		go b.write()
	}
}

// Stop flushes what is queued and waits for the writers.
//
// The events in the queue are requests that already happened, so shutdown takes
// the moment it needs to write them rather than throwing them away.
func (b *EventBatcher) Stop() {
	b.stopOnce.Do(func() {
		close(b.done)
	})

	b.wg.Wait()
}

func (b *EventBatcher) write() {
	defer b.wg.Done()

	batch := make([]*event.Event, 0, b.size)

	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()

	flush := func() {
		if len(batch) == 0 {
			return
		}

		start := time.Now()

		if err := b.store.InsertEvents(batch); err != nil {
			telemetry.Incr("bricksllm.recorder.event_batcher.insert_error", nil, 1)
			b.log.Debug("error when inserting a batch of events", zap.Error(err), zap.Int("count", len(batch)))
		}

		telemetry.Timing("bricksllm.recorder.event_batcher.insert_latency", time.Since(start), nil, 1)
		telemetry.Incr("bricksllm.recorder.event_batcher.written", nil, float64(len(batch)))

		batch = batch[:0]
	}

	add := func(e *event.Event) {
		batch = append(batch, e)
		if len(batch) >= b.size {
			flush()
		}
	}

	for {
		select {
		case e := <-b.queue:
			add(e)

		case <-ticker.C:
			flush()

		case <-b.done:
			// Whatever is already queued gets written: these are requests that
			// have happened, and this is the last chance to record them.
			for {
				select {
				case e := <-b.queue:
					add(e)
				default:
					flush()
					return
				}
			}
		}
	}
}
