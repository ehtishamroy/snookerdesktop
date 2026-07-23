const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function toDateInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date + 12-hour (hour/minute/AM-PM) picker — used instead of the native
 * `datetime-local` input, whose AM/PM-vs-24-hour display follows the OS
 * locale and can't be forced to 12-hour consistently across machines. */
export function TimeInput12h({ value, onChange }: { value: Date; onChange: (next: Date) => void }) {
  const hour24 = value.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = value.getMinutes();
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";

  function update(nextHour12: number, nextMinute: number, nextAmPm: "AM" | "PM") {
    let h = nextHour12 % 12;
    if (nextAmPm === "PM") h += 12;
    const next = new Date(value);
    next.setHours(h, nextMinute, 0, 0);
    onChange(next);
  }

  function updateDatePart(dateStr: string) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const next = new Date(value);
    next.setFullYear(y!, m! - 1, d!);
    onChange(next);
  }

  return (
    <div className="flex gap-2">
      <input
        type="date"
        className="field-input"
        value={toDateInputValue(value)}
        onChange={(e) => updateDatePart(e.target.value)}
      />
      <select className="field-input w-20" value={hour12} onChange={(e) => update(Number(e.target.value), minute, ampm)}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <select className="field-input w-20" value={minute} onChange={(e) => update(hour12, Number(e.target.value), ampm)}>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m.toString().padStart(2, "0")}
          </option>
        ))}
      </select>
      <select className="field-input w-24" value={ampm} onChange={(e) => update(hour12, minute, e.target.value as "AM" | "PM")}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
