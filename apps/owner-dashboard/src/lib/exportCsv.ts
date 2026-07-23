import { apiUrl } from "./apiClient";
import { getToken } from "./tokenStore";

/**
 * Triggers a CSV download for any of the `/reports/*` (or other list)
 * endpoints, which all accept `&format=csv` per docs/API_CONTRACT.md.
 *
 * We can't just navigate the browser to the URL because the endpoint
 * requires `Authorization: Bearer <jwt>` — instead we fetch the CSV as a
 * blob with the auth header attached, then trigger a client-side download.
 */
export async function exportCsv(
  path: string,
  query: Record<string, string | number | boolean | undefined | null>,
  filename: string
): Promise<void> {
  const token = getToken();
  const url = apiUrl(path, { ...query, format: "csv" });

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Export failed (${response.status})`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}
