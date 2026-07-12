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
  const textNodes = [...svg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)];
  const normalizeText = (node) =>
    node[0]
      .replace(/^<text\b[^>]*>/, "")
      .replace(/<\/text>$/, "")
      .replace(/\s+/g, " ")
      .trim();
  const labelIndex = textNodes.findIndex(
    (node) => normalizeText(node) === "Total Commits (last year):",
  );
  const valueNode = textNodes[labelIndex + 1];

  if (labelIndex >= 0 && valueNode) {
    const replacedNode = valueNode[0].replace(
      /(>\s*)[^<]*(\s*<\/text>)$/,
      `$1${totalCommits}$2`,
    );
    updatedSvg =
      svg.slice(0, valueNode.index) +
      replacedNode +
      svg.slice(valueNode.index + valueNode[0].length);
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
