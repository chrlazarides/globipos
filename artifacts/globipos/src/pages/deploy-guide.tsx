import { useState } from "react";
import { Link } from "wouter";
import { Copy, Check, Printer, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import guide from "../../../api-server/src/manuals/deployment-and-monitoring.json";

type Section = {
  id: string; title: string; paragraphs?: string[]; steps?: string[];
  checklist?: string[]; commands?: { label: string; text: string }[]; warning?: string;
};
const sections: Section[] = guide.sections;

function Command({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Could not copy", description: "Select and copy the command manually.", variant: "destructive" });
    }
  };
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium">{label}</p>
      <Button variant="outline" size="sm" onClick={copy} aria-label={`Copy: ${label}`}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}<span className="ml-2">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-relaxed"><code>{text}</code></pre>
  </div>;
}

export default function DeployGuide() {
  return <div className="mx-auto max-w-4xl space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/settings" className="flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Back to Settings</Link>
      <Button variant="outline" asChild><a href="/api/manual#deployment-operations" target="_blank" rel="noreferrer"><Printer className="mr-2 h-4 w-4" />Print / Save Manual as PDF</a></Button>
    </div>
    <PageHeader title="Deployment & Monitoring Guide" description={`Detailed operator procedures · revised ${guide.revision} · Europe/Nicosia`} />
    <Card><CardContent className="space-y-3 pt-6">
      <p className="text-sm leading-relaxed">{guide.introduction}</p>
      <p className="text-sm font-semibold">Web publishing, independent customer deployment and GitHub/Tauri releases are separate procedures.</p>
    </CardContent></Card>
    <nav aria-label="Deployment guide contents" className="rounded-lg border bg-muted/30 p-5">
      <h2 className="mb-3 font-semibold">Contents</h2>
      <ol className="grid gap-2 text-sm sm:grid-cols-2">
        {sections.map(section => <li key={section.id}><a className="text-primary underline-offset-4 hover:underline" href={`#${section.id}`}>{section.title}</a></li>)}
      </ol>
    </nav>
    {sections.map(section => <Card key={section.id} id={section.id} className="scroll-mt-6">
      <CardHeader><CardTitle className="text-lg">{section.title}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        {(section.paragraphs ?? []).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {section.steps && <ol className="list-decimal space-y-3 pl-6">{section.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
        {section.checklist && <ul className="list-disc space-y-3 pl-6">{section.checklist.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        {(section.commands ?? []).map(command => <Command key={command.label} {...command} />)}
        {section.warning && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><strong>Important:</strong> {section.warning}</div>}
      </CardContent>
    </Card>)}
  </div>;
}