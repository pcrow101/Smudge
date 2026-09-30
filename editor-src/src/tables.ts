import { WidgetType } from "@codemirror/view";

type Align = "left" | "center" | "right" | null;

/** Splits a GFM table row into trimmed cell strings, honouring `\|` escapes. */
function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignment(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** Renders inline emphasis/code/links within a table cell as plain-enough HTML. */
function renderInlineCell(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Renders a GFM table as a real `<table>` element while the cursor is
 * elsewhere in the document. Moving the cursor into the table (handled by
 * the caller, `livePreview.ts`) removes this widget so the raw pipe syntax
 * can be edited directly — building an editable HTML table is out of scope
 * for this pass.
 */
export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const lines = this.source.split("\n").filter((line) => line.trim().length > 0);
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    if (lines.length < 2) {
      wrap.textContent = this.source;
      return wrap;
    }

    const header = splitRow(lines[0]);
    const aligns = splitRow(lines[1]).map(parseAlignment);
    const body = lines.slice(2).map(splitRow);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    header.forEach((cell, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderInlineCell(cell);
      if (aligns[i]) th.style.textAlign = aligns[i]!;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of body) {
      const tr = document.createElement("tr");
      header.forEach((_, i) => {
        const td = document.createElement("td");
        td.innerHTML = renderInlineCell(row[i] ?? "");
        if (aligns[i]) td.style.textAlign = aligns[i]!;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
