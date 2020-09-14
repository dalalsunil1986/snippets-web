import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

// Regex for comment which must be included in a file for it to be separated
const RE_SNIPPETS_SEPARATION = /\[SNIPPETS_SEPARATION\s+enabled\]/;

// Regex for comment to control the separator prefix
const RE_SNIPPETS_PREFIX = /\[SNIPPETS_PREFIX\s+([A-Za-z0-9_]+)\]/;

// Regex for [START] and [END] snippet tags.
const RE_START_SNIPPET = /\[START\s+([A-Za-z_]+)\s*\]/;
const RE_END_SNIPPET = /\[END\s+([A-Za-z_]+)\s*\]/;

// Regex for const = require statements
// TODO: Handle multiline imports?
const RE_REQUIRE = /const {(.+?)} = require\((.+?)\)/;

type SnippetsConfig = {
  enabled: boolean;
  prefix: string;
  map: Record<string, string[]>;
};

const DEFAULT_PREFIX = "modular_";

function isBlank(line: string) {
  return line.trim().length === 0;
}

/**
 * Turns a series of source lines into a standalone snippet file by:
 *   - Converting require statements into top-level imports.
 *   - Adjusting indentation to left-align all content
 *   - Removing any blank lines at the starts
 *   - Adding a prefix to snippet names
 *
 * @param lines the lines containing the snippet (including START/END comments)
 * @param sourceFile the source file where the original snippet lives
 * @param snippetPrefix the prefix (such as modular_)
 */
function processSnippet(
  lines: string[],
  sourceFile: string,
  snippetPrefix: string
): string {
  const outputLines: string[] = [];

  for (const line of lines) {
    if (line.match(RE_REQUIRE)) {
      outputLines.push(line.replace(RE_REQUIRE, `import {$1} from $2`));
    } else if (line.match(RE_START_SNIPPET)) {
      outputLines.push(line.replace(RE_START_SNIPPET, `[START ${snippetPrefix}$1]`));
    } else if (line.match(RE_END_SNIPPET)) {
      outputLines.push(
        line.replace(RE_END_SNIPPET, `[END ${snippetPrefix}$1]`)
      );
    } else {
      outputLines.push(line);
    }
  }

  // Adjust indentation of the otherLines so that they're left aligned
  const nonBlankLines = outputLines.filter((l) => !isBlank(l));
  const indentSizes = nonBlankLines.map((l) => l.length - l.trimLeft().length);
  const minIndent = Math.min(...indentSizes);

  const adjustedOutputLines: string[] = [];
  for (const line of outputLines) {
    if (isBlank(line)) {
      adjustedOutputLines.push("");
    } else {
      adjustedOutputLines.push(line.substr(minIndent));
    }
  }

  // Special case: if the first line after the comments is blank we want to remove it
  const firstNonComment = adjustedOutputLines.findIndex(
    (l) => !l.startsWith("//")
  );
  if (isBlank(outputLines[firstNonComment])) {
    adjustedOutputLines.splice(firstNonComment, 1);
  }

  const preambleLines = [
    `// This snippet file was generated by processing the source file:`,
    `// ${sourceFile}`,
    `//`,
    `// To make edits to the snippets in this file, please edit the source`,
    ``,
  ];
  const content = [...preambleLines, ...adjustedOutputLines].join("\n");
  return content;
}

/**
 * Lists all the files in this repository that should be checked for snippets
 */
function listSnippetFiles(): string[] {
  const output = cp
    .execSync(
      'find . -type f -name "*.js" -not -path "*node_modules*" -not -path "./snippets*"'
    )
    .toString();
  return output.split("\n").filter((x) => !isBlank(x));
}

/**
 * Collect all the snippets from a file into a map of snippet name to lines.
 * @param filePath the file path to read.
 */
function collectSnippets(filePath: string): SnippetsConfig {
  const fileContents = fs.readFileSync(filePath).toString();
  const lines = fileContents.split("\n");

  const config: SnippetsConfig = {
    enabled: false,
    prefix: DEFAULT_PREFIX,
    map: {},
  };

  config.enabled = lines.some((l) => !!l.match(RE_SNIPPETS_SEPARATION));
  if (!config.enabled) {
    return config;
  }

  const prefixLine = lines.find((l) => !!l.match(RE_SNIPPETS_PREFIX));
  if (prefixLine) {
    const m = prefixLine.match(RE_SNIPPETS_PREFIX);
    config.prefix = m[1];
  }

  let currSnippetName = "";
  let inSnippet = false;
  for (const line of lines) {
    const startMatch = line.match(RE_START_SNIPPET);
    const endMatch = line.match(RE_END_SNIPPET);

    if (startMatch) {
      inSnippet = true;
      currSnippetName = startMatch[1];
      config.map[currSnippetName] = [];
    }

    if (inSnippet) {
      config.map[currSnippetName].push(line);
    }

    if (endMatch) {
      if (endMatch[1] !== currSnippetName) {
        throw new Error(
          `Snippet ${currSnippetName} in ${filePath} has unmatched START/END tags`
        );
      }
      inSnippet = false;
    }
  }

  return config;
}

async function main() {
  const fileNames = listSnippetFiles();

  for (const filePath of fileNames) {
    const config = collectSnippets(filePath);
    if (!config.enabled) {
      continue;
    }

    const fileSlug = filePath
      .replace(".js", "")
      .replace("./", "")
      .replace(/\./g, "-");
    const snippetDir = path.join("./snippets", fileSlug);

    console.log(
      `Processing: ${filePath} --> ${snippetDir} (prefix=${config.prefix})`
    );

    if (!fs.existsSync(snippetDir)) {
      fs.mkdirSync(snippetDir, { recursive: true });
    }

    for (const snippetName in config.map) {
      const filePath = path.join(snippetDir, `${snippetName}.js`);
      const content = processSnippet(
        config.map[snippetName],
        filePath,
        config.prefix
      );
      fs.writeFileSync(filePath, content);
    }
  }
}

main();
