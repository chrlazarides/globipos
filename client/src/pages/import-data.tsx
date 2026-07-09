import { useState, useRef, useCallback } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Package,
  Users,
  Truck,
  FolderTree,
  ArrowRight,
  X,
  RefreshCw,
  Check,
  Palette,
  Ruler,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import ExcelJS from "exceljs";

type CellGrid = (string | number | null)[][];

function worksheetTo2DArray(ws: ExcelJS.Worksheet): CellGrid {
  const data: CellGrid = [];
  const colCount = ws.columnCount || 1;
  ws.eachRow({ includeEmpty: true }, (row) => {
    const rowData: (string | number | null)[] = [];
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      let val: any = cell.value;
      if (val === null || val === undefined) {
        rowData.push(null);
      } else if (typeof val === "object" && val !== null && "result" in val) {
        rowData.push((val as any).result ?? null);
      } else if (typeof val === "object" && val !== null && "richText" in val) {
        rowData.push((val as any).richText.map((r: any) => r.text).join(""));
      } else {
        rowData.push(val as string | number);
      }
    }
    data.push(rowData);
  });
  return data;
}

function parseCSVToGrid(text: string): CellGrid {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        result.push(field); field = "";
      } else {
        field += ch;
      }
    }
    result.push(field);
    return result;
  };
  return lines.map(parseRow);
}

type EntityType = "items" | "customers" | "suppliers" | "categories" | "colors" | "sizes" | "skip";

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
};

const ENTITY_CONFIG: Record<Exclude<EntityType, "skip">, { label: string; icon: typeof Package; fields: FieldDef[]; endpoint: string }> = {
  items: {
    label: "Items",
    icon: Package,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "sku", label: "SKU", required: true },
      { key: "barcode", label: "Barcode" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "brand", label: "Brand / Producer" },
      { key: "unitType", label: "Unit Type" },
      { key: "packSize", label: "Pack Size" },
      { key: "price1", label: "Price Level 1" },
      { key: "price2", label: "Price Level 2" },
      { key: "price3", label: "Price Level 3" },
      { key: "price4", label: "Price Level 4" },
      { key: "price5", label: "Price Level 5" },
      { key: "costPrice", label: "Cost Price" },
      { key: "stockQuantity", label: "Stock Qty" },
      { key: "reorderLevel", label: "Reorder Level" },
      { key: "volume", label: "Volume" },
      { key: "alcoholPercentage", label: "Alcohol %" },
      { key: "origin", label: "Origin / Country" },
      { key: "vintage", label: "Vintage" },
    ],
    endpoint: "/api/items/import",
  },
  customers: {
    label: "Customers",
    icon: Users,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "code", label: "Code", required: true },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "taxId", label: "Tax ID" },
      { key: "paymentTerms", label: "Payment Terms" },
      { key: "creditLimit", label: "Credit Limit" },
      { key: "priceLevel", label: "Price Level" },
      { key: "notes", label: "Notes" },
    ],
    endpoint: "/api/customers/import",
  },
  suppliers: {
    label: "Suppliers",
    icon: Truck,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "code", label: "Code", required: true },
      { key: "contactPerson", label: "Contact Person" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "country", label: "Country" },
      { key: "taxId", label: "Tax ID" },
      { key: "paymentTerms", label: "Payment Terms" },
      { key: "notes", label: "Notes" },
    ],
    endpoint: "/api/suppliers/import",
  },
  categories: {
    label: "Categories",
    icon: FolderTree,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "description", label: "Description" },
    ],
    endpoint: "/api/categories/import",
  },
  colors: {
    label: "Colors",
    icon: Palette,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "hexCode", label: "Hex Code" },
    ],
    endpoint: "/api/colors/import",
  },
  sizes: {
    label: "Sizes",
    icon: Ruler,
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "sortOrder", label: "Sort Order" },
    ],
    endpoint: "/api/sizes/import",
  },
};

type SheetAnalysis = {
  sheetName: string;
  headers: string[];
  rows: any[];
  totalRows: number;
  detectedEntity: EntityType;
  columnMap: Record<string, string>;
  confidence: number;
  _preParsedRows?: any[];
  _preParsedInfo?: string;
};

type SheetResult = {
  sheetName: string;
  entity: string;
  success: number;
  errors: { row: number; message: string }[];
};

const WINE_CATEGORY_KEYWORDS = [
  "white", "red", "rose", "rosé", "sparkling", "dessert", "fortified",
  "champagne", "prosecco", "cava", "sweet", "dry", "semi-dry", "semi-sweet",
  "blush", "orange", "natural", "organic", "bio", "spirits", "beer",
  "brandy", "whisky", "whiskey", "vodka", "gin", "rum", "tequila", "liqueur",
  "grappa", "ouzo", "raki", "zivania", "commandaria",
];

function colLetter(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function smartSheetParse(data: CellGrid): { headers: string[]; rows: any[] } {
  if (!data.length) return { headers: [], rows: [] };
  const maxR = data.length - 1;
  const maxC = Math.max(...data.map((r) => r.length), 1) - 1;
  if (maxR < 0 || maxC < 0) return { headers: [], rows: [] };

  const getCellVal = (r: number, c: number): string => {
    const v = data[r]?.[c];
    if (v === null || v === undefined) return "";
    return String(v).trim();
  };

  const HEADER_KEYWORDS = [
    "name", "item", "product", "sku", "code", "barcode", "price", "cost",
    "stock", "qty", "quantity", "category", "brand", "unit", "description",
    "email", "phone", "address", "city", "country", "tax", "notes",
    "volume", "alcohol", "vintage", "origin", "supplier", "customer",
    "type", "variety", "wine", "ref", "date", "total", "vat", "discount",
    "pack", "size", "level", "credit", "terms", "balance",
    "κωδικός", "όνομα", "τιμή", "κόστος", "περιγραφή", "ποσότητα",
  ];

  let headerRowIdx = -1;
  let bestScore = 0;

  for (let r = 0; r <= Math.min(10, maxR); r++) {
    let nonEmpty = 0;
    let hasText = 0;
    let keywordHits = 0;
    let hasNumericOnly = 0;
    for (let c = 0; c <= maxC; c++) {
      const v = getCellVal(r, c);
      if (v) {
        nonEmpty++;
        if (isNaN(Number(v))) {
          hasText++;
          const vLower = v.toLowerCase().replace(/[\s_\-./]/g, "");
          for (const kw of HEADER_KEYWORDS) {
            if (vLower.includes(kw) || kw.includes(vLower)) {
              keywordHits++;
              break;
            }
          }
        } else {
          hasNumericOnly++;
        }
      }
    }
    const score = keywordHits * 10 + nonEmpty * 2 + hasText * 3 - hasNumericOnly * 2;
    if (score > bestScore && nonEmpty >= 2 && hasText >= 1 && keywordHits >= 1) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  const useGenericHeaders = headerRowIdx < 0;
  const dataStartRow = useGenericHeaders ? 0 : headerRowIdx + 1;

  const headers: string[] = [];
  const seen = new Set<string>();
  for (let c = 0; c <= maxC; c++) {
    let hdr: string;
    if (useGenericHeaders) {
      hdr = `Col ${colLetter(c)}`;
    } else {
      hdr = getCellVal(headerRowIdx, c);
      if (!hdr) {
        hdr = `Col ${colLetter(c)}`;
      }
    }
    let unique = hdr;
    let suffix = 1;
    while (seen.has(unique.toLowerCase())) {
      unique = `${hdr}_${suffix++}`;
    }
    seen.add(unique.toLowerCase());
    headers.push(unique);
  }

  const rows: any[] = [];
  for (let r = dataStartRow; r <= maxR; r++) {
    const row: Record<string, any> = {};
    let hasData = false;
    for (let c = 0; c <= maxC; c++) {
      const v = getCellVal(r, c);
      row[headers[c]] = v;
      if (v) hasData = true;
    }
    if (hasData) rows.push(row);
  }

  return { headers, rows };
}

function tryParseWinePriceList(data: CellGrid): { detected: boolean; brand: string; origin: string; rows: any[]; headers: string[] } | null {
  const totalRows = data.length;
  const totalCols = Math.max(...data.map((r) => r.length), 0);
  const maxR = totalRows - 1;
  const maxC = totalCols - 1;

  if (totalRows < 3 || totalCols < 2) return null;

  const getCellVal = (r: number, c: number): string => {
    const v = data[r]?.[c];
    if (v === null || v === undefined) return "";
    return String(v).trim();
  };

  const STANDARD_HEADER_WORDS = [
    "barcode", "sku", "code", "price1", "price2", "costprice", "stockquantity",
    "packsize", "unittype", "reorderlevel", "pricelevel", "creditlimit",
    "paymentterms", "contactperson", "taxid",
  ];
  for (let r = 0; r <= Math.min(3, maxR); r++) {
    let headerHits = 0;
    for (let c = 0; c <= maxC; c++) {
      const v = getCellVal(r, c).toLowerCase().replace(/[\s_\-./]/g, "");
      for (const kw of STANDARD_HEADER_WORDS) {
        if (v === kw || v.includes(kw)) { headerHits++; break; }
      }
    }
    if (headerHits >= 2) return null;
  }

  const firstCell = getCellVal(0, 0);
  if (!firstCell || firstCell.length < 3) return null;

  let brand = firstCell;
  let origin = "";
  const parenMatch = firstCell.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (parenMatch) {
    brand = parenMatch[1].trim();
    const locationParts = parenMatch[2].trim();
    const dashParts = locationParts.split(/\s*[-–]\s*/);
    if (dashParts.length >= 2) {
      origin = dashParts[dashParts.length - 1].trim();
    } else {
      origin = locationParts;
    }
  }

  let costColIdx = -1;
  let retailColIdx = -1;

  for (let r = 0; r <= Math.min(5, maxR); r++) {
    for (let c = 0; c <= maxC; c++) {
      const val = getCellVal(r, c).toLowerCase().replace(/[\s_-]/g, "");
      if (val.includes("cost") || val.includes("κοστ")) costColIdx = c;
      if (val.includes("final") || val.includes("retail") || val.includes("sell") || val.includes("τιμή") || val.includes("price")) {
        if (costColIdx !== c) retailColIdx = c;
      }
    }
  }

  if (costColIdx < 0 && retailColIdx < 0) {
    for (let c = 1; c <= maxC; c++) {
      for (let r = 2; r <= Math.min(8, maxR); r++) {
        const val = getCellVal(r, c);
        const numVal = val.replace(/[€$£,\s]/g, "");
        if (numVal && !isNaN(Number(numVal)) && Number(numVal) > 0) {
          if (costColIdx < 0) {
            costColIdx = c;
          } else if (c > costColIdx && retailColIdx < 0) {
            retailColIdx = c;
          }
          break;
        }
      }
    }
  }

  if (retailColIdx < 0 && costColIdx >= 0) {
    for (let c = costColIdx + 1; c <= maxC; c++) {
      for (let r = 2; r <= Math.min(8, maxR); r++) {
        const val = getCellVal(r, c).replace(/[€$£,\s]/g, "");
        if (val && !isNaN(Number(val)) && Number(val) > 0) {
          retailColIdx = c;
          break;
        }
      }
      if (retailColIdx >= 0) break;
    }
  }

  const flatRows: any[] = [];
  let currentCategory = "";

  for (let r = 1; r <= maxR; r++) {
    const nameVal = getCellVal(r, 0);
    if (!nameVal) continue;

    const nameUpper = nameVal.toUpperCase().trim();
    const nameLower = nameVal.toLowerCase().trim();

    const isCategoryRow = WINE_CATEGORY_KEYWORDS.some((kw) => nameLower === kw) ||
      (nameUpper === nameVal && nameVal.length < 30 && !getCellVal(r, Math.max(costColIdx, 1)));

    if (isCategoryRow) {
      currentCategory = nameVal.charAt(0).toUpperCase() + nameVal.slice(1).toLowerCase();
      continue;
    }

    const costRaw = costColIdx >= 0 ? getCellVal(r, costColIdx).replace(/[€$£,\s]/g, "") : "";
    const retailRaw = retailColIdx >= 0 ? getCellVal(r, retailColIdx).replace(/[€$£,\s]/g, "") : "";

    const costVal = costRaw && !isNaN(Number(costRaw)) ? Number(costRaw) : 0;
    const retailVal = retailRaw && !isNaN(Number(retailRaw)) ? Number(retailRaw) : 0;

    if (costVal === 0 && retailVal === 0 && !currentCategory) continue;
    if (costVal === 0 && retailVal === 0) continue;

    let itemName = nameVal;
    let vintage = "";
    const vintageMatch = nameVal.match(/\b(19|20)\d{2}\b/);
    if (vintageMatch) {
      vintage = vintageMatch[0];
    }

    const skuBase = brand.substring(0, 3).toUpperCase() + "-" + itemName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8).toUpperCase();
    const skuSuffix = String(flatRows.length + 1).padStart(3, "0");

    flatRows.push({
      name: itemName,
      sku: skuBase + "-" + skuSuffix,
      brand: brand,
      origin: origin,
      category: currentCategory,
      costPrice: costVal.toFixed(2),
      price1: retailVal > 0 ? retailVal.toFixed(2) : "0",
      vintage: vintage,
    });
  }

  if (flatRows.length < 1) return null;

  const headers = ["name", "sku", "brand", "origin", "category", "costPrice", "price1", "vintage"];

  return { detected: true, brand, origin, rows: flatRows, headers };
}

function detectEntity(headers: string[]): { entity: EntityType; confidence: number } {
  const lowerHeaders = headers.map((h) => h.toLowerCase().replace(/[\s_-]/g, ""));

  const scores: Record<Exclude<EntityType, "skip">, number> = { items: 0, customers: 0, suppliers: 0, categories: 0, colors: 0, sizes: 0 };

  const itemKeywords = ["sku", "barcode", "price", "price1", "price2", "costprice", "stockquantity", "stock", "packsize", "unittype", "volume", "alcohol", "vintage", "origin", "brand", "reorderlevel"];
  const customerKeywords = ["customer", "creditlimit", "pricelevel", "paymentterms", "taxid", "portalaccess"];
  const supplierKeywords = ["supplier", "contactperson", "country"];
  const categoryKeywords = ["category", "parentid"];

  for (const h of lowerHeaders) {
    for (const kw of itemKeywords) if (h.includes(kw)) scores.items += 2;
    for (const kw of customerKeywords) if (h.includes(kw)) scores.customers += 2;
    for (const kw of supplierKeywords) if (h.includes(kw)) scores.suppliers += 2;
    for (const kw of categoryKeywords) if (h.includes(kw)) scores.categories += 2;
  }

  if (lowerHeaders.includes("sku") || lowerHeaders.includes("barcode")) scores.items += 5;
  if (lowerHeaders.includes("pricelevel") || lowerHeaders.includes("creditlimit")) scores.customers += 5;
  if (lowerHeaders.includes("contactperson") || lowerHeaders.includes("supplier")) scores.suppliers += 5;

  const entries = Object.entries(scores) as [Exclude<EntityType, "skip">, number][];
  entries.sort((a, b) => b[1] - a[1]);

  if (entries[0][1] === 0) {
    if (lowerHeaders.includes("name") && lowerHeaders.length <= 3) {
      return { entity: "categories", confidence: 40 };
    }
    return { entity: "items", confidence: 10 };
  }

  const maxScore = entries[0][1];
  const totalPossible = Math.max(maxScore * 2, 20);
  const confidence = Math.min(Math.round((maxScore / totalPossible) * 100), 95);

  return { entity: entries[0][0], confidence };
}

const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["name", "item", "product", "wine", "title", "label", "article", "προϊόν", "όνομα", "περιγραφή", "description", "desc", "item name", "product name", "wine name"],
  sku: ["sku", "code", "item code", "product code", "article", "artno", "art no", "κωδικός", "ref", "reference", "itemno", "item no", "partno", "part no", "id"],
  description: ["description", "desc", "details", "info", "notes", "περιγραφή", "name", "item", "product", "wine", "title", "label"],
  barcode: ["barcode", "ean", "upc", "gtin", "bar code"],
  category: ["category", "cat", "type", "group", "κατηγορία", "wine type"],
  brand: ["brand", "producer", "winery", "maker", "supplier", "οινοποιείο", "παραγωγός", "house"],
  unitType: ["unit", "unit type", "uom", "measure"],
  packSize: ["pack", "pack size", "packing", "case", "case size", "btl", "bottles"],
  price1: ["price", "price1", "retail", "sell", "selling", "τιμή", "final", "rrp", "sale price"],
  price2: ["price2", "wholesale", "trade"],
  price3: ["price3"],
  price4: ["price4"],
  price5: ["price5"],
  costPrice: ["cost", "cost price", "buy", "buying", "purchase", "κόστος", "net", "buy price"],
  stockQuantity: ["stock", "qty", "quantity", "on hand", "inventory", "απόθεμα"],
  volume: ["volume", "ml", "cl", "lt", "liter", "litre", "size", "όγκος", "capacity"],
  alcoholPercentage: ["alcohol", "abv", "alc", "%", "vol", "αλκοόλ"],
  origin: ["origin", "country", "region", "χώρα", "provenance", "appellation"],
  vintage: ["vintage", "year", "έτος", "harvest"],
};

function autoMapColumns(headers: string[], fields: FieldDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  for (const field of fields) {
    const synonyms = FIELD_SYNONYMS[field.key] || [];
    const match = headers.find((h) => {
      if (usedHeaders.has(h)) return false;
      const hNorm = h.toLowerCase().replace(/[\s_\-./]/g, "");
      const fKeyNorm = field.key.toLowerCase().replace(/[\s_-]/g, "");
      const fLabelNorm = field.label.toLowerCase().replace(/[\s_-]/g, "");
      if (hNorm === fKeyNorm || hNorm === fLabelNorm) return true;
      if (hNorm.includes(fKeyNorm) || fKeyNorm.includes(hNorm)) return true;
      for (const syn of synonyms) {
        const synNorm = syn.toLowerCase().replace(/[\s_-]/g, "");
        if (hNorm === synNorm || hNorm.includes(synNorm) || synNorm.includes(hNorm)) return true;
      }
      return false;
    });
    if (match) {
      map[field.key] = match;
      usedHeaders.add(match);
    }
  }
  return map;
}

function getEntityIcon(entity: EntityType) {
  if (entity === "skip") return X;
  return ENTITY_CONFIG[entity].icon;
}

function getEntityLabel(entity: EntityType) {
  if (entity === "skip") return "Skip";
  return ENTITY_CONFIG[entity].label;
}

export default function ImportData() {
  const [step, setStep] = useState<"upload" | "analyze" | "verify" | "importing" | "results">("upload");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetAnalysis[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [importResults, setImportResults] = useState<SheetResult[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const reset = () => {
    setStep("upload");
    setFileName("");
    setSheets([]);
    setActiveSheet("");
    setImportResults([]);
    setImportProgress(0);
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast({ title: "Invalid file", description: "Please upload an Excel (.xlsx, .xls) or CSV file", variant: "destructive" });
      return;
    }

    setFileName(selectedFile.name);
    setStep("analyze");

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer;

        let sheetList: { name: string; grid: CellGrid }[];

        if (ext === "csv") {
          const text = new TextDecoder().decode(buffer);
          sheetList = [{ name: "Sheet1", grid: parseCSVToGrid(text) }];
        } else {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          sheetList = workbook.worksheets.map((ws) => ({
            name: ws.name,
            grid: worksheetTo2DArray(ws),
          }));
        }

        const analyzed: SheetAnalysis[] = sheetList.map(({ name, grid }) => {
          const wineParsed = tryParseWinePriceList(grid);
          if (wineParsed && wineParsed.rows.length > 0) {
            const fields = ENTITY_CONFIG.items.fields;
            const columnMap = autoMapColumns(wineParsed.headers, fields);
            return {
              sheetName: name,
              headers: wineParsed.headers,
              rows: wineParsed.rows.slice(0, 10),
              totalRows: wineParsed.rows.length,
              detectedEntity: "items" as EntityType,
              columnMap,
              confidence: 90,
              _preParsedRows: wineParsed.rows,
              _preParsedInfo: `Detected wine price list: ${wineParsed.brand} (${wineParsed.origin})`,
            };
          }

          const parsed = smartSheetParse(grid);
          const { entity, confidence } = detectEntity(parsed.headers);
          const config = entity !== "skip" ? ENTITY_CONFIG[entity] : null;
          const columnMap = config ? autoMapColumns(parsed.headers, config.fields) : {};

          return {
            sheetName: name,
            headers: parsed.headers,
            rows: parsed.rows.slice(0, 10),
            totalRows: parsed.rows.length,
            detectedEntity: entity,
            columnMap,
            confidence,
          };
        }).filter((s) => s.totalRows > 0);

        if (!analyzed.length) {
          toast({ title: "No data", description: "The file contains no data rows", variant: "destructive" });
          setStep("upload");
          return;
        }

        setSheets(analyzed);
        setActiveSheet(analyzed[0].sheetName);
        setStep("verify");
      } catch {
        toast({ title: "Error reading file", description: "Could not parse the file", variant: "destructive" });
        setStep("upload");
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  }, [toast]);

  const updateSheetEntity = (sheetName: string, entity: EntityType) => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.sheetName !== sheetName) return s;
        const config = entity !== "skip" ? ENTITY_CONFIG[entity] : null;
        const columnMap = config ? autoMapColumns(s.headers, config.fields) : {};
        return { ...s, detectedEntity: entity, columnMap, confidence: entity === "skip" ? 0 : 100 };
      })
    );
  };

  const updateColumnMap = (sheetName: string, fieldKey: string, headerCol: string) => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.sheetName !== sheetName) return s;
        const newMap = { ...s.columnMap };
        if (headerCol !== "skip" && headerCol !== "") {
          for (const [k, v] of Object.entries(newMap)) {
            if (v === headerCol && k !== fieldKey) {
              newMap[k] = "";
            }
          }
        }
        newMap[fieldKey] = headerCol === "skip" ? "" : headerCol;
        return { ...s, columnMap: newMap };
      })
    );
  };

  const sheetsToImport = sheets.filter((s) => s.detectedEntity !== "skip");

  const handleImport = async () => {
    setStep("importing");
    setImportProgress(0);
    const results: SheetResult[] = [];

    for (let i = 0; i < sheetsToImport.length; i++) {
      const sheet = sheetsToImport[i];
      const config = ENTITY_CONFIG[sheet.detectedEntity as Exclude<EntityType, "skip">];

      try {
        const cleanedMap: Record<string, string> = {};
        for (const [key, val] of Object.entries(sheet.columnMap)) {
          if (val && val !== "skip") cleanedMap[key] = val;
        }

        let res: Response;

        if (sheet._preParsedRows) {
          res = await fetch(config.endpoint + "/json", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: sheet._preParsedRows }),
          });
        } else {
          if (!fileInputRef.current?.files?.[0]) throw new Error("File not available");
          const formData = new FormData();
          formData.append("file", fileInputRef.current.files[0]);
          formData.append("columnMap", JSON.stringify(cleanedMap));
          formData.append("sheetName", sheet.sheetName);
          res = await fetch(config.endpoint, { method: "POST", body: formData });
        }

        const data = await res.json();

        results.push({
          sheetName: sheet.sheetName,
          entity: config.label,
          success: data.success || 0,
          errors: data.errors || [],
        });
      } catch (err: any) {
        results.push({
          sheetName: sheet.sheetName,
          entity: config.label,
          success: 0,
          errors: [{ row: 0, message: err.message || "Import failed" }],
        });
      }
      setImportProgress(Math.round(((i + 1) / sheetsToImport.length) * 100));
    }

    setImportResults(results);
    setStep("results");

    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    queryClient.invalidateQueries({ queryKey: ["/api/colors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sizes"] });
  };

  const totalSuccess = importResults.reduce((sum, r) => sum + r.success, 0);
  const totalErrors = importResults.reduce((sum, r) => sum + r.errors.length, 0);

  const currentSheet = sheets.find((s) => s.sheetName === activeSheet);

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Import Data" description="Upload an Excel file to bulk import items, customers, suppliers, and categories" />

      {step === "upload" && (
        <Card>
          <CardContent className="p-8">
            <div
              className="border-2 border-dashed rounded-md p-12 text-center cursor-pointer hover-elevate"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-smart-import"
            >
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Drop your Excel file here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-2">
                Supports .xlsx, .xls, and .csv files with multiple sheets
              </p>
              <p className="text-xs text-muted-foreground mt-4">
                Each sheet will be automatically detected as Items, Customers, Suppliers, or Categories
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-smart-import-file"
              />
            </div>

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.entries(ENTITY_CONFIG) as [Exclude<EntityType, "skip">, typeof ENTITY_CONFIG["items"]][]).map(([key, config]) => (
                <div key={key} className="flex items-center gap-2 p-3 rounded-md border text-sm">
                  <config.icon className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{config.fields.filter((f) => f.required).map((f) => f.label).join(", ")} required</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "analyze" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analyzing Excel file...</p>
          </CardContent>
        </Card>
      )}

      {step === "verify" && currentSheet && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">{fileName}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sheets.length} sheet{sheets.length !== 1 ? "s" : ""} detected with data
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={reset} data-testid="button-import-change-file">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Change File
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={sheetsToImport.length === 0}
                    data-testid="button-confirm-import"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Confirm & Import {sheetsToImport.length} Sheet{sheetsToImport.length !== 1 ? "s" : ""}
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {sheets.map((s) => {
              const EntityIcon = getEntityIcon(s.detectedEntity);
              const isActive = s.sheetName === activeSheet;
              return (
                <Card
                  key={s.sheetName}
                  className={`cursor-pointer transition-colors ${isActive ? "ring-2 ring-primary" : ""} ${s.detectedEntity === "skip" ? "opacity-50" : ""}`}
                  onClick={() => setActiveSheet(s.sheetName)}
                  data-testid={`card-sheet-${s.sheetName}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" title={s.sheetName}>{s.sheetName}</p>
                        <p className="text-xs text-muted-foreground">{s.totalRows} rows</p>
                        {s._preParsedInfo && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={s._preParsedInfo}>{s._preParsedInfo}</p>
                        )}
                      </div>
                      <EntityIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-2">
                      <Select
                        value={s.detectedEntity}
                        onValueChange={(v) => updateSheetEntity(s.sheetName, v as EntityType)}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid={`select-entity-${s.sheetName}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="items">Items</SelectItem>
                          <SelectItem value="customers">Customers</SelectItem>
                          <SelectItem value="suppliers">Suppliers</SelectItem>
                          <SelectItem value="categories">Categories</SelectItem>
                          <SelectItem value="colors">Colors</SelectItem>
                          <SelectItem value="sizes">Sizes</SelectItem>
                          <SelectItem value="skip">Skip this sheet</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {s.detectedEntity !== "skip" && (
                      <div className="mt-2 flex items-center gap-1">
                        <Badge variant={s.confidence >= 60 ? "default" : "secondary"} className="text-xs">
                          {s.confidence}% match
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {Object.keys(s.columnMap).filter((k) => s.columnMap[k]).length} mapped
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {currentSheet.detectedEntity !== "skip" && (
            <Tabs defaultValue="mapping" className="space-y-4">
              <TabsList>
                <TabsTrigger value="mapping" data-testid="tab-mapping">Column Mapping</TabsTrigger>
                <TabsTrigger value="preview" data-testid="tab-preview">Data Preview</TabsTrigger>
                <TabsTrigger value="raw" data-testid="tab-raw">Raw Data</TabsTrigger>
              </TabsList>

              <TabsContent value="mapping">
                <div className="space-y-4">
                  {(() => {
                    const config = ENTITY_CONFIG[currentSheet.detectedEntity as Exclude<EntityType, "skip">];
                    const reverseMap: Record<string, string> = {};
                    for (const [fieldKey, headerCol] of Object.entries(currentSheet.columnMap)) {
                      if (headerCol && headerCol !== "skip") reverseMap[headerCol] = fieldKey;
                    }
                    const usedFields = new Set(
                      Object.entries(currentSheet.columnMap)
                        .filter(([, v]) => v && v !== "skip")
                        .map(([k]) => k)
                    );
                    const mappedCount = Object.values(currentSheet.columnMap).filter((v) => v && v !== "skip").length;
                    const requiredFields = config.fields.filter((f) => f.required);
                    const missingRequired = requiredFields.filter((f) => !currentSheet.columnMap[f.key]);

                    return (
                      <>
                        <Card>
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm">
                                Map Your Columns to {getEntityLabel(currentSheet.detectedEntity)} Fields
                              </CardTitle>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {mappedCount} of {currentSheet.headers.length} columns mapped
                                </Badge>
                                {missingRequired.length > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    Missing: {missingRequired.map((f) => f.label).join(", ")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                        </Card>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {currentSheet.headers.map((h, colIdx) => {
                            const mappedField = reverseMap[h];
                            const fieldDef = mappedField ? config.fields.find((f) => f.key === mappedField) : null;
                            const samples = currentSheet.rows.slice(0, 5).map((row) => String(row[h] ?? "")).filter((v) => v);

                            return (
                              <Card
                                key={h}
                                className={`transition-colors ${mappedField ? "ring-1 ring-primary bg-primary/5" : ""}`}
                                data-testid={`card-column-${colIdx}`}
                              >
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold truncate" title={h}>{h}</p>
                                      <p className="text-xs text-muted-foreground">Column {colLetter(colIdx)}</p>
                                    </div>
                                    {mappedField && (
                                      <Badge variant="default" className="text-xs flex-shrink-0">
                                        {fieldDef?.label}
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="bg-muted/50 rounded p-2 space-y-0.5 min-h-[60px]">
                                    {samples.length > 0 ? samples.map((s, i) => (
                                      <p key={i} className="text-xs truncate text-muted-foreground" title={s}>
                                        {s}
                                      </p>
                                    )) : (
                                      <p className="text-xs text-muted-foreground italic">No data</p>
                                    )}
                                  </div>

                                  <Select
                                    value={mappedField || "__unmapped__"}
                                    onValueChange={(fieldKey) => {
                                      if (reverseMap[h]) {
                                        updateColumnMap(currentSheet.sheetName, reverseMap[h], "skip");
                                      }
                                      if (fieldKey !== "__unmapped__") {
                                        updateColumnMap(currentSheet.sheetName, fieldKey, h);
                                      }
                                    }}
                                  >
                                    <SelectTrigger
                                      className={`text-sm ${mappedField ? "border-primary" : ""}`}
                                      data-testid={`select-map-col-${colIdx}`}
                                    >
                                      <SelectValue placeholder="-- Not mapped --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__unmapped__">-- Not mapped (skip) --</SelectItem>
                                      {config.fields.map((f) => (
                                        <SelectItem
                                          key={f.key}
                                          value={f.key}
                                          disabled={usedFields.has(f.key) && reverseMap[h] !== f.key}
                                        >
                                          {f.label}{f.required ? " *" : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </TabsContent>

              <TabsContent value="preview">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Mapped Preview - First {Math.min(currentSheet.rows.length, 5)} of {currentSheet.totalRows} rows
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const config = ENTITY_CONFIG[currentSheet.detectedEntity as Exclude<EntityType, "skip">];
                      const mappedFields = config.fields.filter((f) => currentSheet.columnMap[f.key]);
                      if (!mappedFields.length) {
                        return <p className="text-sm text-muted-foreground text-center py-4">No columns mapped yet. Go to Column Mapping to set up mappings.</p>;
                      }
                      return (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-10">#</TableHead>
                                {mappedFields.map((f) => (
                                  <TableHead key={f.key} className="text-xs whitespace-nowrap">{f.label}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {currentSheet.rows.slice(0, 5).map((row, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                                  {mappedFields.map((f) => (
                                    <TableCell key={f.key} className="text-xs max-w-[200px] truncate">
                                      {String(row[currentSheet.columnMap[f.key]] ?? "")}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="raw">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Raw Excel Data - "{currentSheet.sheetName}" ({currentSheet.headers.length} columns, {currentSheet.totalRows} rows)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">#</TableHead>
                            {currentSheet.headers.map((h) => (
                              <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentSheet.rows.slice(0, 10).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                              {currentSheet.headers.map((h) => (
                                <TableCell key={h} className="text-xs max-w-[150px] truncate">
                                  {String(row[h] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}

          {currentSheet.detectedEntity === "skip" && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-8">
                <X className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">This sheet will be skipped during import</p>
                <p className="text-xs text-muted-foreground">Change the entity type above to include it</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm font-medium">Importing data...</p>
            <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${importProgress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {importProgress}% complete - processing {sheetsToImport.length} sheet{sheetsToImport.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      )}

      {step === "results" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Import Complete</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 flex-wrap">
                {totalSuccess > 0 && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium">{totalSuccess} records imported successfully</span>
                  </div>
                )}
                {totalErrors > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    <span className="text-sm font-medium">{totalErrors} errors</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {importResults.map((result) => (
            <Card key={result.sheetName}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    {result.sheetName}
                    <Badge variant="secondary">{result.entity}</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {result.success > 0 && <Badge>{result.success} imported</Badge>}
                    {result.errors.length > 0 && (
                      <Badge variant="destructive">{result.errors.length} error{result.errors.length !== 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              {result.errors.length > 0 && (
                <CardContent className="pt-0">
                  <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
                    {result.errors.map((err, i) => (
                      <p key={i}>
                        <span className="font-medium">Row {err.row}:</span>{" "}
                        <span className="text-muted-foreground">{err.message}</span>
                      </p>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}

          <div className="flex justify-end">
            <Button onClick={reset} data-testid="button-import-again">
              Import Another File
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
