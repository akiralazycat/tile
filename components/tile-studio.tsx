"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { HouseBar } from "@/components/house-bar";
import type { InspectResponse, TileSource } from "@/lib/tile";

type WidgetSize = "small" | "medium" | "large";
type WidgetLayout = "focus" | "list" | "brief";
type Appearance = "ink" | "paper" | "glass";

const accents = ["#8CF7C5", "#A6C8FF", "#D8B4FE", "#FFD38A", "#FF9D9D"];

const demoSource: TileSource = {
  requestedUrl: "https://example.com/feed",
  resolvedUrl: "https://example.com/",
  title: "Signal Journal",
  description: "A calm stream of things worth noticing.",
  siteName: "Signal Journal",
  kind: "rss",
  fetchedAt: new Date().toISOString(),
  refreshMinutes: 20,
  items: [
    {
      title: "The small interfaces that quietly become infrastructure",
      description: "Why narrow tools often outlive platforms built to do everything.",
      date: new Date().toISOString(),
    },
    {
      title: "Designing for a glance, not a session",
      description: "A widget should answer one question before it asks for attention.",
    },
    {
      title: "The return of useful personal software",
      description: "Tiny utilities are becoming expressive again.",
    },
  ],
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function kindLabel(kind: TileSource["kind"]) {
  return {
    rss: "RSS",
    atom: "Atom",
    "json-feed": "JSON Feed",
    "web-page": "Web page",
  }[kind];
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function relativeTime(date?: string) {
  if (!date) return "Latest";
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return "Latest";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function scriptableCode(
  source: TileSource,
  origin: string,
  accent: string,
  appearance: Appearance,
  size: WidgetSize,
) {
  const api = `${origin}/api/inspect?url=${encodeURIComponent(source.requestedUrl)}`;
  const background = appearance === "paper" ? "#F3F0E8" : appearance === "glass" ? "#1B1D20" : "#111315";
  const foreground = appearance === "paper" ? "#171819" : "#F7F8F8";
  const secondary = appearance === "paper" ? "#676A6D" : "#A7ADB2";
  const present = size === "small" ? "presentSmall" : size === "large" ? "presentLarge" : "presentMedium";

  return `// Tile · generated for Scriptable\nconst API = ${JSON.stringify(api)};\nconst ACCENT = ${JSON.stringify(accent)};\n\nconst req = new Request(API);\nconst payload = await req.loadJSON();\nif (!payload.ok) throw new Error(payload.error || "Tile source failed");\n\nconst source = payload.source;\nconst widget = new ListWidget();\nwidget.backgroundColor = new Color(${JSON.stringify(background)});\nwidget.setPadding(16, 16, 16, 16);\n\nconst eyebrow = widget.addText((source.siteName || source.title).toUpperCase());\neyebrow.font = Font.semiboldSystemFont(9);\neyebrow.textColor = new Color(ACCENT);\neyebrow.lineLimit = 1;\n\nwidget.addSpacer(8);\nconst headline = widget.addText(source.items?.[0]?.title || source.title);\nheadline.font = Font.boldSystemFont(${size === "small" ? 16 : 18});\nheadline.textColor = new Color(${JSON.stringify(foreground)});\nheadline.lineLimit = ${size === "small" ? 4 : 3};\n\nif (${JSON.stringify(size)} !== "small" && source.items?.[0]?.description) {\n  widget.addSpacer(6);\n  const summary = widget.addText(source.items[0].description);\n  summary.font = Font.systemFont(11);\n  summary.textColor = new Color(${JSON.stringify(secondary)});\n  summary.lineLimit = 2;\n}\n\nwidget.addSpacer();\nconst footer = widget.addText(source.kind.replace("-", " ") + "  ·  " + source.refreshMinutes + "m refresh");\nfooter.font = Font.mediumSystemFont(9);\nfooter.textColor = new Color(${JSON.stringify(secondary)});\n\nwidget.url = source.items?.[0]?.url || source.resolvedUrl;\nScript.setWidget(widget);\nif (!config.runsInWidget) await widget.${present}();\nScript.complete();`;
}

export function TileStudio() {
  const [input, setInput] = useState("");
  const [source, setSource] = useState<TileSource>(demoSource);
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [size, setSize] = useState<WidgetSize>("medium");
  const [layout, setLayout] = useState<WidgetLayout>("focus");
  const [appearance, setAppearance] = useState<Appearance>("ink");
  const [accent, setAccent] = useState(accents[0]);
  const [selectedItem, setSelectedItem] = useState(0);
  const [copied, setCopied] = useState<"script" | "json" | "link" | "">("");
  const [origin, setOrigin] = useState("https://tile.example");

  useEffect(() => {
    setOrigin(window.location.origin);
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("url");
    if (sharedUrl) {
      setInput(sharedUrl);
      void inspect(sharedUrl);
    }
    const sharedSize = params.get("size");
    if (sharedSize === "small" || sharedSize === "medium" || sharedSize === "large") setSize(sharedSize);
    const sharedLayout = params.get("layout");
    if (sharedLayout === "focus" || sharedLayout === "list" || sharedLayout === "brief") setLayout(sharedLayout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function inspect(rawValue = input) {
    const url = normalizeUrl(rawValue);
    if (!url) {
      setError("Paste a website, RSS, Atom, or JSON Feed URL first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/inspect?url=${encodeURIComponent(url)}`);
      const data = (await response.json()) as InspectResponse;
      if (!data.ok) throw new Error(data.error);
      setSource(data.source);
      setInput(url);
      setIsDemo(false);
      setSelectedItem(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tile could not read this source.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await inspect();
  }

  async function copy(value: string, type: "script" | "json" | "link") {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied(""), 1400);
  }

  const shareUrl = useMemo(() => {
    const params = new URLSearchParams({
      url: source.requestedUrl,
      size,
      layout,
    });
    return `${origin}/?${params.toString()}`;
  }, [layout, origin, size, source.requestedUrl]);

  const configJson = useMemo(
    () =>
      JSON.stringify(
        {
          version: 1,
          source: source.requestedUrl,
          detected: source.kind,
          refreshMinutes: source.refreshMinutes,
          appearance: { size, layout, theme: appearance, accent },
        },
        null,
        2,
      ),
    [accent, appearance, layout, size, source],
  );

  const script = useMemo(
    () => scriptableCode(source, origin, accent, appearance, size),
    [accent, appearance, origin, size, source],
  );

  const activeItem = source.items[selectedItem] ?? source.items[0];
  const displayItems = source.items.slice(0, size === "large" ? 4 : 3);

  return (
    <>
      <HouseBar product="Tile" />
      <main className="studio-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Tile home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>tile</span>
        </a>
        <div className="topbar-copy">web → widget</div>
        <a className="ghost-link" href="#export">Export</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-kicker"><span className="pulse-dot" /> No app. No feed setup.</div>
        <h1>Turn the web into<br /><em>something glanceable.</em></h1>
        <p>Paste almost any page. Tile finds the useful signal, detects feeds when they exist, and turns it into a widget-ready stream.</p>

        <form className="url-bar" onSubmit={onSubmit}>
          <div className="url-field">
            <span className="url-icon">↗</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="news.ycombinator.com, blog, RSS, JSON Feed…"
              inputMode="url"
              aria-label="Source URL"
            />
          </div>
          <button type="submit" disabled={loading}>{loading ? "Reading…" : "Make a tile"}</button>
        </form>
        {error ? <p className="form-error">{error}</p> : <p className="url-hint">Server-side detection · private-network URLs blocked · source content is not stored</p>}
      </section>

      <section className="workspace" aria-label="Tile builder">
        <div className="control-column">
          <div className="section-heading">
            <span>01</span>
            <div><h2>Source</h2><p>Tile chooses the richest available representation.</p></div>
          </div>

          <article className="source-card">
            <div className="source-monogram">{source.title.slice(0, 1).toUpperCase()}</div>
            <div className="source-copy">
              <div className="source-title-row">
                <strong>{source.title}</strong>
                {isDemo ? <span className="demo-pill">demo</span> : null}
              </div>
              <span>{hostLabel(source.resolvedUrl)}</span>
            </div>
            <div className="source-kind"><i />{kindLabel(source.kind)}</div>
          </article>

          <div className="diagnostic-grid">
            <div><span>Detected</span><strong>{kindLabel(source.kind)}</strong></div>
            <div><span>Items</span><strong>{source.items.length || 1}</strong></div>
            <div><span>Refresh</span><strong>{source.refreshMinutes} min</strong></div>
          </div>

          <div className="section-heading compact">
            <span>02</span>
            <div><h2>Shape</h2><p>Choose what deserves the glance.</p></div>
          </div>

          <div className="control-group">
            <label>Size</label>
            <div className="segmented three">
              {(["small", "medium", "large"] as WidgetSize[]).map((value) => (
                <button key={value} className={size === value ? "active" : ""} onClick={() => setSize(value)} type="button">
                  <span className={`size-glyph ${value}`} />{value}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Layout</label>
            <div className="layout-options">
              {([
                ["focus", "Focus", "One strong signal"],
                ["list", "Stack", "Scan multiple items"],
                ["brief", "Brief", "Context + headline"],
              ] as const).map(([value, title, text]) => (
                <button key={value} type="button" onClick={() => setLayout(value)} className={layout === value ? "active" : ""}>
                  <span className={`layout-glyph ${value}`}><i /><i /><i /></span>
                  <span><strong>{title}</strong><small>{text}</small></span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-group split-control">
            <div>
              <label>Surface</label>
              <div className="segmented">
                {(["ink", "paper", "glass"] as Appearance[]).map((value) => (
                  <button key={value} className={appearance === value ? "active" : ""} onClick={() => setAppearance(value)} type="button">{value}</button>
                ))}
              </div>
            </div>
            <div>
              <label>Signal</label>
              <div className="accent-row">
                {accents.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Use accent ${value}`}
                    className={accent === value ? "active" : ""}
                    style={{ "--swatch": value } as React.CSSProperties}
                    onClick={() => setAccent(value)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="preview-column">
          <div className="preview-topline"><span>Live preview</span><span><i /> synced</span></div>
          <div className="phone-stage">
            <div className="phone">
              <div className="dynamic-island" />
              <div className="phone-time">9:41</div>
              <div className="phone-grid">
                <div
                  className={`widget widget-${size} layout-${layout} theme-${appearance}`}
                  style={{ "--accent": accent } as React.CSSProperties}
                >
                  <div className="widget-top">
                    <div className="widget-source"><span>{source.title.slice(0, 1).toUpperCase()}</span>{source.siteName ?? source.title}</div>
                    <div className="widget-live"><i />{kindLabel(source.kind)}</div>
                  </div>

                  {layout === "focus" ? (
                    <div className="focus-content">
                      <div className="focus-time">{relativeTime(activeItem?.date)}</div>
                      <h3>{activeItem?.title ?? source.title}</h3>
                      {size !== "small" ? <p>{activeItem?.description ?? source.description}</p> : null}
                    </div>
                  ) : null}

                  {layout === "list" ? (
                    <div className="list-content">
                      {displayItems.map((item, index) => (
                        <button key={`${item.title}-${index}`} type="button" onClick={() => setSelectedItem(index)}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{item.title}</strong>
                          <small>{relativeTime(item.date)}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {layout === "brief" ? (
                    <div className="brief-content">
                      <span className="brief-label">THE BRIEF</span>
                      <h3>{activeItem?.title ?? source.title}</h3>
                      {size !== "small" ? <p>{activeItem?.description ?? source.description ?? "Tile distilled this source into a glanceable brief."}</p> : null}
                    </div>
                  ) : null}

                  <div className="widget-footer">
                    <span>tile</span>
                    <span>↻ {source.refreshMinutes}m</span>
                  </div>
                </div>
              </div>
              <div className="phone-dock"><span /><span /><span /><span /></div>
              <div className="home-indicator" />
            </div>
          </div>
          <p className="preview-note">Preview models the information density and safe areas of home-screen widgets; final rendering is handled by the target bridge.</p>
        </div>
      </section>

      <section className="export-section" id="export">
        <div className="export-intro">
          <div className="section-heading">
            <span>03</span>
            <div><h2>Ship the tile</h2><p>The source stays on the web. The bridge only asks Tile for a normalized, lightweight snapshot.</p></div>
          </div>
          <div className="bridge-flow">
            <div><span>1</span><strong>Web</strong><small>{kindLabel(source.kind)}</small></div>
            <b>→</b>
            <div><span>2</span><strong>Tile</strong><small>normalize</small></div>
            <b>→</b>
            <div><span>3</span><strong>Widget</strong><small>glance</small></div>
          </div>
        </div>

        <div className="export-cards">
          <article className="export-card featured">
            <div className="export-card-head"><div><span>iOS bridge</span><h3>Scriptable</h3></div><span className="ready-pill">ready</span></div>
            <p>Paste once into Scriptable, add the script as a Home Screen widget, and Tile handles feed detection and normalization on refresh.</p>
            <div className="code-window"><div><span /><span /><span /></div><pre>{script.slice(0, 460)}{script.length > 460 ? "\n…" : ""}</pre></div>
            <button type="button" className="export-button" onClick={() => copy(script, "script")}>{copied === "script" ? "Copied" : "Copy Scriptable code"}</button>
          </article>

          <article className="export-card">
            <div className="export-card-head"><div><span>Portable recipe</span><h3>Tile JSON</h3></div></div>
            <p>Keep the source, layout, refresh policy, and visual intent in a tiny config that can be consumed by another client.</p>
            <pre className="json-preview">{configJson}</pre>
            <button type="button" className="export-button secondary" onClick={() => copy(configJson, "json")}>{copied === "json" ? "Copied" : "Copy config"}</button>
          </article>

          <article className="export-card link-card">
            <div className="export-card-head"><div><span>Shareable builder</span><h3>Recipe link</h3></div></div>
            <p>Send a reproducible Tile setup without creating an account. The destination re-inspects the live source.</p>
            <div className="share-url">{shareUrl}</div>
            <button type="button" className="export-button secondary" onClick={() => copy(shareUrl, "link")}>{copied === "link" ? "Copied" : "Copy recipe link"}</button>
          </article>
        </div>
      </section>

      <section className="principles">
        <div><span>Auto-discovery</span><strong>RSS when it exists.<br />The page when it doesn’t.</strong></div>
        <div><span>Small payload</span><strong>Normalized data instead<br />of shipping whole websites.</strong></div>
        <div><span>Private by default</span><strong>No account and no<br />source-content storage.</strong></div>
      </section>

      <footer><div className="brand"><span className="brand-mark"><span /></span><span>tile</span></div><p>Make the useful parts of the web glanceable.</p><span>v0.1</span></footer>
      </main>
    </>
  );
}
