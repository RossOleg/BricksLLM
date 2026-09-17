package admin

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/bricks-cloud/bricksllm/internal/event"
	"github.com/bricks-cloud/bricksllm/internal/telemetry"
	"github.com/bricks-cloud/bricksllm/internal/util"
	"github.com/gin-gonic/gin"
)

func getGetUserIdsHandler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_get_user_ids_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_get_user_ids_handler.latency", dur, nil, 1)
		}()

		path := "/api/reporting/user-ids"
		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		kid := c.Query("keyId")
		if len(kid) == 0 {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/missing-key-id",
				Title:    "key id query param is missing",
				Status:   http.StatusBadRequest,
				Detail:   "key id query is missing",
				Instance: path,
			})
			return
		}

		cids, err := m.GetUserIds(kid)
		if err != nil {
			telemetry.Incr("bricksllm.admin.get_get_user_ids_handler.get_user_ids_err", nil, 1)

			logError(log, "error when getting userIds", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/key-reporting-manager",
				Title:    "getting user ids error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_get_user_ids_handler.success", nil, 1)
		c.JSON(http.StatusOK, cids)
	}
}

func getGetCustomIdsHandler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_get_custom_ids_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_get_custom_ids_handler.latency", dur, nil, 1)
		}()

		path := "/api/reporting/custom-ids"
		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		kid := c.Query("keyId")

		if len(kid) == 0 {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/missing-key-id",
				Title:    "key id query param is missing",
				Status:   http.StatusBadRequest,
				Detail:   "key id query is missing",
				Instance: path,
			})
			return
		}

		cids, err := m.GetCustomIds(kid)
		if err != nil {
			telemetry.Incr("bricksllm.admin.get_get_user_ids_handler.get_custom_ids_err", nil, 1)

			logError(log, "error when getting custom ids", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/key-reporting-manager",
				Title:    "getting custom ids error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_get_custom_ids_handler.success", nil, 1)
		c.JSON(http.StatusOK, cids)
	}
}

func getGetEventsHandler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_get_events_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_get_events_handler.latency", dur, nil, 1)
		}()

		path := "/api/events"

		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		customId, ciok := c.GetQuery("customId")
		userId, uiok := c.GetQuery("userId")
		keyIds, kiok := c.GetQueryArray("keyIds")
		if !ciok && !kiok && !uiok {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/no-filters-empty",
				Title:    "none of customId, keyIds and userId is specified",
				Status:   http.StatusBadRequest,
				Detail:   "customId, userId and keyIds are empty. one of them is required for retrieving events.",
				Instance: path,
			})

			return
		}

		var qstart int64 = 0
		var qend int64 = 0

		if kiok {
			startstr, sok := c.GetQuery("start")
			if !sok {
				c.JSON(http.StatusBadRequest, &ErrorResponse{
					Type:     "/errors/query-param-start-missing",
					Title:    "query param start is missing",
					Status:   http.StatusBadRequest,
					Detail:   "start query param is not provided",
					Instance: path,
				})

				return
			}

			parsedStart, err := strconv.ParseInt(startstr, 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, &ErrorResponse{
					Type:     "/errors/bad-start-query-param",
					Title:    "start query cannot be parsed",
					Status:   http.StatusBadRequest,
					Detail:   "start query param must be int64",
					Instance: path,
				})

				return
			}

			qstart = parsedStart

			endstr, eoi := c.GetQuery("end")
			if !eoi {
				c.JSON(http.StatusBadRequest, &ErrorResponse{
					Type:     "/errors/query-param-end-missing",
					Title:    "query param end is missing",
					Status:   http.StatusBadRequest,
					Detail:   "end query param is not provided",
					Instance: path,
				})

				return
			}

			parsedEnd, err := strconv.ParseInt(endstr, 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, &ErrorResponse{
					Type:     "/errors/bad-end-query-param",
					Title:    "end query cannot be parsed",
					Status:   http.StatusBadRequest,
					Detail:   "end query param must be int64",
					Instance: path,
				})

				return
			}

			qend = parsedEnd
		}

		evs, err := m.GetEvents(userId, customId, keyIds, qstart, qend)
		if err != nil {
			telemetry.Incr("bricksllm.admin.get_get_events_handler.get_events_error", nil, 1)

			logError(log, "error when getting events", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/event-manager",
				Title:    "getting events error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_get_events_handler.success", nil, 1)

		c.JSON(http.StatusOK, evs)
	}
}

// DeleteEventsResponse says how many events the call removed.
type DeleteEventsResponse struct {
	Deleted int64 `json:"deleted"`
}

// getDeleteEventsHandler removes the request history of a time range.
//
// Both ends are required and neither has a default: an endpoint that empties the
// whole table when a parameter is forgotten is not one worth having.
//
// Deleting the history does not change what a key has spent - that counter lives
// in Redis and is what the cost limit is enforced against.
func getDeleteEventsHandler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_delete_events_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_delete_events_handler.latency", dur, nil, 1)
		}()

		path := "/api/events"

		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		qstart, ok := parseEventTimestamp(c, path, "start")
		if !ok {
			return
		}

		qend, ok := parseEventTimestamp(c, path, "end")
		if !ok {
			return
		}

		if qstart > qend {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/bad-time-range",
				Title:    "start is larger than end",
				Status:   http.StatusBadRequest,
				Detail:   "start query param cannot be larger than end",
				Instance: path,
			})

			return
		}

		deleted, err := m.DeleteEvents(c.Request.Context(), qstart, qend)
		if err != nil {
			telemetry.Incr("bricksllm.admin.get_delete_events_handler.delete_events_error", nil, 1)

			// Batches commit as they go, so say what was removed before it broke:
			// otherwise a repeated failure looks like nothing is happening at all.
			log.Sugar().Infof("deleted %d events between %d and %d before failing", deleted, qstart, qend)

			logError(log, "error when deleting events", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/event-manager",
				Title:    "deleting events error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_delete_events_handler.success", nil, 1)

		// Destructive and irreversible, so it is on the record even in production.
		log.Sugar().Infof("deleted %d events between %d and %d", deleted, qstart, qend)

		c.JSON(http.StatusOK, &DeleteEventsResponse{Deleted: deleted})
	}
}

// parseEventTimestamp reads a required unix timestamp query param and answers the
// request itself when it is missing or malformed.
func parseEventTimestamp(c *gin.Context, path, name string) (int64, bool) {
	raw, ok := c.GetQuery(name)
	if !ok {
		c.JSON(http.StatusBadRequest, &ErrorResponse{
			Type:     "/errors/query-param-" + name + "-missing",
			Title:    "query param " + name + " is missing",
			Status:   http.StatusBadRequest,
			Detail:   name + " query param is not provided",
			Instance: path,
		})

		return 0, false
	}

	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, &ErrorResponse{
			Type:     "/errors/bad-" + name + "-query-param",
			Title:    name + " query cannot be parsed",
			Status:   http.StatusBadRequest,
			Detail:   name + " query param must be int64",
			Instance: path,
		})

		return 0, false
	}

	return parsed, true
}

// getGetEventHandler returns one event with its request and response bodies.
//
// The lists leave the bodies out - for a vision request they are base64 images,
// megabytes a row - so this is where a single request is opened in full.
func getGetEventHandler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_get_event_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_get_event_handler.latency", dur, nil, 1)
		}()

		path := "/api/events/:id"

		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		id := c.Param("id")
		if len(id) == 0 {
			c.JSON(http.StatusBadRequest, &ErrorResponse{
				Type:     "/errors/event-id-empty",
				Title:    "event id is empty",
				Status:   http.StatusBadRequest,
				Detail:   "event id is required for retrieving an event",
				Instance: path,
			})
			return
		}

		ev, err := m.GetEventByID(id)
		if err != nil {
			if _, ok := err.(notFoundError); ok {
				telemetry.Incr("bricksllm.admin.get_get_event_handler.not_found", nil, 1)

				c.JSON(http.StatusNotFound, &ErrorResponse{
					Type:     "/errors/event-not-found",
					Title:    "event is not found",
					Status:   http.StatusNotFound,
					Detail:   err.Error(),
					Instance: path,
				})
				return
			}

			telemetry.Incr("bricksllm.admin.get_get_event_handler.get_event_error", nil, 1)

			logError(log, "error when getting an event", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/event-manager",
				Title:    "getting event error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_get_event_handler.success", nil, 1)

		c.JSON(http.StatusOK, ev)
	}
}

func getGetEventsV2Handler(m KeyReportingManager, prod bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := util.GetLogFromCtx(c)
		telemetry.Incr("bricksllm.admin.get_get_events_v2_handler.requests", nil, 1)

		start := time.Now()
		defer func() {
			dur := time.Since(start)
			telemetry.Timing("bricksllm.admin.get_get_events_v2_handler.latency", dur, nil, 1)
		}()

		path := "/api/v2/events"
		if c == nil || c.Request == nil {
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/empty-context",
				Title:    "context is empty error",
				Status:   http.StatusInternalServerError,
				Detail:   "gin context is empty",
				Instance: path,
			})
			return
		}

		data, err := io.ReadAll(c.Request.Body)
		if err != nil {
			logError(log, "error when reading get events request body", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/request-body-read",
				Title:    "get events request body reader error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		request := &event.EventRequest{}
		err = json.Unmarshal(data, request)
		if err != nil {
			logError(log, "error when unmarshalling get events request body", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/json-unmarshal",
				Title:    "json unmarshaller error",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		keys, err := m.GetEventsV2(request)
		if err != nil {
			errType := "internal"

			defer func() {
				telemetry.Incr("bricksllm.admin.get_get_events_v2_handler.get_events_v2_err", []string{
					"error_type:" + errType,
				}, 1)
			}()

			if _, ok := err.(validationError); ok {
				errType = "validation"
				c.JSON(http.StatusBadRequest, &ErrorResponse{
					Type:     "/errors/validation",
					Title:    "get events request validation failed",
					Status:   http.StatusBadRequest,
					Detail:   err.Error(),
					Instance: path,
				})
				return
			}

			logError(log, "error when getting events", prod, err)
			c.JSON(http.StatusInternalServerError, &ErrorResponse{
				Type:     "/errors/event-manager",
				Title:    "getting events errored out",
				Status:   http.StatusInternalServerError,
				Detail:   err.Error(),
				Instance: path,
			})
			return
		}

		telemetry.Incr("bricksllm.admin.get_get_events_v2_handler.success", nil, 1)
		c.JSON(http.StatusOK, keys)
	}
}
