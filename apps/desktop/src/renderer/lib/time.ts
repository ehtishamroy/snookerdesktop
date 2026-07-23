/** Always renders in 12-hour clock time regardless of the OS/browser locale (staff asked for a consistent, unambiguous AM/PM display). */
export function formatTime12h(iso: string): string {
  const d = new Date(iso);
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${ampm}`;
}

export function formatDateTime12h(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return `${datePart}, ${formatTime12h(iso)}`;
}
