import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import type { PrismTheme } from "prism-react-renderer";

/** Syntax palette lifted from the marketing site's terminal blocks. */
const downlinkCodeTheme: PrismTheme = {
  plain: {
    color: "#cbd6d1",
    backgroundColor: "#0a0f0e",
  },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#6f7d78", fontStyle: "italic" },
    },
    {
      types: ["punctuation"],
      style: { color: "#93a29c" },
    },
    {
      types: ["property", "tag", "constant", "symbol", "deleted"],
      style: { color: "#ff8b9a" },
    },
    {
      types: ["boolean", "number"],
      style: { color: "#ffc857" },
    },
    {
      types: ["selector", "attr-name", "string", "char", "builtin", "inserted"],
      style: { color: "#5eead4" },
    },
    {
      types: ["operator", "entity", "url"],
      style: { color: "#cbd6d1" },
    },
    {
      types: ["atrule", "attr-value", "keyword"],
      style: { color: "#b6f36b" },
    },
    {
      types: ["function", "class-name"],
      style: { color: "#a5b8f5" },
    },
    {
      types: ["important", "bold"],
      style: { fontWeight: "600", color: "#edf4f0" },
    },
    {
      types: ["italic"],
      style: { fontStyle: "italic" },
    },
  ],
};

/**
 * The docs deploy into the same GitHub Pages artifact as the marketing site:
 *
 *   https://403access.github.io/downlink/        → website/
 *   https://403access.github.io/downlink/docs/   → docs-site/
 *
 * SITE_URL is shared with scripts/build-site.ts so both sites stay on the same
 * origin and repository path.
 */
const rawSiteUrl = (process.env.DOCS_SITE_URL || process.env.SITE_URL || "https://403access.github.io/downlink").replace(
  /\/+$/,
  "",
);
const parsedSiteUrl = new URL(rawSiteUrl);
const pathPrefix = parsedSiteUrl.pathname.replace(/\/+$/, "");
const siteUrl = parsedSiteUrl.origin;

function normalizeBaseUrl(value: string): string {
  return `/${value.replace(/^\/+|\/+$/g, "")}/`.replace(/\/{2,}/g, "/");
}

const baseUrl = normalizeBaseUrl(process.env.DOCS_BASE_URL || `${pathPrefix}/docs`);
const marketingUrl = `${siteUrl}${pathPrefix}/`;
const repoUrl = "https://github.com/403access/downlink";

function readAppVersion(): string {
  for (const candidate of [join(process.cwd(), "..", "package.json"), join(process.cwd(), "package.json")]) {
    try {
      const version = JSON.parse(readFileSync(candidate, "utf8")).version;
      if (typeof version === "string" && version.length > 0) return version;
    } catch {
      // Keep looking; the docs build should not fail over a missing version.
    }
  }

  return "dev";
}

const appVersion = readAppVersion();

const config: Config = {
  title: "Downlink",
  tagline: "Local-first, resumable downloads. Fully documented.",
  favicon: "img/favicon.svg",

  url: siteUrl,
  baseUrl,

  organizationName: "403access",
  projectName: "downlink",
  trailingSlash: true,

  onBrokenLinks: "throw",
  onBrokenAnchors: "warn",

  markdown: {
    format: "detect",
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  customFields: {
    marketingUrl,
    appVersion,
  },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: `${repoUrl}/edit/main/docs-site/`,
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
        sitemap: {
          changefreq: "weekly",
          priority: 0.7,
          filename: "sitemap.xml",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    metadata: [
      { name: "theme-color", content: "#070a0a" },
      { name: "color-scheme", content: "dark" },
      {
        name: "description",
        content:
          "Documentation for Downlink — a local-first, resumable media and file downloader built with pure Bun.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Downlink" },
      { property: "og:title", content: "Downlink documentation" },
      {
        property: "og:description",
        content: "Setup, guides, and API reference for the local-first, resumable downloader built with pure Bun.",
      },
      { property: "og:image", content: `${siteUrl}${pathPrefix}/assets/og.jpg` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    colorMode: {
      defaultMode: "dark",
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      hideOnScroll: false,
      logo: {
        src: "img/logo.svg",
        alt: "Downlink",
        width: 40,
        height: 40,
      },
      title: "Downlink",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Documentation",
        },
        {
          to: "/getting-started/quickstart",
          label: "Quickstart",
          position: "left",
        },
        {
          href: repoUrl,
          label: "GitHub",
          position: "right",
        },
        {
          href: marketingUrl,
          label: "Marketing site",
          position: "right",
        },
        {
          to: "/getting-started/quickstart",
          label: "Run it locally",
          position: "right",
          className: "navbar-cta",
        },
      ],
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
    prism: {
      theme: downlinkCodeTheme,
      darkTheme: downlinkCodeTheme,
      additionalLanguages: ["bash", "json", "diff", "typescript", "http"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
