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

/**
 * Schemes a table-cell link may use. Anything else — `javascript:`,
 * `vbscript:`, `data:` — is dropped and the link renders as plain text.
 * Relative and fragment URLs have no scheme and are allowed through.
 */
const SAFE_LINK_SCHEME = /^(?:https?:|mailto:|tel:|#|\/|\.)/i;

function isSafeCellLink(href: string): boolean {
  const trimmed = href.trim();
  // A scheme is everything before the first `:` that isn't preceded by a
  // `/`, `?` or `#`. No scheme at all means a relative URL, which is fine.
  if (!/^[a-z0-9+.-]*:/i.test(trimmed)) return true;
  return SAFE_LINK_SCHEME.test(trimmed);
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
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_whole, label: string, href: string) => {
      // The `&<>` escaping above doesn't cover `"`, so a raw href could
      // otherwise close the attribute and add its own. Quote-encode it, and
      // drop the link entirely if the scheme isn't one we trust.
      if (!isSafeCellLink(href)) return label;
      const safeHref = href.replace(/"/g, "&quot;");
      return `<a href="${safeHref}">${label}</a>`;
    });
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
