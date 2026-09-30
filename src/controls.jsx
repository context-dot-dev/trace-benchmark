import { Badge } from "@/components/ui/badge";
import { color, human, json, safeUrl } from "./model";

export function Swatch({ provider }) {
  return <span className="swatch" aria-hidden="true" style={{ "--provider": color(provider) }} />;
}

export function statusLabel(r) {
  if (r.success === null) return "Unresolved";
  if (r.success === true) return "Useful content";
  if (r.outcome === "returned") return r.identity_label === "wrong_target" ? "Wrong target" : r.content_label === "thin" ? "Too little content" : human(r.content_label || "Not useful");
  return human(r.outcome || "Not useful");
}

export function Outcome({ record }) {
  return <Badge variant={record.success === true ? "secondary" : record.success === false ? "destructive" : "outline"}>{statusLabel(record)}</Badge>;
}

export function Json({ value }) { return <pre className="receipt-json">{json(value)}</pre>; }
export function SourceLink({ url }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{url} ↗</a> : <>{url || "Unavailable"}</>;
}
