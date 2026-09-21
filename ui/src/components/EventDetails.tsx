import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { decodeBody, prettyJson, preview, formatSize, downloadText } from "@/lib/payload";

/**
 * Тела одного события.
 *
 * Список их не отдаёт намеренно - у vision-запроса это мегабайты base64 на
 * строку, - поэтому здесь они догружаются по id и только для раскрытого
 * события.
 */
const Body: React.FC<{ title: string; raw: unknown; fileName: string }> = ({ title, raw, fileName }) => {
  const text = prettyJson(decodeBody(raw));
  const { shown, truncated } = preview(text);

  const empty = text.length === 0 || text === "{}";

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{empty ? "not logged" : formatSize(text.length)}</span>

        {!empty && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(text);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => downloadText(fileName, text)}
            >
              Download
            </Button>
          </>
        )}
      </div>

      {empty ? (
        <p className="text-xs text-muted-foreground">
          The key was created with logging switched off for this side of the request.
        </p>
      ) : (
        <>
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-all">
            {shown}
          </pre>
          {truncated && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing the first {formatSize(shown.length)} of {formatSize(text.length)}. Copy or download for the whole
              body.
            </p>
          )}
        </>
      )}
    </div>
  );
};

/** Только то, что показывает эта карточка: остальные поля события уже в строке таблицы. */
type EventDetail = {
  id: string;
  request?: unknown;
  response?: unknown;
  correlationId?: string;
  custom_id?: string;
  provider?: string;
};

const EventDetails: React.FC<{ eventId: string }> = ({ eventId }) => {
  const api = useApi();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    setEvent(null);
    setError(null);

    api
      .getEvent(eventId)
      .then((e: EventDetail) => {
        if (!cancelled) setEvent(e);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [api, eventId]);

  if (error) {
    return <p className="py-3 text-xs text-destructive">{error}</p>;
  }

  if (!event) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Event <span className="font-mono">{event.id}</span>
        </span>
        {event.correlationId && (
          <span>
            Correlation <span className="font-mono">{event.correlationId}</span>
          </span>
        )}
        {event.custom_id && (
          <span>
            Custom id <span className="font-mono">{event.custom_id}</span>
          </span>
        )}
        {event.provider && <span>Provider {event.provider}</span>}
      </div>

      <Body title="Request" raw={event.request} fileName={`request-${event.id}.json`} />
      <Body title="Response" raw={event.response} fileName={`response-${event.id}.json`} />
    </div>
  );
};

export default EventDetails;
