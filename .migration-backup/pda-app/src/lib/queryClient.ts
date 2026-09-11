import { QueryClient } from "@tanstack/react-query";
import { getToken, clearToken } from "./auth";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: (failureCount, error: any) => {
        if (error?.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/";
    throw Object.assign(new Error("Session expired"), { status: 401 });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || res.statusText), { status: res.status });
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Default fetcher for TanStack Query — reads path from queryKey[0]
queryClient.setDefaultOptions({
  queries: {
    queryFn: async ({ queryKey }) => {
      const path = queryKey[0] as string;
      return apiFetch(path);
    },
  },
});
