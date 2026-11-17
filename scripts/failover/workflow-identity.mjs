import assert from 'node:assert/strict';

// Dependency-free so the privileged installer can run without npm lifecycle code.
export function assertFailoverWorkflow(env) {
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.GITHUB_REPOSITORY,'ntricarichi22/Fantasyfootball');
  assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
  assert.match(env.GITHUB_SHA ?? '',/^[a-f0-9]{40}$/);
}
