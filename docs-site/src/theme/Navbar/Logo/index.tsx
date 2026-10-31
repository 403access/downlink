import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";

/**
 * The marketing header brand, carried into the docs navbar: a lime gradient
 * mark, the wordmark, and the small-caps descriptor.
 */
export default function NavbarLogo(): ReactNode {
  return (
    <Link className="brand navbar__brand" to="/" aria-label="Downlink documentation home">
      <span className="brand-mark" aria-hidden="true">
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
        <small>docs</small>
      </span>
    </Link>
  );
}
