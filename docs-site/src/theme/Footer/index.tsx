import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

type CustomFields = {
  appVersion?: string;
  marketingUrl?: string;
};

export default function Footer(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const { appVersion = "dev", marketingUrl } = (siteConfig.customFields ?? {}) as CustomFields;
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link className="brand" to="/" aria-label="Downlink documentation home">
            <span className="brand-mark brand-mark-small" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14" />
              </svg>
            </span>
            <span className="brand-copy">
              <strong>Downlink</strong>
              <small>local downloader</small>
            </span>
          </Link>
          <p>Local-first, resumable downloads built with pure Bun.</p>
        </div>

        <nav className="footer-links" aria-label="Footer navigation">
          <Link to="/overview">Documentation</Link>
          <Link to="/getting-started/quickstart">Quickstart</Link>
          <Link to="/reference/http-api">API reference</Link>
          <a href="https://github.com/403access/downlink" rel="noopener">GitHub</a>
          <a href="https://github.com/403access/downlink/issues" rel="noopener">Issues</a>
          {marketingUrl ? <a href={marketingUrl}>Marketing site</a> : null}
        </nav>
      </div>

      <div className="footer-bottom">
        <p>© {year} Downlink. Downloads stay on your machine.</p>
        <p className="footer-meta">
          <span>v{appVersion}</span>
          <span aria-hidden="true">·</span>
          <span>Docs</span>
          <span aria-hidden="true">·</span>
          <span>Built with Docusaurus</span>
        </p>
      </div>
    </footer>
  );
}
