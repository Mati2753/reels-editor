import { AssetKindSchema, assetRegistry, searchAssets } from "../src/intelligence/assets";

const kindLabels = {
  "3d-object": "3D objects", animation: "Animations", composition: "Compositions", font: "Fonts", icon: "Icons",
  lut: "Color looks", "motion-graphic": "Motion graphics", music: "Music", "sound-effect": "Sound effects",
  "stock-image": "Stock images", "stock-video": "Stock video", "subtitle-style": "Subtitle styles",
  texture: "Textures", transition: "Transitions", "vfx-overlay": "VFX overlays",
};
function preview(asset) {
  const { type, path } = asset.preview;
  const tag = type === "video" || type === "audio" ? type : "img";
  const element = document.createElement(tag);
  const file = type === "font" ? "preview-" + asset.id + ".webp" : path.split("/").at(-1);
  element.src = "./assets/" + file;
  if (tag === "img") {
    element.alt = asset.name;
    element.loading = "lazy";
  } else {
    element.controls = true;
    element.preload = "none";
    element.setAttribute("aria-label", "Preview " + asset.name);
    if (tag === "video") element.playsInline = true;
  }
  return element;
}
export function setupLibrary() {
  const get = (id) => document.getElementById(id);
  const panel = get("asset-library"), query = get("asset-query"), kind = get("asset-kind");
  const list = get("asset-results"), more = get("more-assets");
  let count = 4;
  for (const key of [...AssetKindSchema.options].sort((a, b) => kindLabels[a].localeCompare(kindLabels[b]))) {
    kind.add(new Option(kindLabels[key], key));
  }
  function render() {
    if (!panel.open) return;
    const term = query.value.trim();
    const items = term ? searchAssets({ query: term, kind: kind.value || undefined, limit: 100 }).map((m) => m.asset)
      : assetRegistry.filter((a) => !kind.value || a.kind === kind.value);
    list.replaceChildren();
    get("asset-count").textContent = items.length === 1 ? "1 matching asset" : items.length + " matching assets";
    for (const asset of items.slice(0, count)) {
      const row = document.createElement("article"), heading = document.createElement("h4");
      const desc = document.createElement("p"), support = document.createElement("p"), rights = document.createElement("a");
      heading.textContent = asset.name;
      desc.textContent = asset.description;
      support.textContent = asset.implementations.some((i) => i.engine === "browser") ? "Available in the web editor" : "Available in the native editor";
      rights.textContent = "Usage rights"; rights.href = asset.license.terms; rights.target = "_blank"; rights.rel = "noopener noreferrer";
      row.append(heading, preview(asset), desc, support, rights);
      list.append(row);
    }
    more.hidden = count >= items.length;
  }
  function refresh() { count = 4; render(); }
  query.addEventListener("input", refresh);
  kind.addEventListener("change", refresh);
  panel.addEventListener("toggle", () => panel.open ? refresh() : list.replaceChildren());
  more.addEventListener("click", () => { count += 4; render(); });
}
