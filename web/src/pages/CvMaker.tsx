import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  MARKET_LABELS,
  MARKETS,
  type Application,
  type GeneratedDocs,
  type Market,
  type MasterProfiles,
} from "../api";
import { Dots } from "../common";

interface CvMakerProps {
  apps: Application[] | null;
  hasResume: boolean;
  masters: MasterProfiles | null;
  market: Market;
  docs: GeneratedDocs[];
  generating: string | null;
  uploadingMaster: boolean;
  onMarketChange: (market: Market) => void;
  onUploadMaster: (event: ChangeEvent<HTMLInputElement>) => void;
  onDeleteMaster: () => void;
  onGenerate: (applicationId: string) => void;
  onDeleteDocs: (applicationId: string) => void;
}

// A4 minus the frozen 18mm/20mm margins, at 96dpi: the same geometry the local
// build script validates against.
const PAGE_USABLE_PX = 986;
const PAGE_WIDTH_PX = 643; // 170mm

/**
 * Renders the document off-screen at exact print width and reads its height.
 * The browser is the only engine here that can measure for real, so the
 * one-page gate is verified rather than estimated.
 */
function useMeasuredFill(html?: string): number | null {
  const [fill, setFill] = useState<number | null>(null);

  useEffect(() => {
    if (!html) {
      setFill(null);
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = `position:absolute;left:-10000px;top:0;width:${PAGE_WIDTH_PX}px;height:2000px;border:0;visibility:hidden`;
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      // Let fonts settle before measuring.
      const id = setTimeout(() => {
        const height = doc.body?.scrollHeight ?? 0;
        setFill(Math.round((height / PAGE_USABLE_PX) * 100));
        frame.remove();
      }, 120);
      return () => {
        clearTimeout(id);
        frame.remove();
      };
    }
    frame.remove();
  }, [html]);

  return fill;
}

function DocPreview({ html, label }: { html: string; label: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fill = useMeasuredFill(html);

  function printDoc() {
    const win = frameRef.current?.contentWindow;
    win?.focus();
    win?.print();
  }

  function downloadHtml() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${label.toLowerCase().replace(/\s+/g, "-")}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="doc-preview">
      <div className="doc-head">
        <span className="file-name">{label}</span>
        <div className="app-actions">
          {fill !== null && (
            <span className={`fill-badge${fill > 100 ? " over" : ""}`}>
              {fill}% of one page
            </span>
          )}
          <button type="button" className="ghost-btn" onClick={printDoc}>
            [save pdf]
          </button>
          <button type="button" className="ghost-btn" onClick={downloadHtml}>
            [html]
          </button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        className="doc-frame"
        title={label}
        srcDoc={html}
      />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost-btn"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "[copied]" : label}
    </button>
  );
}

function DocsResult({
  entry,
  onDelete,
}: {
  entry: GeneratedDocs;
  onDelete: () => void;
}) {
  return (
    <div className="cv-result">
      <div className="profile-file">
        <span className="file-name">
          <span className="app-role">{entry.role}</span>
          <span className="app-company">
            {" //"}
            {entry.company}
          </span>
          {entry.market && (
            <span className="match-detail"> {MARKET_LABELS[entry.market]}</span>
          )}
          {entry.lang && <span className="match-detail"> · {entry.lang}</span>}
        </span>
        <div className="app-actions">
          {entry.coverLetterText && (
            <CopyButton text={entry.coverLetterText} label="[copy letter]" />
          )}
          <button type="button" className="ghost-btn" onClick={onDelete}>
            [delete]
          </button>
        </div>
      </div>

      {entry.status === "pending" && (
        <p className="pipeline-status">
          {"> reading the posting, selecting from your master profile, writing"}
          <span className="cursor">█</span>
        </p>
      )}

      {entry.status === "failed" && (
        <p className="pipeline-status status-failed">
          {`> generation failed. ${entry.error ?? "try again."}`}
        </p>
      )}

      {entry.status === "done" && (
        <>
          {entry.angle && <p className="block-note doc-angle">{entry.angle}</p>}

          <div className="doc-grid">
            {entry.resumeHtml && (
              <DocPreview html={entry.resumeHtml} label="Resume" />
            )}
            {entry.coverLetterHtml && (
              <DocPreview html={entry.coverLetterHtml} label="Cover letter" />
            )}
          </div>

          <details className="skills-drawer">
            <summary>
              <span className="drawer-marker" aria-hidden="true" />
              coverage report
            </summary>
            <div className="report">
              {(entry.keywordsCovered?.length ?? 0) > 0 && (
                <div className="gap-group">
                  <h3 className="gap-title">{"//covered"}</h3>
                  <div className="tags">
                    {entry.keywordsCovered!.map((k) => (
                      <span key={k} className="tag">
                        [{k}]
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(entry.gapsHeLacks?.length ?? 0) > 0 && (
                <div className="gap-group">
                  <h3 className="gap-title">{"//he does not have"}</h3>
                  <div className="tags">
                    {entry.gapsHeLacks!.map((k) => (
                      <span key={k} className="tag missing">
                        [{k}]
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(entry.gapsNoRoom?.length ?? 0) > 0 && (
                <div className="gap-group">
                  <h3 className="gap-title">{"//did not fit"}</h3>
                  <div className="tags">
                    {entry.gapsNoRoom!.map((k) => (
                      <span key={k} className="tag">
                        [{k}]
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(entry.cut?.length ?? 0) > 0 && (
                <div className="gap-group">
                  <h3 className="gap-title">{"//cut"}</h3>
                  <ul className="plan-list">
                    {entry.cut!.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(entry.warnings?.length ?? 0) > 0 && (
                <div className="gap-group">
                  <h3 className="gap-title">{"//voice warnings"}</h3>
                  <ul className="plan-list">
                    {entry.warnings!.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export function CvMaker({
  apps,
  hasResume,
  masters,
  market,
  docs,
  generating,
  uploadingMaster,
  onMarketChange,
  onUploadMaster,
  onDeleteMaster,
  onGenerate,
  onDeleteDocs,
}: CvMakerProps) {
  const masterInputRef = useRef<HTMLInputElement>(null);
  const master = masters?.[market] ?? null;
  const analyzed = (apps ?? []).filter(
    (a) => a.analysisStatus === "done" && (a.skills?.length ?? 0) > 0
  );
  const generated = new Set(docs.map((d) => d.applicationId));
  const available = analyzed.filter((a) => !generated.has(a.id));

  return (
    <>
      <section className="block">
        <h2 className="block-label">{"//cv-maker"}</h2>
        <p className="about-copy">
          pick a job you saved and get a resume and a cover letter written for
          it. content comes from the resume you uploaded and nothing else, so
          every claim survives the interview. both are checked against the ATS
          rules and have to fit on one page.
        </p>

        {!hasResume && !master && (
          <p className="pipeline-status build-note status-failed">
            {"> upload your resume in //dashboard first"}
          </p>
        )}
      </section>

      <section className="block">
        <h2 className="block-label">{"//market"}</h2>
        <div className="toggle" role="group" aria-label="Target market">
          {MARKETS.map((m) => (
            <button
              key={m}
              type="button"
              className={`toggle-option${m === market ? " active" : ""}`}
              aria-pressed={m === market}
              onClick={() => onMarketChange(m)}
            >
              {MARKET_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="block-note toggle-note">
          {market === "fin"
            ? "finnish rules: work authorization, finnish level and location stated plainly in the closing paragraph, gaps named instead of hidden."
            : "latam and remote rules: contractor terms, invoicing and timezone overlap in the closing paragraph, no visa section."}
        </p>
      </section>

      <section className="block">
        <h2 className="block-label">
          {"//master profile"}
          <span className="block-count">
            {" "}
            (optional · {MARKET_LABELS[market]})
          </span>
        </h2>
        <input
          ref={masterInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          onChange={onUploadMaster}
          hidden
        />

        {!master && (
          <div className="upload-empty">
            <p className="block-note upload-note">
              your resume is the source by default. a master profile replaces it
              with a richer superset for this market: every experience, project,
              anchor story and limit, in markdown. what is generated is always a
              selection from the source, never an addition to it.
            </p>
            <button
              type="button"
              className="boxed-btn"
              onClick={() => masterInputRef.current?.click()}
              disabled={uploadingMaster}
            >
              {uploadingMaster ? (
                <>
                  uploading
                  <Dots />
                </>
              ) : (
                "upload master profile"
              )}
            </button>
          </div>
        )}

        {master && (
          <div className="profile-file">
            <span className="file-name">
              [file] {master.fileName}
              <span className="match-detail">
                {" "}
                {(master.size / 1024).toFixed(1)} kb
              </span>
            </span>
            <div className="app-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => masterInputRef.current?.click()}
                disabled={uploadingMaster}
              >
                {uploadingMaster ? (
                  <>
                    [uploading
                    <Dots />]
                  </>
                ) : (
                  "[replace]"
                )}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={onDeleteMaster}
              >
                [delete]
              </button>
            </div>
          </div>
        )}
      </section>

      {(master || hasResume) && (
        <section className="block">
          <h2 className="block-label">
            {"//generate for"}
            <span className="block-count">
              {" "}
              (source: {master ? master.fileName : "your resume"})
            </span>
          </h2>

          {analyzed.length === 0 && (
            <p className="empty">
              no analyzed applications yet. add one in{" "}
              <a href="#/applications">{"//applications"}</a>.
            </p>
          )}

          {available.length > 0 && (
            <ul className="apps">
              {available.map((app) => (
                <li key={app.id} className="app-row cv-pick">
                  <span className="match-role">
                    <span className="app-role">{app.role}</span>
                    <span className="app-company">
                      {" //"}
                      {app.company}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="boxed-btn"
                    onClick={() => onGenerate(app.id)}
                    disabled={generating !== null}
                  >
                    {generating === app.id ? (
                      <>
                        generating
                        <Dots />
                      </>
                    ) : (
                      "generate"
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {analyzed.length > 0 && available.length === 0 && (
            <p className="empty">every analyzed application already has documents.</p>
          )}
        </section>
      )}

      {docs.length > 0 && (
        <section className="block">
          <h2 className="block-label">
            {"//documents"}
            <span className="block-count"> ({docs.length})</span>
          </h2>
          <div className="cv-list">
            {docs.map((entry) => (
              <DocsResult
                key={entry.applicationId}
                entry={entry}
                onDelete={() => onDeleteDocs(entry.applicationId)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
