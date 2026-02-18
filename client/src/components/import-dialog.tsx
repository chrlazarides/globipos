import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
};

type ImportResult = {
  success: number;
  errors: { row: number; message: string }[];
};

export function ImportDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  apiEndpoint,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  fields: FieldDef[];
  apiEndpoint: string;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"upload" | "map" | "importing" | "results">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const reset = () => {
    setStep("upload");
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setColumnMap({});
    setResult(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!validTypes.includes(selectedFile.type) && !["xlsx", "xls", "csv"].includes(ext || "")) {
      toast({ title: "Invalid file", description: "Please upload an Excel (.xlsx, .xls) or CSV file", variant: "destructive" });
      return;
    }

    setFile(selectedFile);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (!json.length) {
          toast({ title: "Empty file", description: "The file contains no data rows", variant: "destructive" });
          return;
        }

        const cols = Object.keys(json[0]);
        setHeaders(cols);
        setPreviewRows(json.slice(0, 5));

        const autoMap: Record<string, string> = {};
        for (const field of fields) {
          const match = cols.find(
            (c) =>
              c.toLowerCase() === field.key.toLowerCase() ||
              c.toLowerCase() === field.label.toLowerCase() ||
              c.toLowerCase().replace(/[\s_-]/g, "") === field.key.toLowerCase().replace(/[\s_-]/g, "")
          );
          if (match) autoMap[field.key] = match;
        }
        setColumnMap(autoMap);
        setStep("map");
      } catch {
        toast({ title: "Error reading file", description: "Could not parse the file. Please check the format.", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleImport = async () => {
    if (!file) return;
    setStep("importing");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("columnMap", JSON.stringify(columnMap));

    try {
      const res = await fetch(apiEndpoint, { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Import failed", description: data.message, variant: "destructive" });
        setStep("map");
        return;
      }

      setResult(data);
      setStep("results");

      if (data.success > 0) {
        onSuccess();
      }
    } catch {
      toast({ title: "Import failed", description: "Network error during import", variant: "destructive" });
      setStep("map");
    }
  };

  const requiredFieldsMapped = fields
    .filter((f) => f.required)
    .every((f) => columnMap[f.key]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-import"
            >
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Click to select a file</p>
              <p className="text-xs text-muted-foreground mt-1">Supports .xlsx, .xls, and .csv files</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-import-file"
              />
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium">Expected columns:</p>
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <Badge key={f.key} variant={f.required ? "default" : "secondary"}>
                    {f.label}{f.required ? " *" : ""}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium">{file?.name}</span>
              <Badge variant="secondary">{previewRows.length < 5 ? previewRows.length : "5+"} rows</Badge>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Map your columns to fields:</p>
              {fields.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <div className="w-40 text-sm flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-destructive">*</span>}
                  </div>
                  <Select
                    value={columnMap[field.key] || "__none__"}
                    onValueChange={(v) => setColumnMap((prev) => ({ ...prev, [field.key]: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="flex-1" data-testid={`select-map-${field.key}`}>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">-- Skip --</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {columnMap[field.key] && columnMap[field.key] !== "__none__" && (
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      e.g. {String(previewRows[0]?.[columnMap[field.key]] ?? "").substring(0, 20)}
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            <Card>
              <CardContent className="p-3">
                <p className="text-xs font-medium mb-2 text-muted-foreground">Preview (first row)</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {fields.filter((f) => columnMap[f.key]).map((f) => (
                    <div key={f.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{f.label}:</span>
                      <span className="font-medium truncate">{String(previewRows[0]?.[columnMap[f.key]] ?? "")}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { reset(); }} data-testid="button-import-back">
                Back
              </Button>
              <Button onClick={handleImport} disabled={!requiredFieldsMapped} data-testid="button-start-import">
                Import {previewRows.length < 5 ? previewRows.length : `${previewRows.length}+`} rows
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importing data...</p>
          </div>
        )}

        {step === "results" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {result.success > 0 && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="text-sm font-medium">{result.success} imported successfully</span>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  <span className="text-sm font-medium">{result.errors.length} errors</span>
                </div>
              )}
            </div>

            {result.errors.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs font-medium mb-2 text-muted-foreground">Errors</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-xs">
                        <span className="font-medium">Row {err.row}:</span>{" "}
                        <span className="text-muted-foreground">{err.message}</span>
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button onClick={() => { reset(); onOpenChange(false); }} data-testid="button-import-done">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
