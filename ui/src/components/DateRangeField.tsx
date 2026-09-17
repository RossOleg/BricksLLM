import React, { useState } from "react";
import { format, startOfDay, endOfDay, subDays, startOfMonth } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Выбор диапазона дат календарём.
 *
 * Раньше это были два поля datetime-local: ввод руками, а иконка календаря у
 * такого поля еле видна и в тёмной теме почти сливается. Здесь календарь
 * открывается по всей кнопке, а под ним лежат готовые периоды - ими и
 * пользуются в девяти случаях из десяти.
 */
export interface Period {
  /** Начало и конец в секундах unix - ровно то, что ждёт API. */
  start: number;
  end: number;
}

const PRESETS: { label: string; make: () => DateRange }[] = [
  { label: "Today", make: () => ({ from: new Date(), to: new Date() }) },
  { label: "7 days", make: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: "30 days", make: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: "This month", make: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
];

export function toPeriod(range?: DateRange): Period | null {
  if (!range?.from) return null;

  // Без верхней границы считаем один выбранный день, и он берётся целиком:
  // до конца суток, иначе "сегодня" не включало бы сегодняшние запросы.
  const to = range.to ?? range.from;

  return {
    start: Math.floor(startOfDay(range.from).getTime() / 1000),
    end: Math.floor(endOfDay(to).getTime() / 1000),
  };
}

const DateRangeField: React.FC<{
  value?: DateRange;
  onChange: (range?: DateRange) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const [open, setOpen] = useState(false);

  const label = value?.from
    ? value.to && value.to.getTime() !== value.from.getTime()
      ? `${format(value.from, "d MMM yyyy")} — ${format(value.to, "d MMM yyyy")}`
      : format(value.from, "d MMM yyyy")
    : "Pick a period";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("justify-start gap-2 font-normal", !value?.from && "text-muted-foreground", className)}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(preset.make());
                setOpen(false);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
};

export default DateRangeField;
