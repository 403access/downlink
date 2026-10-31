import React, { useEffect, useState, type ReactNode } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import DocCards from "../components/DocCards";

type CustomFields = {
  appVersion?: string;
  marketingUrl?: string;
};

const quickstart = `git clone https://github.com/403access/downlink.git
cd downlink

bun install
bun run dev`;

function CopyCommand(): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quickstart);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="docs-terminal">
      <div className="docs-terminal-bar">
        <span className="dot dot-red" />
        <span className="dot dot-amber" />
        <span className="dot dot-green" />
        <span className="docs-terminal-title">terminal</span>
        <button className="docs-copy" type="button" onClick={copy}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
          </svg>
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code>
          <span className="t-dim"># clone the source</span>
          {"\n"}
          <span className="t-lime">git</span> clone https://github.com/403access/downlink.git{"\n"}
          <span className="t-lime">cd</span> downlink{"\n\n"}
          <span className="t-dim"># install dev types, then run</span>
          {"\n"}
          <span className="t-lime">bun</span> install{"\n"}
          <span className="t-lime">bun</span> run dev{"\n\n"}
          <span className="t-cyan">→ http://127.0.0.1:3000</span>
        </code>
      </pre>
    </div>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const { appVersion = "dev", marketingUrl } = (siteConfig.customFields ?? {}) as CustomFields;
  const screenshot = useBaseUrl("/img/library.png");

  return (
    <Layout
      title="Documentation"
      description="Setup, guides, and API reference for Downlink — a local-first, resumable media and file downloader built with pure Bun."
      wrapperClassName="docs-landing"
    >
      <main>
        <section className="docs-hero">
          <div className="docs-hero-glow" aria-hidden="true" />
          <div className="docs-container docs-hero-inner">
            <p className="eyebrow">
              <span className="pulse" aria-hidden="true" />
              Documentation · v{appVersion}
            </p>
            <h1>
              Everything you need
              <br />
              <span className="accent">to finish the download.</span>
            </h1>
            <p className="docs-lede">
              Setup, resumable transfers, cURL import, explicit byte ranges, live previews, and the
              full HTTP API. Downlink runs on your machine and keeps the receipts in SQLite.
            </p>
            <div className="docs-actions">
              <Link className="button button-lime" to="/getting-started/quickstart">
                Quickstart
                <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </Link>
              <Link className="button button-ghost" to="/overview">
                Browse the docs
              </Link>
              <a className="button button-ghost" href="https://github.com/403access/downlink" rel="noopener">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                  <path
                    d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.4 9.4 0 0 1 12 6.97c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.8 0 .27.18.6.69.49A10.12 10.12 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
                    fill="currentColor"
                    stroke="none"
                  />
                </svg>
                View source
              </a>
            </div>
            <ul className="docs-hero-meta" aria-label="Documentation scope">
              <li>macOS</li>
              <li>Linux</li>
              <li>Windows</li>
              <li>
                <span aria-hidden="true">·</span> Bun 1.2+
              </li>
              <li>
                <span aria-hidden="true">·</span> {siteConfig.title} v{appVersion}
              </li>
            </ul>

            <div className="docs-showcase">
              <div className="docs-showcase-bar">
                <span className="docs-tabs">
                  <span className="docs-tab is-active">Library</span>
                  <span className="docs-tab">Player</span>
                  <span className="docs-tab">cURL import</span>
                </span>
                <span className="docs-live-chip">
                  <span className="pulse" aria-hidden="true" />
                  localhost
                </span>
              </div>

              <div className="docs-browser">
                <div className="docs-browser-chrome" aria-hidden="true">
                  <span className="dot dot-red" />
                  <span className="dot dot-amber" />
                  <span className="dot dot-green" />
                  <span className="docs-address">127.0.0.1:3000</span>
                  <span className="docs-chrome-note">private · on your machine</span>
                </div>
                <div className="docs-shot-stage">
                  <img
                    src={screenshot}
                    alt="Downlink library with completed and queued downloads, live speed, and resumable progress."
                    width="1440"
                    height="900"
                    fetchPriority="high"
                  />
                </div>
              </div>

              <div className="docs-float-chip docs-float-left" aria-hidden="true">
                <span className="docs-chip-icon docs-chip-lime">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
                  </svg>
                </span>
                <span>
                  <strong>HTTP Range</strong>
                  <small>206 on resume</small>
                </span>
              </div>
              <div className="docs-float-chip docs-float-right" aria-hidden="true">
                <span className="docs-chip-icon docs-chip-cyan">
                  <svg viewBox="0 0 24 24">
                    <path d="m8 5 11 7-11 7Z" />
                  </svg>
                </span>
                <span>
                  <strong>Live preview</strong>
                  <small>while downloading</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="docs-stat-band" aria-label="Downlink at a glance">
          <div className="docs-container docs-stat-grid">
            <div className="docs-stat">
              <strong>0</strong>
              <span>runtime dependencies</span>
            </div>
            <div className="docs-stat">
              <strong>206</strong>
              <span>range-aware resume</span>
            </div>
            <div className="docs-stat">
              <strong>1–10</strong>
              <span>concurrent downloads</span>
            </div>
            <div className="docs-stat">
              <strong>100%</strong>
              <span>local by design</span>
            </div>
          </div>
        </section>

        <section className="docs-section">
          <div className="docs-container">
            <div className="docs-section-head">
              <p className="eyebrow">Browse the docs</p>
              <h2>Pick a path through the manual.</h2>
              <p className="docs-lede">
                Start with a running server, then go as deep as the byte-level resume logic or the
                HTTP surface you want to script against.
              </p>
            </div>
            <DocCards />
          </div>
        </section>

        <section className="docs-section">
          <div className="docs-container">
            <div className="docs-cta">
              <div className="docs-cta-copy">
                <p className="eyebrow">Ready when you are</p>
                <h2>Run it locally.</h2>
                <p className="docs-lede">
                  Downlink needs Bun 1.2 or newer. There is no framework, no build step for the app,
                  and no service to sign up for.
                </p>
                <div className="docs-actions">
                  <Link className="button button-lime" to="/getting-started/quickstart">
                    Open the quickstart
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                      <path d="M5 12h14m-6-6 6 6-6 6" />
                    </svg>
                  </Link>
                  {marketingUrl ? (
                    <a className="button button-ghost" href={marketingUrl}>
                      Visit the site
                    </a>
                  ) : null}
                </div>
              </div>
              <CopyCommand />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
