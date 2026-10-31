import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";

type DocCard = {
  title: string;
  tag: string;
  description: string;
  to: string;
  icon: ReactNode;
};

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const cards: DocCard[] = [
  {
    title: "Getting started",
    tag: "Install · Run · Configure",
    description: "Install Bun, start the server, and add your first resumable download in under a minute.",
    to: "/getting-started/installation",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
        <path d="M4 19h16" />
      </svg>
    ),
  },
  {
    title: "Guides",
    tag: "Resume · cURL · Ranges",
    description: "How resumable transfers, cURL imports, byte ranges, previews, and the queue actually behave.",
    to: "/guides/resumable-downloads",
    icon: (
      <svg {...iconProps}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 0 4 21.5Z" />
        <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 11h6" />
      </svg>
    ),
  },
  {
    title: "API reference",
    tag: "HTTP · Settings · Env",
    description: "Every route, request body, environment variable, and the files Downlink keeps on disk.",
    to: "/reference/http-api",
    icon: (
      <svg {...iconProps}>
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
        <path d="M14 4l-4 16" />
      </svg>
    ),
  },
  {
    title: "Help",
    tag: "FAQ · Troubleshooting",
    description: "Diagnose failed transfers, format limits, and the questions people ask before switching.",
    to: "/help/troubleshooting",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.7" />
        <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export default function DocCards(): ReactNode {
  return (
    <div className="docs-card-grid">
      {cards.map((card) => (
        <Link className="docs-card" to={card.to} key={card.title}>
          <span className="docs-card-icon" aria-hidden="true">
            {card.icon}
          </span>
          <span className="docs-card-tag">{card.tag}</span>
          <h3>{card.title}</h3>
          <p>{card.description}</p>
          <span className="docs-card-more" aria-hidden="true">
            Read
            <svg viewBox="0 0 24 24">
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </span>
        </Link>
      ))}
    </div>
  );
}
