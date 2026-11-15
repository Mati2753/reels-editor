/** A problem found in an EDL. Errors block preview and render; warnings are reported. */
export interface Issue {
  severity: "error" | "warning";
  /** Short rule name, stable, for tests and for the director ("anchor-cut-word"). */
  rule: string;
  /** Where in edl.json ("segments[2].out"). */
  path: string;
  message: string;
}

export class IssueList {
  readonly items: Issue[] = [];

  error(rule: string, path: string, message: string): void {
    this.items.push({ severity: "error", rule, path, message });
  }

  warn(rule: string, path: string, message: string): void {
    this.items.push({ severity: "warning", rule, path, message });
  }

  get errors(): Issue[] {
    return this.items.filter((i) => i.severity === "error");
  }

  get warnings(): Issue[] {
    return this.items.filter((i) => i.severity === "warning");
  }
}
