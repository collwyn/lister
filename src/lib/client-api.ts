// Browser-side fetch helper shared by the app's pages.
// Every API route answers { error } on failure; if a response arrives without
// one (a proxy page, a crash), say where to look instead of a bare status code.

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      json?.error ??
        `The app didn't return a readable answer (status ${res.status}). Try again; if it repeats, check the app's runtime logs in Sevalla.`,
    );
  }
  return (json ?? {}) as T;
}
