import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  api,
  loadSession,
  saveSession,
  Unauthorized,
  type Application,
  type ApplicationStatus,
  type GeneratedDocs,
  type Market,
  type MasterProfiles,
  type Profile,
  type SkillsSummary,
} from "./api";
import { Header } from "./Header";
import { DEV_ROUTE, useRoute } from "./useRoute";
import { Home } from "./pages/Home";
import { Applications } from "./pages/Applications";
import { CvMaker } from "./pages/CvMaker";
import { Login } from "./pages/Login";
import { Dev } from "./pages/Dev";
import { Onboarding, shouldOnboard } from "./Onboarding";

export default function App() {
  const route = useRoute();
  const [session, setSession] = useState(() => loadSession());
  const [showTour, setShowTour] = useState(
    () => !!session && shouldOnboard(session.username)
  );

  const [apps, setApps] = useState<Application[] | null>(null);
  const [summary, setSummary] = useState<SkillsSummary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [masters, setMasters] = useState<MasterProfiles | null>(null);
  const [market, setMarket] = useState<Market>("latam");
  const [docs, setDocs] = useState<GeneratedDocs[]>([]);
  const [uploadingMaster, setUploadingMaster] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const appsSectionRef = useRef<HTMLElement>(null);

  // The application submitted last, surfaced as a status line by the form.
  const tracked = apps?.find((a) => a.id === trackedId) ?? null;

  const refresh = useCallback(async () => {
    if (!loadSession()) return;
    try {
      const [list, sum, prof, masterDoc, docList] = await Promise.all([
        api.list(),
        api.skillsSummary(),
        api.profile(),
        api.master(),
        api.docs(),
      ]);
      setProfile(prof);
      setMasters(masterDoc);
      setDocs(
        docList.sort((a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
        )
      );
      setApps(
        list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      );
      setSummary(sum);
      setError("");
    } catch (e) {
      if (e instanceof Unauthorized) {
        setSession(null);
        return;
      }
      setError((e as Error).message);
      setApps((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
  }, [session, refresh]);

  // For anyone but the master the dev route does not exist: it renders the
  // dashboard and the URL is rewritten, so nothing confirms the path is real.
  const isDevRoute = route === DEV_ROUTE && session?.isMaster === true;

  useEffect(() => {
    if (route === DEV_ROUTE && session && !session.isMaster) {
      window.location.hash = "#/home";
    }
  }, [route, session]);

  function signOut() {
    saveSession(null);
    setSession(null);
    setApps(null);
    setSummary(null);
    setProfile(null);
    setMasters(null);
    setDocs([]);
  }

  // While the pipeline is extracting, poll for the result.
  useEffect(() => {
    const analyzing =
      apps?.some((a) => a.analysisStatus === "pending") ||
      profile?.analysisStatus === "pending" ||
      docs.some((d) => d.status === "pending");
    if (!analyzing) return;
    const id = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(id);
  }, [apps, profile, docs, refresh]);

  async function onUploadMaster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingMaster(true);
    setError("");
    try {
      const saved = await api.putMaster(market, file);
      setMasters((current) => ({ ...(current ?? { latam: null, fin: null }), [market]: saved }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadingMaster(false);
    }
  }

  async function onDeleteMaster() {
    if (!confirm(`Delete the ${market} master profile?`)) return;
    await api.deleteMaster(market);
    setMasters((current) => ({ ...(current ?? { latam: null, fin: null }), [market]: null }));
  }

  async function onGenerateDocs(applicationId: string) {
    setGenerating(applicationId);
    setError("");
    try {
      await api.generateDocs(applicationId, market);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  async function onDeleteDocs(applicationId: string) {
    await api.deleteDocs(applicationId);
    await refresh();
  }

  async function onResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const created = await api.uploadResume(file);
      setProfile(created);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onResumeDelete() {
    if (!confirm("Delete the uploaded resume and its extracted profile?"))
      return;
    await api.deleteProfile();
    setProfile(null);
    await refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setTrackedId(null);
    try {
      const created = await api.create({
        url: String(data.get("url") ?? "").trim(),
        status: data.get("status") as ApplicationStatus,
      });
      setTrackedId(created.id);
      form.reset();
      await refresh();
      appsSectionRef.current?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onStatusChange(id: string, status: ApplicationStatus) {
    await api.update(id, { status });
    await refresh();
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this application?")) return;
    await api.remove(id);
    await refresh();
  }

  if (!session) {
    return (
      <div className="frame">
        <Login
          onSignedIn={(next) => {
            setSession(next);
            setShowTour(shouldOnboard(next.username));
          }}
        />
        <footer className="site-footer">developed by Kaleu-dev ® 2026</footer>
      </div>
    );
  }

  return (
    <div className="frame">
      <Header
        route={route}
        session={session}
        onSignOut={signOut}
        onHelp={() => setShowTour(true)}
      />

      {showTour && (
        <Onboarding
          username={session.username}
          onClose={() => setShowTour(false)}
        />
      )}

      <main>
        {error && (
          <div className="error" role="alert">
            [error] {error}
          </div>
        )}

        {(route === "home" || (route === DEV_ROUTE && !isDevRoute)) && (
          <Home
            profile={profile}
            summary={summary}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onResumeChange={onResumeChange}
            onResumeDelete={onResumeDelete}
          />
        )}

        {route === "applications" && (
          <Applications
            apps={apps}
            tracked={tracked}
            saving={saving}
            appsSectionRef={appsSectionRef}
            onSubmit={onSubmit}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        )}

        {isDevRoute && <Dev session={session} />}

        {route === "cv-maker" && (
          <CvMaker
            apps={apps}
            hasResume={profile?.analysisStatus === "done"}
            masters={masters}
            market={market}
            docs={docs}
            generating={generating}
            uploadingMaster={uploadingMaster}
            onMarketChange={setMarket}
            onUploadMaster={onUploadMaster}
            onDeleteMaster={onDeleteMaster}
            onGenerate={onGenerateDocs}
            onDeleteDocs={onDeleteDocs}
          />
        )}
      </main>

      <footer className="site-footer">developed by Kaleu-dev ® 2026</footer>
    </div>
  );
}
