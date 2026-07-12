import { readFile, writeFile } from "node:fs/promises";

const token = process.env.GH_TOKEN;
const username = process.env.GITHUB_USERNAME;
const svgPath = process.env.STATS_SVG_PATH || "profile/stats.svg";
const graphqlEndpoint =
  process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";

if (!token) {
  throw new Error(
    "GH_TOKEN is required. Use a classic PAT with repo and read:user scopes.",
  );
}

if (!username) {
  throw new Error("GITHUB_USERNAME is required.");
}

const query = `
  query UserContributions($login: String!) {
    user(login: $login) {
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  }
`;

const response = await fetch(graphqlEndpoint, {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query,
    variables: { login: username },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(
    `GitHub GraphQL request failed: ${payload.errors
      .map((error) => error.message)
      .join("; ")}`,
  );
}

const contributions = payload.data?.user?.contributionsCollection;
if (!contributions) {
  throw new Error("GitHub GraphQL response did not contain contributions.");
}

const publicCommits = contributions.totalCommitContributions;
const restrictedContributions = contributions.restrictedContributionsCount;
const totalCommits = publicCommits + restrictedContributions;

if (
  !Number.isInteger(publicCommits) ||
  !Number.isInteger(restrictedContributions) ||
  !Number.isInteger(totalCommits)
) {
  throw new Error("GitHub GraphQL response contained an invalid commit count.");
}

let svg = await readFile(svgPath, "utf8");
const commitValuePatterns = [
  /(<text[^>]*data-testid=["']commits["'][^>]*>\s*)[^<]*(\s*<\/text>)/,
  /(<text[^>]*>\s*Total Commits\s+\(last year\)\s*:\s*<\/text>\s*<text[^>]*>\s*)[^<]*(\s*<\/text>)/,
];

let updatedSvg = svg;
for (const pattern of commitValuePatterns) {
  updatedSvg = svg.replace(pattern, `$1${totalCommits}$2`);
  if (updatedSvg !== svg) {
    break;
  }
}

if (updatedSvg === svg) {
  const commitLabel = "Total Commits (last year):";
  let searchFrom = 0;
  let labelEnd = -1;
  while (true) {
    const labelIndex = svg.indexOf(commitLabel, searchFrom);
    if (labelIndex < 0) {
      break;
    }

    const candidateEnd = svg.indexOf("</text>", labelIndex);
    if (candidateEnd >= 0 && candidateEnd - labelIndex < 200) {
      labelEnd = candidateEnd + "</text>".length;
      break;
    }
    searchFrom = labelIndex + commitLabel.length;
  }

  if (labelEnd >= 0) {
    const valueMatch = svg
      .slice(labelEnd)
      .match(/<text\b[^>]*>\s*[0-9][0-9,.]*[kKmM]?\s*<\/text>/);
    if (valueMatch?.index !== undefined) {
      const valueOffset = labelEnd + valueMatch.index;
      const valueNode = valueMatch[0];
      const openEnd = valueNode.indexOf(">");
      const closeStart = valueNode.lastIndexOf("</text>");
      const inner = valueNode.slice(openEnd + 1, closeStart);
      const leadingWhitespace = inner.match(/^\s*/)?.[0] || "";
      const trailingWhitespace = inner.match(/\s*$/)?.[0] || "";
      const replacedNode =
        valueNode.slice(0, openEnd + 1) +
        leadingWhitespace +
        totalCommits +
        trailingWhitespace +
        valueNode.slice(closeStart);
      updatedSvg =
        svg.slice(0, valueOffset) +
        replacedNode +
        svg.slice(valueOffset + valueNode.length);
    }
  }
}

if (updatedSvg === svg) {
  const cardText = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ");
  throw new Error(
    `Stats action did not generate a normal stats card${
      cardText ? `: ${cardText}` : "."
    }`,
  );
}

svg = updatedSvg;
const descriptionPattern = /(Total Commits\s+\(last year\)\s*:\s*)\d+/;
if (descriptionPattern.test(svg)) {
  svg = svg.replace(descriptionPattern, `$1${totalCommits}`);
}

await writeFile(svgPath, svg, "utf8");
console.log(
  `Included restricted contributions: ${restrictedContributions}. Total commits: ${totalCommits}`,
);
