const API_URL = import.meta.env.VITE_API_URL ?? "";

export type ApplicationStatus =
  | "wishlist"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface Application {
  id: string;
  company: string;
  role: string;
  url?: string;
  status: ApplicationStatus;
  skills?: string[];
  analysisStatus?: "pending" | "done" | "failed";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillsSummary {
  totalApplications: number;
  analyzedApplications: number;
  byStatus: Record<ApplicationStatus, number>;
  skills: { name: string; count: number }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  list: () => request<Application[]>("/applications"),
  create: (data: { url: string; status?: ApplicationStatus }) =>
    request<Application>("/applications", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Application>) =>
    request<Application>(`/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<void>(`/applications/${id}`, { method: "DELETE" }),
  skillsSummary: () => request<SkillsSummary>("/skills/summary"),
};
