export const generationRatios = new Set(["original", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);

export function referenceIds(value) {
  return [...new Set(Array.isArray(value) ? value.filter(id => typeof id === "string" && id.length > 0 && id.length <= 300) : [])].slice(0, 8);
}

export function generationDraft(value = {}) {
  return {
    prompt: typeof value?.prompt === "string" ? value.prompt.slice(0, 4000) : "",
    ratio: generationRatios.has(value?.ratio) ? value.ratio : "original",
    referenceObjectIds: referenceIds(value?.referenceObjectIds),
    count: Number.isInteger(value?.count) ? Math.min(4, Math.max(1, value.count)) : 1
  };
}
