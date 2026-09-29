jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

const { Octokit } = require('@octokit/rest');
const { GitHubRepository } = require('../../lib/helpers/github');

function createFakeOctokit() {
  const endpoints = {
    pulls: ['list', 'get', 'create', 'update', 'merge', 'requestReviewers', 'createReview', 'listReviews'],
    repos: ['getCombinedStatusForRef'],
  };

  const rest = {};
  for (const [scope, methods] of Object.entries(endpoints)) {
    rest[scope] = {};
    for (const method of methods) {
      rest[scope][method] = jest.fn(async () => ({ data: `${scope}.${method}-data` }));
    }
  }

  return { rest, paginate: jest.fn(async () => ['page-1-item', 'page-2-item']), graphql: jest.fn(async () => ({})) };
}

function createHttpError(message, data) {
  const err = new Error(message);
  err.status = 422;
  err.response = { status: 422, data };
  return err;
}

describe('GitHubRepository', () => {
  let octokit;
  let ghRepo;
  beforeEach(() => {
    octokit = createFakeOctokit();
    ghRepo = new GitHubRepository('foo-owner', 'repo-84', octokit);
  });

  it('should expose the owner and the repository name', () => {
    expect(ghRepo.owner).toBe('foo-owner');
    expect(ghRepo.repo).toBe('repo-84');
  });

  [
    {
      call: (r) => r.listPullRequests({ state: 'open', head: 'foo-owner:foo-branch' }),
      endpoint: ['pulls', 'list'],
      params: { state: 'open', head: 'foo-owner:foo-branch' },
    },
    { call: (r) => r.getPullRequest(42), endpoint: ['pulls', 'get'], params: { pull_number: 42 } },
    {
      call: (r) => r.createPullRequest({ title: 't', body: '', head: 'foo-branch', base: 'main', draft: true }),
      endpoint: ['pulls', 'create'],
      params: { title: 't', body: '', head: 'foo-branch', base: 'main', draft: true },
    },
    {
      call: (r) => r.updatePullRequest(42, { title: 't', body: 'b' }),
      endpoint: ['pulls', 'update'],
      params: { pull_number: 42, title: 't', body: 'b' },
    },
    {
      call: (r) =>
        r.mergePullRequest(42, { commit_title: 't', commit_message: '', sha: 'abc', merge_method: 'squash' }),
      endpoint: ['pulls', 'merge'],
      params: { pull_number: 42, commit_title: 't', commit_message: '', sha: 'abc', merge_method: 'squash' },
    },
    {
      call: (r) => r.createReviewRequest(42, { reviewers: ['rev1'], team_reviewers: ['core'] }),
      endpoint: ['pulls', 'requestReviewers'],
      params: { pull_number: 42, reviewers: ['rev1'], team_reviewers: ['core'] },
    },
    {
      call: (r) => r.approveReviewRequest(42),
      endpoint: ['pulls', 'createReview'],
      params: { pull_number: 42, event: 'APPROVE' },
    },
    {
      call: (r) => r.getCombinedStatus('abc'),
      endpoint: ['repos', 'getCombinedStatusForRef'],
      params: { ref: 'abc', per_page: 100 },
    },
  ].forEach(({ call, endpoint: [scope, method], params }) => {
    it(`should call ${scope}.${method} on the repository`, async () => {
      const res = await call(ghRepo);

      expect(res).toEqual({ data: `${scope}.${method}-data` });
      expect(octokit.rest[scope][method].mock.calls).toEqual([[{ owner: 'foo-owner', repo: 'repo-84', ...params }]]);
    });
  });

  it('should not let the parameters override the pull request number', async () => {
    await ghRepo.updatePullRequest(42, { pull_number: 1, title: 't' });
    expect(octokit.rest.pulls.update.mock.calls[0][0].pull_number).toBe(42);
  });

  it('should list every page of the open pull requests', async () => {
    const res = await ghRepo.listAllPullRequests({ state: 'open' });

    expect(res).toEqual({ data: ['page-1-item', 'page-2-item'] });
    expect(octokit.paginate.mock.calls).toEqual([
      [octokit.rest.pulls.list, { owner: 'foo-owner', repo: 'repo-84', state: 'open', per_page: 100 }],
    ]);
  });

  it('should list every page of the reviews', async () => {
    const res = await ghRepo.getReviews(42);

    expect(res).toEqual({ data: ['page-1-item', 'page-2-item'] });
    expect(octokit.paginate.mock.calls).toEqual([
      [octokit.rest.pulls.listReviews, { owner: 'foo-owner', repo: 'repo-84', pull_number: 42, per_page: 100 }],
    ]);
  });

  it('should mark a pull request ready for review with a GraphQL mutation', async () => {
    await ghRepo.markPullRequestReadyForReview('node-42');

    expect(octokit.graphql).toHaveBeenCalledTimes(1);
    const [query, variables] = octokit.graphql.mock.calls[0];
    expect(query).toMatch(/markPullRequestReadyForReview\(input: \{ pullRequestId: \$pullRequestId \}\)/);
    expect(variables).toEqual({ pullRequestId: 'node-42' });
  });

  describe('Errors', () => {
    it("should add GitHub's error details and the method name to the message", async () => {
      octokit.rest.pulls.create.mockRejectedValueOnce(
        createHttpError('Validation Failed', {
          message: 'Validation Failed',
          errors: [{ message: 'A pull request already exists for foo-owner:foo-branch.' }, 'raw error'],
        }),
      );

      await expect(ghRepo.createPullRequest({})).rejects.toThrow(
        'Error while calling createPullRequest: Validation Failed; ' +
          'A pull request already exists for foo-owner:foo-branch.; raw error: Validation Failed',
      );
    });

    it('should keep the status and the response of the error', async () => {
      const err = createHttpError('Not Found', { message: 'Not Found' });
      octokit.rest.pulls.get.mockRejectedValueOnce(err);

      const received = await ghRepo.getPullRequest(42).catch((e) => e);
      expect(received).toBe(err);
      expect(received.status).toBe(422);
      expect(received.message).toBe('Error while calling getPullRequest: Not Found: Not Found');
    });

    it('should leave errors without a GitHub response untouched', async () => {
      octokit.rest.pulls.merge.mockRejectedValueOnce(new Error('socket hang up'));
      await expect(ghRepo.mergePullRequest(42, {})).rejects.toThrow(/^socket hang up$/);
    });

    it('should wrap errors of paginated calls', async () => {
      octokit.paginate.mockRejectedValueOnce(createHttpError('Forbidden', { message: 'Resource not accessible' }));
      await expect(ghRepo.getReviews(42)).rejects.toThrow(
        'Error while calling getReviews: Resource not accessible: Forbidden',
      );
    });
  });

  describe('Octokit creation', () => {
    const originalToken = process.env.GITHUB_TOKEN;
    afterEach(() => {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    });

    it('should authenticate with GITHUB_TOKEN', () => {
      process.env.GITHUB_TOKEN = 'secret-token';
      const created = {};
      Octokit.mockImplementationOnce(() => created);

      const repo = new GitHubRepository('foo-owner', 'repo-84');

      expect(repo.octokit).toBe(created);
      expect(Octokit.mock.calls).toEqual([
        [{ auth: 'secret-token', userAgent: 'multipull', log: expect.objectContaining({ warn: console.warn }) }],
      ]);
    });
  });
});
