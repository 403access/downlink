import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "doc",
      id: "index",
      label: "Overview",
    },
    {
      type: "category",
      label: "Getting started",
      collapsible: true,
      collapsed: false,
      items: [
        "getting-started/installation",
        "getting-started/quickstart",
        "getting-started/configuration",
      ],
    },
    {
      type: "category",
      label: "Guides",
      collapsible: true,
      collapsed: false,
      items: [
        "guides/resumable-downloads",
        "guides/curl-import",
        "guides/range-downloads",
        "guides/previewing",
        "guides/queue-and-settings",
        "guides/filenames-and-formats",
        "guides/privacy-and-security",
      ],
    },
    {
      type: "category",
      label: "Reference",
      collapsible: true,
      collapsed: true,
      items: [
        "reference/http-api",
        "reference/project-layout",
      ],
    },
    {
      type: "category",
      label: "Help",
      collapsible: true,
      collapsed: true,
      items: ["help/troubleshooting", "help/faq"],
    },
  ],
};

export default sidebars;
