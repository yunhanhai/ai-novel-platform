export interface KeywordSource {
  id: string;
  sourceType: "character" | "world_item" | "plot_thread" | "memory";
  name: string;
  content: string;
  activationKeywords: string[];
  priority: number;
}

export interface ActivationEntry {
  id: string;
  sourceType: string;
  name: string;
  content: string;
  priority: number;
  matchedKeywords: string[];
}

export interface ActivationReport {
  activated: ActivationEntry[];
  totalSourcesChecked: number;
  triggeredBy: string;
}

interface ActivateParams {
  sources: KeywordSource[];
  triggerText: string;
}

export function activateByKeywords({ sources, triggerText }: ActivateParams): ActivationReport {
  const activated: ActivationEntry[] = [];

  for (const source of sources) {
    const matched = source.activationKeywords.filter((kw) => triggerText.includes(kw));
    if (matched.length > 0) {
      activated.push({
        id: source.id,
        sourceType: source.sourceType,
        name: source.name,
        content: source.content,
        priority: source.priority,
        matchedKeywords: matched
      });
    }
  }

  activated.sort((a, b) => b.priority - a.priority);

  return {
    activated,
    totalSourcesChecked: sources.length,
    triggeredBy: triggerText.slice(0, 200)
  };
}
