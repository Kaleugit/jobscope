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

export interface Profile {
  fileName: string;
  name?: string;
  title?: string;
  location?: string;
  skills?: string[];
  analysisStatus: "pending" | "done" | "failed";
  uploadedAt: string;
}

export interface SkillMatch {
  id: string;
  company: string;
  role: string;
  required: number;
  owned: number;
  score: number;
}

export interface SkillsSummary {
  totalApplications: number;
  analyzedApplications: number;
  byStatus: Record<ApplicationStatus, number>;
  skills: { name: string; count: number; owned: boolean }[];
  hasProfile: boolean;
  missingSkills: { name: string; count: number }[];
  unusedSkills: string[];
  matches: SkillMatch[];
  averageMatch: number;
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

  profile: () => request<Profile | null>("/profile"),

  deleteProfile: () => request<void>("/profile", { method: "DELETE" }),

  // Presigned PUT keeps the file off API Gateway's payload path.
  uploadResume: async (file: File): Promise<Profile> => {
    const { uploadUrl, key } = await request<{
      uploadUrl: string;
      key: string;
    }>("/profile/upload-url", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, contentType: file.type }),
    });

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`upload failed: HTTP ${put.status}`);

    return request<Profile>("/profile/analyze", {
      method: "POST",
      body: JSON.stringify({
        key,
        fileName: file.name,
        contentType: file.type,
      }),
    });
  },
};
