import fs from "fs";
import path from "path";
import { Octokit } from "@octokit/rest";

export function createGithubClient(env) {
  if (!env.GITHUB_TOKEN) return null;
  return new Octokit({ auth: env.GITHUB_TOKEN });
}

export async function uploadAssetToLatestRelease({ env, filePath, tagName = "mods-latest" }) {
  const client = createGithubClient(env);
  if (!client) {
    throw new Error("GITHUB_TOKEN is missing");
  }

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const fileName = path.basename(filePath);
  const data = fs.readFileSync(filePath);

  let release;
  try {
    const { data: found } = await client.repos.getReleaseByTag({ owner, repo, tag: tagName });
    release = found;
  } catch {
    const { data: created } = await client.repos.createRelease({
      owner,
      repo,
      tag_name: tagName,
      name: tagName,
      draft: false,
      prerelease: false
    });
    release = created;
  }

  const uploadUrl = release.upload_url.replace("{?name,label}", "");
  const uploaded = await client.request({
    method: "POST",
    url: uploadUrl,
    headers: {
      "content-type": "application/zip",
      "content-length": data.length
    },
    data,
    name: fileName
  });

  return uploaded.data.browser_download_url;
}
