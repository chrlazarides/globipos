import content from "./manuals/deployment-and-monitoring.json";

export type GuideSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  checklist?: string[];
  commands?: { label: string; text: string }[];
  warning?: string;
};

export const deploymentGuide = content as {
  title: string; revision: string; introduction: string; sections: GuideSection[];
};

export function escapeManualHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function renderDeploymentManualContents(): string {
  return `<li><a href="#deployment-operations">Deployment &amp; Monitoring</a><ol class="sub">${
    deploymentGuide.sections.map((section) =>
      `<li><a href="#${escapeManualHtml(section.id)}">${escapeManualHtml(section.title)}</a></li>`,
    ).join("")
  }</ol></li>`;
}

export function renderDeploymentManualSections(): string {
  const html = escapeManualHtml;
  return `<div class="section" id="deployment-operations">
    <h2 class="section-title">Deployment &amp; Monitoring — Operator Procedures</h2>
    <p>Documentation revision: ${html(deploymentGuide.revision)} (Europe/Nicosia).</p>
    <p>${html(deploymentGuide.introduction)}</p>
    ${deploymentGuide.sections.map((section) => `
      <section id="${html(section.id)}">
        <h3 class="sub-title">${html(section.title)}</h3>
        ${(section.paragraphs ?? []).map((paragraph) => `<p>${html(paragraph)}</p>`).join("")}
        ${section.steps ? `<ol class="guide-steps">${section.steps.map((step) => `<li>${html(step)}</li>`).join("")}</ol>` : ""}
        ${section.checklist ? `<ul class="guide-steps">${section.checklist.map((item) => `<li>${html(item)}</li>`).join("")}</ul>` : ""}
        ${(section.commands ?? []).map((command) => `<p><strong>${html(command.label)}</strong></p><pre class="guide-code"><code>${html(command.text)}</code></pre>`).join("")}
        ${section.warning ? `<div class="note"><strong>Important:</strong> ${html(section.warning)}</div>` : ""}
      </section>
    `).join("")}
  </div>`;
}

export function renderDeploymentMarkdown(): string {
  return `# ${deploymentGuide.title}\n\nRevision: ${deploymentGuide.revision} (Europe/Nicosia)\n\n${deploymentGuide.introduction}\n\n${
    deploymentGuide.sections.map((section) => [
      `## ${section.title}`,
      ...(section.paragraphs ?? []),
      ...(section.steps ?? []).map((step, index) => `${index + 1}. ${step}`),
      ...(section.checklist ?? []).map((item) => `- ${item}`),
      ...(section.commands ?? []).map((command) => `${command.label}\n\n\`\`\`sh\n${command.text}\n\`\`\``),
      ...(section.warning ? [`> Important: ${section.warning}`] : []),
    ].join("\n\n")).join("\n\n")
  }\n`;
}

export function renderStandaloneDeploymentManual(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeManualHtml(deploymentGuide.title)}</title><style>
    *{box-sizing:border-box}body{font:15px/1.65 system-ui,Arial,sans-serif;color:#17212b;background:#f3f5f7;margin:0}
    main{max-width:960px;margin:24px auto;padding:36px 48px;background:white}h1,h2,h3{color:#203c57}h3{margin-top:36px}
    a{color:#175a93}li{margin-bottom:10px}.guide-steps{padding-left:24px}.guide-code{background:#edf1f5;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace}
    .note{border-left:4px solid #b37918;background:#fff6e5;padding:14px;margin:16px 0}nav{background:#f3f5f7;padding:16px}
    button{padding:10px 18px;border:0;border-radius:5px;background:#203c57;color:white;cursor:pointer}
    @media(max-width:600px){main{padding:22px;margin:0}}@media print{body{background:white}main{max-width:none;margin:0;padding:0}.no-print{display:none}h3{break-after:avoid}.guide-code,.note{break-inside:avoid}}
    </style></head><body><main><div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
    <h1>${escapeManualHtml(deploymentGuide.title)}</h1><nav><ol>${renderDeploymentManualContents()}</ol></nav>
    ${renderDeploymentManualSections()}</main></body></html>`;
}