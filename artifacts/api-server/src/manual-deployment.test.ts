import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentGuide, escapeManualHtml, renderDeploymentManualContents,
  renderDeploymentManualSections, renderDeploymentMarkdown, renderStandaloneDeploymentManual,
} from "./manual-deployment";

test("the shared guide has unique, linked chapters and complete operator procedures", () => {
  const ids = deploymentGuide.sections.map(section => section.id);
  assert.equal(ids.length, 18);
  assert.equal(new Set(ids).size, ids.length);
  const contents = renderDeploymentManualContents();
  const sections = renderDeploymentManualSections();
  for (const section of deploymentGuide.sections) {
    assert.match(section.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(contents.includes(`href="#${section.id}"`));
    assert.ok(sections.includes(`id="${section.id}"`));
    assert.ok((section.paragraphs?.length ?? 0) + (section.steps?.length ?? 0) + (section.checklist?.length ?? 0) > 0);
  }
  for (const id of ["deployment-replit", "deployment-native", "deployment-customer", "monitoring-sync", "monitoring-backups", "monitoring-incidents"]) {
    assert.ok(ids.includes(id));
  }
});

test("manual output escapes text, includes truthful sync/backup limits and prints without external assets", () => {
  assert.equal(escapeManualHtml('<script>"&\'</script>'), "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
  const html = renderStandaloneDeploymentManual();
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("window.print()"));
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes('id="deployment-operations"'));
  assert.ok(html.includes("45 seconds"));
  assert.ok(html.includes("two and ten seconds"));
  assert.ok(html.includes("not a guarantee of a weekly full backup"));
  assert.ok(html.includes("node scripts/pos-version.mjs --check"));
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)=/i.test(html));
});

test("Markdown package/document export includes deployment commands, monitoring and rollback warnings", () => {
  const markdown = renderDeploymentMarkdown();
  assert.ok(markdown.includes("psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f database.sql"));
  assert.ok(markdown.includes("bash scripts/publish-release.sh"));
  assert.ok(markdown.includes("preflight_only"));
  assert.ok(markdown.includes("post-cutover"));
  assert.ok(markdown.includes("do not resend") || markdown.includes("do not blindly click Send again"));
  assert.equal((markdown.match(/^## /gm) ?? []).length, 18);
  assert.ok(!markdown.includes("git pull && npm run build"));
});