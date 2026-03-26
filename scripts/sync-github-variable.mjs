#!/usr/bin/env node
const token = process.env.GITHUB_VARIABLES_TOKEN || '';
const repo = process.env.TARGET_REPO || '';
const name = process.env.VARIABLE_NAME || '';
const value = process.env.VARIABLE_VALUE || '';

if (!token || !repo || !name) {
  console.error('Missing GITHUB_VARIABLES_TOKEN, TARGET_REPO, or VARIABLE_NAME');
  process.exit(1);
}

const [owner, repoName] = repo.split('/');
if (!owner || !repoName) {
  console.error(`Invalid TARGET_REPO: ${repo}`);
  process.exit(1);
}

const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/variables/${encodeURIComponent(name)}`, {
  method: 'PATCH',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name, value }),
});

if (response.status === 404) {
  const createResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/variables`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, value }),
  });

  if (!createResponse.ok) {
    console.error(await createResponse.text());
    process.exit(1);
  }

  console.log(`Created ${name} in ${repo}`);
  process.exit(0);
}

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

console.log(`Updated ${name} in ${repo}`);
