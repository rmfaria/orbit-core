import fs from 'fs';
import path from 'path';

function tryRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}

function tryStatMtime(p: string): string | null {
  try {
    const st = fs.statSync(p);
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

function resolveGitHead(repoDir: string): string | null {
  const head = tryRead(path.join(repoDir, '.git', 'HEAD'));
  if (!head) return null;
  if (head.startsWith('ref:')) {
    const refPath = head.replace('ref:', '').trim();
    const ref = tryRead(path.join(repoDir, '.git', refPath));
    return ref ? ref.slice(0, 12) : null;
  }
  return head.slice(0, 12);
}

export function getBuildInfo() {
  // In swarm, repo is mounted at /app (read-only).
  const repoDir = process.env.ORBIT_REPO_DIR ?? '/app';

  const git = process.env.GIT_SHA ?? resolveGitHead(repoDir) ?? 'unknown';

  // Best-effort build time: dist entry mtime.
  // (works even without CI injecting env vars)
  const distEntry = path.join(repoDir, 'packages', 'api', 'dist', 'index.js');
  const buildTime = process.env.BUILD_TIME ?? tryStatMtime(distEntry) ?? 'unknown';

  const version = process.env.npm_package_version ?? process.env.ORBIT_VERSION ?? '0.0.0';

  return { version, git, buildTime };
}
