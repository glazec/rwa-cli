export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatCurrency(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatCompactCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatPercent(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${formatNumber(value, digits)}%`;
}

export function formatSignedPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  const numeric = Number(value);
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${formatNumber(numeric, digits)}%`;
}

export function printTable(rows, columns) {
  const widths = columns.map((column) => {
    const headerWidth = column.label.length;
    const cellWidth = Math.max(
      0,
      ...rows.map((row) => String(column.value(row)).length)
    );
    return Math.min(column.maxWidth ?? Infinity, Math.max(headerWidth, cellWidth));
  });

  const renderCell = (value, width) => {
    const text = String(value);
    if (text.length <= width) {
      return text.padEnd(width, " ");
    }

    return `${text.slice(0, Math.max(0, width - 1))}\u2026`;
  };

  const lines = [];

  lines.push(
    columns.map((column, index) => renderCell(column.label, widths[index])).join("  ")
  );
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));

  for (const row of rows) {
    lines.push(
      columns
        .map((column, index) => renderCell(column.value(row), widths[index]))
        .join("  ")
    );
  }

  console.log(lines.join("\n"));
}
