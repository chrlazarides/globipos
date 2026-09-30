import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isExternalTargetApproved, type FunctionDefinition } from "@/lib/pos-function-config";

type Props = {
  definition: FunctionDefinition;
  standard: boolean;
  saved: boolean;
  compact?: boolean;
};

const verifiedStyle = "!border-emerald-300 !bg-emerald-100 !text-emerald-900";

export function PosFunctionStatus({ definition, standard, saved, compact = false }: Props) {
  const targetPending = !!definition.launch && !isExternalTargetApproved(definition);
  const approved = !!definition.approved && !targetPending;
  const badgeSize = compact ? "h-5 px-1.5 text-[10px]" : "text-xs";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {standard && <Badge variant="outline" className={`${verifiedStyle} ${badgeSize}`}>
        <Check aria-hidden="true" className="mr-0.5 h-3 w-3" />Standard
      </Badge>}
      {approved && <Badge variant="outline" className={`${verifiedStyle} ${badgeSize}`}>
        <Check aria-hidden="true" className="mr-0.5 h-3 w-3" />Approved
      </Badge>}
      {targetPending && <Badge variant="outline" className={`!border-amber-300 !bg-amber-50 !text-amber-900 ${badgeSize}`}>Target pending</Badge>}
      {!approved && saved && <Badge variant="outline" className={badgeSize}>
        {definition.approved ? "Setup approved" : "Draft setup"}
      </Badge>}
      {!standard && !approved && !saved && <Badge variant="outline" className={badgeSize}>Not set</Badge>}
    </div>
  );
}