const extensions = { exa: "svg", tavily: "svg", tinyfish: "svg", you: "svg" };

export function ProviderLogo({ id }) {
  return <img className="provider-logo" src={`./logos/${id}.${extensions[id] || "png"}`} alt="" width="22" height="22" />;
}
