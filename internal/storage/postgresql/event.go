package postgresql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	internal_errors "github.com/bricks-cloud/bricksllm/internal/errors"
	"github.com/bricks-cloud/bricksllm/internal/event"
	"github.com/lib/pq"
)

func (s *Store) CreateEventsByDayTable() error {
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS event_agg_by_day (
		id SERIAL PRIMARY KEY,
		time_stamp BIGINT NOT NULL,
		num_of_requests BIGINT NOT NULL,
		cost_in_usd FLOAT8 NOT NULL,
		latency_in_ms BIGINT NOT NULL,
		prompt_token_count BIGINT NOT NULL,
		success_count BIGINT NOT NULL,
		completion_token_count BIGINT NOT NULL,
		key_id VARCHAR(255)
	)`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, createTableQuery)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) AlterEventsTable() error {
	alterTableQuery := `
		ALTER TABLE events ADD COLUMN IF NOT EXISTS path VARCHAR(255), ADD COLUMN IF NOT EXISTS method VARCHAR(255), ADD COLUMN IF NOT EXISTS custom_id VARCHAR(255), ADD COLUMN IF NOT EXISTS request JSONB, ADD COLUMN IF NOT EXISTS response JSONB, ADD COLUMN IF NOT EXISTS user_id VARCHAR(255) NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS action VARCHAR(255) NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS policy_id VARCHAR(255) NOT NULL DEFAULT '',  ADD COLUMN IF NOT EXISTS route_id VARCHAR(255) NOT NULL DEFAULT '',  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(255) NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS metadata JSONB;
	`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, alterTableQuery)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) CreateUniqueIndexForEventsByDayTable() error {
	createIndexQuery := `
	CREATE UNIQUE index IF NOT EXISTS idx_key_id_and_time_stamp on event_agg_by_day (time_stamp, key_id);`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, createIndexQuery)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) CreateTimeStampIndexForEventsByDayTable() error {
	createIndexQuery := `
	CREATE index IF NOT EXISTS idx_time_stamp on event_agg_by_day (time_stamp);`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, createIndexQuery)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) CreateKeyIdIndexForEventsByDayTable() error {
	createIndexQuery := `
	CREATE index IF NOT EXISTS idx_key_id on event_agg_by_day (key_id);`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, createIndexQuery)
	if err != nil {
		return err
	}

	return nil
}

func (s *Store) CreateEventsTable() error {
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS events (
		event_id VARCHAR(255) PRIMARY KEY,
		created_at BIGINT NOT NULL,
		tags VARCHAR(255)[],
		key_id VARCHAR(255),
		cost_in_usd FLOAT8,
		provider VARCHAR(255),
		model VARCHAR(255),
		status_code INT,
		prompt_token_count INT,
		completion_token_count INT,
		latency_in_ms INT
	)`

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()
	_, err := s.db.ExecContext(ctxTimeout, createTableQuery)
	if err != nil {
		return err
	}

	return nil
}

// eventIndex is one index this table needs, named so that a half built one can
// be recognised and cleared.
type eventIndex struct {
	name      string
	statement string
}

var eventIndexes = []eventIndex{
	{"idx_events_created_at", "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_created_at ON events (created_at DESC)"},
	{"idx_events_key_id_created_at", "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_key_id_created_at ON events (key_id, created_at DESC)"},
	{"idx_events_custom_id", "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_custom_id ON events (custom_id)"},
	{"idx_events_user_id", "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_user_id ON events (user_id)"},
}

// CreateIndexesForEventsTable indexes the events table itself.
//
// Until this was added the table had nothing but the primary key on event_id.
// The three helpers named "...ForEventsByDayTable" above all index
// event_agg_by_day, not events, and their original names said "events table",
// which is easy to read as "this is covered". It was not: every history lookup -
// always by key and time range - was a sequential scan over a table that stores
// whole request and response bodies.
//
// CONCURRENTLY, and called from a goroutine after the servers are up, because a
// plain CREATE INDEX holds a write lock for as long as it runs. On a table that
// has been collecting request bodies for months that is minutes, and doing it
// before the servers start means the whole gateway is down for those minutes.
// Nothing here is needed for correctness - the queries work without the indexes,
// only slowly - so the caller logs a failure and carries on.
//
// The price of CONCURRENTLY is that a cancelled build leaves an index behind
// that exists but is not valid, and which CREATE INDEX IF NOT EXISTS would then
// skip forever. Each one is checked and dropped before it is built again.
func (s *Store) CreateIndexesForEventsTable(ctx context.Context) error {
	for _, index := range eventIndexes {
		if err := s.dropInvalidIndex(ctx, index.name); err != nil {
			return err
		}

		if _, err := s.db.ExecContext(ctx, index.statement); err != nil {
			return fmt.Errorf("creating %s: %w", index.name, err)
		}
	}

	return nil
}

// dropInvalidIndex removes an index left unusable by an interrupted build.
func (s *Store) dropInvalidIndex(ctx context.Context, name string) error {
	const query = `
		SELECT EXISTS (
			SELECT 1 FROM pg_class c
			JOIN pg_index i ON i.indexrelid = c.oid
			WHERE c.relname = $1 AND NOT i.indisvalid
		)`

	invalid := false
	if err := s.db.QueryRowContext(ctx, query, name).Scan(&invalid); err != nil {
		return err
	}

	if !invalid {
		return nil
	}

	// The name is one of our own constants, never anything a caller supplies -
	// an index name cannot be a bound parameter.
	if _, err := s.db.ExecContext(ctx, "DROP INDEX IF EXISTS "+name); err != nil {
		return err
	}

	return nil
}

// eventListColumns is what a list of events carries: every column except the
// request and response bodies.
//
// Those two hold whole provider payloads - for a vision request that is base64
// image data, megabytes per row - and no list view shows them. A single event is
// opened in full through GetEventByID instead.
//
// The lists used to be SELECT *, which also meant the scan below silently
// depended on the physical column order of the table.
const eventListColumns = "event_id, created_at, tags, key_id, cost_in_usd, provider, model, status_code, prompt_token_count, completion_token_count, latency_in_ms, path, method, custom_id, user_id, action, policy_id, route_id, correlation_id, metadata"

// eventColumns is the same list with the bodies in it.
const eventColumns = "event_id, created_at, tags, key_id, cost_in_usd, provider, model, status_code, prompt_token_count, completion_token_count, latency_in_ms, path, method, custom_id, request, response, user_id, action, policy_id, route_id, correlation_id, metadata"

// queryArgs collects the values of a query and hands out their placeholders, so
// that a filter is never pasted into the SQL text. These filters arrive from
// query strings and from the X-CUSTOM-EVENT-ID header of proxy requests, so they
// are caller controlled.
type queryArgs struct {
	values []any
}

func (a *queryArgs) next(value any) string {
	a.values = append(a.values, value)
	return fmt.Sprintf("$%d", len(a.values))
}

type rowScanner interface {
	Scan(dest ...any) error
}

// scanEvent reads a row shaped like eventColumns, or like eventListColumns when
// withBodies is false.
func scanEvent(scanner rowScanner, withBodies bool) (*event.Event, error) {
	var e event.Event
	var path sql.NullString
	var method sql.NullString
	var customId sql.NullString

	dest := []any{
		&e.Id,
		&e.CreatedAt,
		pq.Array(&e.Tags),
		&e.KeyId,
		&e.CostInUsd,
		&e.Provider,
		&e.Model,
		&e.Status,
		&e.PromptTokenCount,
		&e.CompletionTokenCount,
		&e.LatencyInMs,
		&path,
		&method,
		&customId,
	}

	if withBodies {
		dest = append(dest, &e.Request, &e.Response)
	}

	dest = append(dest,
		&e.UserId,
		&e.Action,
		&e.PolicyId,
		&e.RouteId,
		&e.CorrelationId,
		&e.Metadata,
	)

	if err := scanner.Scan(dest...); err != nil {
		return nil, err
	}

	e.Path = path.String
	e.Method = method.String
	e.CustomId = customId.String

	return &e, nil
}

// GetEventByID returns one event with its request and response bodies.
func (s *Store) GetEventByID(id string) (*event.Event, error) {
	if len(id) == 0 {
		return nil, errors.New("event id is not specified")
	}

	query := "SELECT " + eventColumns + " FROM events WHERE event_id = $1"

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	e, err := scanEvent(s.db.QueryRowContext(ctx, query, id), true)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, internal_errors.NewNotFoundError("event is not found")
		}

		return nil, err
	}

	return e, nil
}

// GetEvents lists the request history of a key, a user or a custom id, without
// the request and response bodies.
// deleteEventsBatchSize is how many events one DELETE statement takes.
//
// The rows are large - a vision request carries its base64 image - and the
// default write timeout is five seconds, so a single statement over a month of
// history would be cancelled and roll back, deleting nothing however often it is
// retried. Batches keep every statement short, and each one commits on its own.
const deleteEventsBatchSize = 500

// DeleteEvents removes the events created within a time range, both ends
// included, and returns how many rows were deleted.
//
// It deletes in batches, so an interrupted call keeps what it has already
// removed and simply carries on where it stopped when it is called again.
// Storage comes back as autovacuum reclaims the dead rows, not at once.
//
// This is the one query here that takes a context from its caller: it is the
// only operation that can legitimately run for minutes, and the caller has to be
// able to stop it.
func (s *Store) DeleteEvents(ctx context.Context, start, end int64) (int64, error) {
	if start > end {
		return 0, errors.New("start cannot be larger than end")
	}

	// The subselect is what keeps a batch bounded: PostgreSQL has no DELETE LIMIT.
	// It is an index scan over idx_events_created_at.
	query := `
		DELETE FROM events WHERE event_id IN (
			SELECT event_id FROM events
			WHERE created_at >= $1 AND created_at <= $2
			ORDER BY created_at
			LIMIT $3
		)`

	deleted := int64(0)

	for {
		if err := ctx.Err(); err != nil {
			return deleted, err
		}

		ctxTimeout, cancel := context.WithTimeout(ctx, s.wt)
		result, err := s.db.ExecContext(ctxTimeout, query, start, end, deleteEventsBatchSize)
		cancel()

		if err != nil {
			return deleted, err
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return deleted, err
		}

		deleted += affected

		if affected < deleteEventsBatchSize {
			return deleted, nil
		}
	}
}

func (s *Store) GetEvents(userId string, customId string, keyIds []string, start int64, end int64) ([]*event.Event, error) {
	if len(customId) == 0 && len(keyIds) == 0 && len(userId) == 0 {
		return nil, errors.New("none of customId, keyIds and userId is specified")
	}

	if len(keyIds) != 0 && (start == 0 || end == 0) {
		return nil, errors.New("keyIds are provided but either start or end is not specified")
	}

	args := &queryArgs{}
	conditions := []string{}

	if len(customId) != 0 {
		conditions = append(conditions, "custom_id = "+args.next(customId))
	}

	if len(userId) != 0 {
		conditions = append(conditions, "user_id = "+args.next(userId))
	}

	if len(keyIds) != 0 {
		conditions = append(conditions,
			"key_id = ANY("+args.next(pq.Array(keyIds))+")",
			"created_at >= "+args.next(start),
			"created_at <= "+args.next(end),
		)
	}

	// Newest first, and in a defined order at all: this is the request history, and
	// without it rows came back in whatever order the scan produced them.
	query := "SELECT " + eventListColumns + " FROM events WHERE " +
		strings.Join(conditions, " AND ") + " ORDER BY created_at DESC"

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	events := []*event.Event{}
	rows, err := s.db.QueryContext(ctxTimeout, query, args.values...)
	if err != nil {
		if err == sql.ErrNoRows {
			return events, nil
		}
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		e, err := scanEvent(rows, false)
		if err != nil {
			return nil, err
		}

		events = append(events, e)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return events, nil
}
func (s *Store) GetLatencyPercentiles(start, end int64, tags, keyIds []string) ([]float64, error) {
	// Only the latency column: the percentile needs nothing else, and reading the
	// whole row pulls the stored request and response bodies along with it.
	eventSelectionBlock := `
	WITH events_table AS
		(
			SELECT latency_in_ms FROM events 
	`

	args := &queryArgs{}

	// The time range applies even with no tag and no key: without it an unfiltered
	// call silently took the percentile over the whole table instead of over the
	// requested period.
	conditionBlock := "WHERE created_at >= " + args.next(start) + " AND created_at <= " + args.next(end) + " "

	if len(tags) != 0 {
		conditionBlock += "AND tags @> " + args.next(pq.Array(tags)) + " "
	}

	if len(keyIds) != 0 {
		conditionBlock += "AND key_id = ANY(" + args.next(pq.Array(keyIds)) + ")"
	}

	eventSelectionBlock += conditionBlock

	eventSelectionBlock += ")"

	query :=
		`
		SELECT    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY events_table.latency_in_ms), 0) as median_latency, COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY events_table.latency_in_ms), 0) as top_latency
		FROM      events_table
		`

	query = eventSelectionBlock + query

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, args.values...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []float64{}
	for rows.Next() {
		var median float64
		var top float64

		if err := rows.Scan(
			&median,
			&top,
		); err != nil {
			return nil, err
		}

		data = []float64{
			median,
			top,
		}
	}

	return data, nil
}

func (s *Store) GetCustomIds(keyId string) ([]string, error) {
	query := `
	SELECT DISTINCT custom_id
	FROM events
	WHERE key_id = $1 AND custom_id IS NOT NULL AND NOT custom_id = ''
	`

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, keyId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []string{}

	for rows.Next() {
		var customId string

		if err := rows.Scan(
			&customId,
		); err != nil {
			return nil, err
		}

		result = append(result, customId)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}
func (s *Store) GetUserIds(keyId string) ([]string, error) {
	query := `
	SELECT DISTINCT user_id
	FROM events
	WHERE key_id = $1 AND NOT user_id = ''
	`

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, keyId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []string{}

	for rows.Next() {
		var userId string

		if err := rows.Scan(
			&userId,
		); err != nil {
			return nil, err
		}

		result = append(result, userId)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}
func (s *Store) GetTopKeyDataPoints(start, end int64, tags, keyIds []string, order string, limit, offset int, name string, revoked *bool) ([]*event.KeyDataPoint, error) {
	args := []any{}
	condition := ""
	condition2 := ""

	index := 1
	if len(tags) > 0 {
		condition += fmt.Sprintf("AND tags @> $%d", index)

		args = append(args, pq.Array(tags))
		index++
	}

	if len(keyIds) > 0 {
		condition += fmt.Sprintf(" AND key_id = ANY($%d)", index)

		args = append(args, pq.Array(keyIds))
		index++
	}

	if len(name) > 0 {
		condition += fmt.Sprintf(" AND LOWER(name) LIKE LOWER($%d)", index)

		args = append(args, "%"+name+"%")
		index++
	}

	if revoked != nil {
		bools := "False"
		if *revoked {
			bools = "True"
		}

		condition += fmt.Sprintf(" AND revoked = %s", bools)
	}

	if len(tags) > 0 {
		condition2 += fmt.Sprintf("AND keys.tags @> $%d", index)

		args = append(args, pq.Array(tags))
		index++
	}

	if len(keyIds) > 0 {
		condition2 += fmt.Sprintf(" AND keys.key_id = ANY($%d)", index)

		args = append(args, pq.Array(keyIds))
		index++
	}

	if len(name) > 0 {
		condition2 += fmt.Sprintf(" AND LOWER(keys.name) LIKE LOWER($%d)", index)

		args = append(args, "%"+name+"%")
		index++
	}

	if revoked != nil {
		bools := "False"
		if *revoked {
			bools = "True"
		}

		condition2 += fmt.Sprintf(" AND keys.revoked = %s", bools)
	}

	query := fmt.Sprintf(`
	WITH keys_table AS
	(
			SELECT key_id FROM keys WHERE created_at >= %d AND created_at < %d %s
	),top_keys_table AS 
	(
		SELECT 
		events.key_id,
		SUM(cost_in_usd) AS "CostInUsd"
		FROM events
		LEFT JOIN keys
		ON keys.key_id = events.key_id
		WHERE (events.key_id = '') IS FALSE AND events.created_at >= %d AND events.created_at < %d %s
		GROUP BY events.key_id
	)
	SELECT CASE
			WHEN top_keys_table.key_id IS NOT NULL THEN top_keys_table.key_id
			ELSE keys_table.key_id
		END 
		AS key_id
  , COALESCE(top_keys_table."CostInUsd", 0) AS cost_in_usd
		FROM keys_table
		FULL JOIN top_keys_table
		ON top_keys_table.key_id = keys_table.key_id 

`, start, end, condition, start, end, condition2)

	qorder := "DESC"
	if len(order) != 0 && strings.ToUpper(order) == "ASC" {
		qorder = "ASC"
	}

	query += fmt.Sprintf(`
	ORDER BY cost_in_usd %s 
`, qorder)

	if limit != 0 {
		query += fmt.Sprintf(`
		LIMIT %d OFFSET %d;
	`, limit, offset)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []*event.KeyDataPoint{}
	for rows.Next() {
		var e event.KeyDataPoint
		var keyId sql.NullString

		additional := []any{
			&keyId,
			&e.CostInUsd,
		}

		if err := rows.Scan(
			additional...,
		); err != nil {
			return nil, err
		}

		pe := &e
		pe.KeyId = keyId.String

		data = append(data, pe)
	}

	return data, nil
}

func (s *Store) GetAggregatedEventByDayDataPoints(start, end int64, keyIds []string) ([]*event.DataPointV2, error) {
	args := &queryArgs{}

	conditionBlock := "WHERE time_stamp >= " + args.next(start) + " AND time_stamp < " + args.next(end) + " "
	if len(keyIds) != 0 {
		conditionBlock += "AND key_id = ANY(" + args.next(pq.Array(keyIds)) + ")"
	}

	// Columns spelled out, and in the order the scan below reads them. Under
	// SELECT * they arrived in the physical order of the table, where
	// success_count comes before completion_token_count while the scan expects
	// the opposite - the two would have been swapped in every row.
	query := fmt.Sprintf(
		`
		SELECT id, time_stamp, num_of_requests, cost_in_usd, latency_in_ms, prompt_token_count, completion_token_count, success_count, key_id
		FROM event_agg_by_day
		%s
		ORDER BY  event_agg_by_day.time_stamp;
		`,
		conditionBlock,
	)

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, args.values...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []*event.DataPointV2{}
	for rows.Next() {
		var e event.DataPointV2
		var keyId sql.NullString
		var id sql.NullInt32

		additional := []any{
			&id,
			&e.TimeStamp,
			&e.NumberOfRequests,
			&e.CostInUsd,
			&e.LatencyInMs,
			&e.PromptTokenCount,
			&e.CompletionTokenCount,
			&e.SuccessCount,
			&keyId,
		}

		if err := rows.Scan(
			additional...,
		); err != nil {
			return nil, err
		}

		pe := &e
		pe.KeyId = keyId.String

		data = append(data, pe)
	}

	return data, nil
}

// GetEventDataPoints buckets the events of a time range into a series of equal
// intervals, keeping the empty intervals in the result.
//
// The bucket is computed once per row and the series is then joined on equality.
// It used to be a range join - every generated interval matched against every row
// of the range - which is quadratic: a month at an hourly interval walked the
// whole range 720 times. The inner select also read every column, dragging the
// stored request and response bodies (base64 images, for vision requests) through
// a query that needs seven numbers. Together with the missing index on
// events.created_at that is what made the reporting page hang.
func (s *Store) GetEventDataPoints(start, end, increment int64, tags, keyIds, customIds, userIds []string, filters []string) ([]*event.DataPoint, error) {
	if increment <= 0 {
		return nil, errors.New("increment must be greater than zero")
	}

	// Only what the aggregate reads. Everything else stays in the table.
	columns := []string{
		"event_id",
		"created_at",
		"cost_in_usd",
		"latency_in_ms",
		"prompt_token_count",
		"completion_token_count",
		"status_code",
	}

	groupByQuery := "GROUP BY time_series_table.series"
	selectQuery := "SELECT time_series_table.series AS time_stamp, COALESCE(COUNT(bucketed_table.event_id),0) AS num_of_requests, COALESCE(SUM(bucketed_table.cost_in_usd),0) AS cost_in_usd, COALESCE(SUM(bucketed_table.latency_in_ms),0) AS latency_in_ms, COALESCE(SUM(bucketed_table.prompt_token_count),0) AS prompt_token_count, COALESCE(SUM(bucketed_table.completion_token_count),0) AS completion_token_count, COALESCE(SUM(CASE WHEN bucketed_table.status_code = 200 THEN 1 END),0) AS success_count"

	if len(filters) != 0 {
		for _, filter := range filters {
			if filter == "model" {
				columns = append(columns, "model")
				groupByQuery += ",bucketed_table.model"
				selectQuery += ",bucketed_table.model as model"
			}

			if filter == "keyId" {
				columns = append(columns, "key_id")
				groupByQuery += ",bucketed_table.key_id"
				selectQuery += ",bucketed_table.key_id as keyId"
			}

			if filter == "customId" {
				columns = append(columns, "custom_id")
				groupByQuery += ",bucketed_table.custom_id"
				selectQuery += ",bucketed_table.custom_id as customId"
			}

			if filter == "userId" {
				columns = append(columns, "user_id")
				groupByQuery += ",bucketed_table.user_id"
				selectQuery += ",bucketed_table.user_id as userId"
			}
		}
	}

	args := &queryArgs{}

	conditionBlock := "WHERE created_at >= " + args.next(start) + " AND created_at < " + args.next(end) + " "
	if len(tags) != 0 {
		conditionBlock += "AND tags @> " + args.next(pq.Array(tags)) + " "
	}

	if len(keyIds) != 0 {
		conditionBlock += "AND key_id = ANY(" + args.next(pq.Array(keyIds)) + ")"
	}

	if len(customIds) != 0 {
		conditionBlock += "AND custom_id = ANY(" + args.next(pq.Array(customIds)) + ")"
	}

	if len(userIds) != 0 {
		conditionBlock += "AND user_id = ANY(" + args.next(pq.Array(userIds)) + ")"
	}

	selectedColumns := strings.Join(columns, ", ")

	// created_at >= start is guaranteed by the condition block, so the division
	// never sees a negative numerator and a row lands in the same interval the
	// range join used to match it to.
	query := fmt.Sprintf(
		`
		WITH events_table AS
		(
			SELECT %s FROM events
			%s
		),
		bucketed_table AS
		(
			SELECT %d + ((created_at - %d) / %d) * %d AS series, %s FROM events_table
		),
		time_series_table AS
		(
			SELECT generate_series(%d, %d, %d) series
		)
		%s
		FROM       time_series_table
		LEFT JOIN  bucketed_table
		ON         bucketed_table.series = time_series_table.series
		%s
		ORDER BY  time_series_table.series;
		`,
		selectedColumns, conditionBlock,
		start, start, increment, increment, selectedColumns,
		start, end, increment,
		selectQuery, groupByQuery,
	)

	ctx, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, query, args.values...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []*event.DataPoint{}
	for rows.Next() {
		var e event.DataPoint
		var model sql.NullString
		var keyId sql.NullString
		var customId sql.NullString
		var userId sql.NullString

		additional := []any{
			&e.TimeStamp,
			&e.NumberOfRequests,
			&e.CostInUsd,
			&e.LatencyInMs,
			&e.PromptTokenCount,
			&e.CompletionTokenCount,
			&e.SuccessCount,
		}

		if len(filters) != 0 {
			for _, filter := range filters {
				if filter == "model" {
					additional = append(additional, &model)
				}

				if filter == "keyId" {
					additional = append(additional, &keyId)
				}

				if filter == "customId" {
					additional = append(additional, &customId)
				}

				if filter == "userId" {
					additional = append(additional, &userId)
				}
			}
		}

		if err := rows.Scan(
			additional...,
		); err != nil {
			return nil, err
		}

		pe := &e
		pe.Model = model.String
		pe.KeyId = keyId.String
		pe.CustomId = customId.String
		pe.UserId = userId.String

		data = append(data, pe)
	}

	return data, nil
}

// GetEventsV2 is the paginated list of the request history, without the request
// and response bodies. A single event is opened in full through GetEventByID.
func (s *Store) GetEventsV2(req *event.EventRequest) (*event.EventResponse, error) {
	args := &queryArgs{}

	conditions := "created_at >= " + args.next(req.Start) + " AND created_at < " + args.next(req.End)

	if len(req.UserIds) != 0 {
		conditions += " AND user_id = ANY(" + args.next(pq.Array(req.UserIds)) + ")"
	}

	if req.Status != 0 {
		conditions += " AND status_code = " + args.next(req.Status)
	}

	if len(req.CustomIds) != 0 {
		conditions += " AND custom_id = ANY(" + args.next(pq.Array(req.CustomIds)) + ")"
	}

	if len(req.KeyIds) != 0 {
		conditions += " AND key_id = ANY(" + args.next(pq.Array(req.KeyIds)) + ")"
	}

	if len(req.Tags) != 0 {
		conditions += " AND tags @> " + args.next(pq.Array(req.Tags))
	}

	if len(req.PolicyIds) != 0 {
		conditions += " AND policy_id = ANY(" + args.next(pq.Array(req.PolicyIds)) + ")"
	}

	if len(req.Actions) != 0 {
		conditions += " AND action = ANY(" + args.next(pq.Array(req.Actions)) + ")"
	}

	query := "SELECT " + eventListColumns + " FROM events WHERE " + conditions
	cquery := "SELECT COUNT(*) FROM events WHERE " + conditions

	// Both orders at once are rejected by EventRequest.Validate, and the direction
	// is checked there against asc/desc - it is not a value from the request that
	// reaches the query text unvalidated.
	if len(req.CostOrder) != 0 {
		query += fmt.Sprintf(" ORDER BY cost_in_usd %s", strings.ToUpper(req.CostOrder))
	}

	if len(req.DateOrder) != 0 {
		query += fmt.Sprintf(" ORDER BY created_at %s", strings.ToUpper(req.DateOrder))
	}

	// Numbers, and the count query must not see these placeholders - both run with
	// the same argument list.
	if req.Limit != 0 {
		query += fmt.Sprintf(" LIMIT %d OFFSET %d", req.Limit, req.Offset)
	}

	resp := &event.EventResponse{}

	if req.ReturnCount {
		qrContext, qrCancel := context.WithTimeout(context.Background(), s.rt)

		count := 0
		err := s.db.QueryRowContext(qrContext, cquery, args.values...).Scan(&count)
		qrCancel()

		if err != nil {
			if err != sql.ErrNoRows {
				return nil, err
			}
		}

		resp.Count = count
	}

	ctxTimeout, cancel := context.WithTimeout(context.Background(), s.rt)
	defer cancel()

	events := []*event.Event{}
	rows, err := s.db.QueryContext(ctxTimeout, query, args.values...)
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	for rows.Next() {
		e, err := scanEvent(rows, false)
		if err != nil {
			return nil, err
		}

		events = append(events, e)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	resp.Events = events

	return resp, nil
}

// secondsInDay is the width of a bucket in event_agg_by_day.
const secondsInDay int64 = 86400

// eventAggByDayUpsert adds one event to the rollup of its day.
//
// The bucket is the start of the UTC day. The conflict target is the unique
// index on (time_stamp, key_id), so an event either starts the day of its key or
// is added to it.
const eventAggByDayUpsert = `
	INSERT INTO event_agg_by_day (time_stamp, key_id, num_of_requests, cost_in_usd, latency_in_ms, prompt_token_count, success_count, completion_token_count)
	VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
	ON CONFLICT (time_stamp, key_id) DO UPDATE SET
		num_of_requests = event_agg_by_day.num_of_requests + 1,
		cost_in_usd = event_agg_by_day.cost_in_usd + EXCLUDED.cost_in_usd,
		latency_in_ms = event_agg_by_day.latency_in_ms + EXCLUDED.latency_in_ms,
		prompt_token_count = event_agg_by_day.prompt_token_count + EXCLUDED.prompt_token_count,
		success_count = event_agg_by_day.success_count + EXCLUDED.success_count,
		completion_token_count = event_agg_by_day.completion_token_count + EXCLUDED.completion_token_count`

// InsertEvent stores an event and adds it to the rollup of its day.
//
// Both writes share one transaction: the rollup is a running total, so an event
// counted in it but missing from events - or the other way round - can never be
// reconciled afterwards. The rollup is what survives a cleanup of the history,
// which is the whole reason it exists, so it has to agree with the events while
// they are still there.
func (s *Store) InsertEvent(e *event.Event) error {
	query := `
		INSERT INTO events (event_id, created_at, tags, key_id, cost_in_usd, provider, model, status_code, prompt_token_count, completion_token_count, latency_in_ms, path, method, custom_id, request, response, user_id, action, policy_id, route_id, correlation_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
	`

	values := []any{
		e.Id,
		e.CreatedAt,
		sliceToSqlStringArray(e.Tags),
		e.KeyId,
		e.CostInUsd,
		e.Provider,
		e.Model,
		e.Status,
		e.PromptTokenCount,
		e.CompletionTokenCount,
		e.LatencyInMs,
		e.Path,
		e.Method,
		e.CustomId,
		e.Request,
		e.Response,
		e.UserId,
		e.Action,
		e.PolicyId,
		e.RouteId,
		e.CorrelationId,
		e.Metadata,
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.wt)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, query, values...); err != nil {
		return err
	}

	// Negative timestamps would floor the wrong way, and an event from before 1970
	// is a broken event anyway.
	day := int64(0)
	if e.CreatedAt > 0 {
		day = e.CreatedAt - e.CreatedAt%secondsInDay
	}

	successCount := 0
	if e.Status == http.StatusOK {
		successCount = 1
	}

	if _, err := tx.ExecContext(ctx, eventAggByDayUpsert,
		day,
		e.KeyId,
		e.CostInUsd,
		e.LatencyInMs,
		e.PromptTokenCount,
		successCount,
		e.CompletionTokenCount,
	); err != nil {
		return err
	}

	return tx.Commit()
}
