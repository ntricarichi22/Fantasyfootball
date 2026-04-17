import { Fragment, type ReactNode } from "react";

/**
 * Tiny markdown renderer for historian responses. Supports:
 *  - **bold**
 *  - `inline code`
 *  - bullet lists ("- " or "* ")
 *  - numbered lists ("1. ")
 *  - paragraphs separated by blank lines
 *
 * The historian backend only returns plain text with light markdown, so we
 * intentionally avoid pulling in a full markdown library.
 */

function renderInline(text: string): ReactNode[] {
  // Split on **bold** and `code`, preserving delimiters.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (!tok) return null;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("`") && tok.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-red-200"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{tok}</Fragment>;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet) {
      if (!current || current.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      current.items.push(bullet[1]);
    } else if (numbered) {
      if (!current || current.kind !== "ol") {
        flush();
        current = { kind: "ol", items: [] };
      }
      current.items.push(numbered[1]);
    } else {
      if (!current || current.kind !== "p") {
        flush();
        current = { kind: "p", lines: [] };
      }
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-100">
      {blocks.map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {renderInline(block.lines.join(" "))}
            </p>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="ml-5 list-disc space-y-1 marker:text-red-400">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="ml-5 list-decimal space-y-1 marker:text-red-400">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
