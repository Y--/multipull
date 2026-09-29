const debug = require('debug')('pullrepo:lib:helper:github');

const USER_AGENT = 'multipull';
const MARK_READY_FOR_REVIEW_MUTATION = `mutation ($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) { clientMutationId }
}`;

// Thin layer on top of Octokit, bound to one repository. Every REST method resolves to `{ data }`
// like Octokit, and errors are rewritten to mention the method and GitHub's error details.
class GitHubRepository {
  constructor(owner, repo, octokit = createOctokit()) {
    this.owner = owner;
    this.repo = repo;
    this.octokit = octokit;
  }

  listPullRequests(options) {
    return this._call('listPullRequests', () => this.octokit.rest.pulls.list(this._params(options)));
  }

  listAllPullRequests(options) {
    return this._call('listAllPullRequests', async () => {
      const data = await this.octokit.paginate(
        this.octokit.rest.pulls.list,
        this._params({ per_page: 100, ...options }),
      );
      return { data };
    });
  }

  getPullRequest(number) {
    return this._call('getPullRequest', () => this.octokit.rest.pulls.get(this._params({ pull_number: number })));
  }

  createPullRequest(params) {
    return this._call('createPullRequest', () => this.octokit.rest.pulls.create(this._params(params)));
  }

  updatePullRequest(number, params) {
    return this._call('updatePullRequest', () =>
      this.octokit.rest.pulls.update(this._params({ ...params, pull_number: number })),
    );
  }

  mergePullRequest(number, params) {
    return this._call('mergePullRequest', () =>
      this.octokit.rest.pulls.merge(this._params({ ...params, pull_number: number })),
    );
  }

  createReviewRequest(number, { reviewers, team_reviewers }) {
    return this._call('createReviewRequest', () =>
      this.octokit.rest.pulls.requestReviewers(this._params({ pull_number: number, reviewers, team_reviewers })),
    );
  }

  approveReviewRequest(number) {
    return this._call('approveReviewRequest', () =>
      this.octokit.rest.pulls.createReview(this._params({ pull_number: number, event: 'APPROVE' })),
    );
  }

  getReviews(number) {
    return this._call('getReviews', async () => {
      const params = this._params({ pull_number: number, per_page: 100 });
      const data = await this.octokit.paginate(this.octokit.rest.pulls.listReviews, params);
      return { data };
    });
  }

  getCombinedStatus(ref) {
    return this._call('getCombinedStatus', () =>
      this.octokit.rest.repos.getCombinedStatusForRef(this._params({ ref, per_page: 100 })),
    );
  }

  markPullRequestReadyForReview(pullRequestId) {
    return this._call('markPullRequestReadyForReview', () =>
      this.octokit.graphql(MARK_READY_FOR_REVIEW_MUTATION, { pullRequestId }),
    );
  }

  _params(params) {
    return { owner: this.owner, repo: this.repo, ...params };
  }

  async _call(methodName, fn) {
    debug.enabled && debug(`Calling ${methodName} on ${this.owner}/${this.repo}...`);
    try {
      return await fn();
    } catch (err) {
      const details = extractErrors(err);
      if (details) {
        err.message = `Error while calling ${methodName}: ${details}: ${err.message}`;
      }
      throw err;
    }
  }
}

function createOctokit() {
  const { Octokit } = require('@octokit/rest'); // ESM-only package: relies on require(esm) (Node >= 22.12)
  // Failed requests are already reported by the callers: only show Octokit's logs with DEBUG, except warnings
  const log = { debug, info: debug, warn: console.warn, error: debug };
  return new Octokit({ auth: process.env.GITHUB_TOKEN, userAgent: USER_AGENT, log });
}

function extractErrors(err) {
  const parts = [];
  const data = err.response && err.response.data;
  if (data && data.message) {
    parts.push(data.message);
  }

  // REST validation errors. GraphQL errors are already listed in the message of Octokit's GraphqlResponseError.
  const errors = data && data.errors;
  if (Array.isArray(errors)) {
    parts.push(...errors.map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e))));
  }

  return parts.join('; ');
}

module.exports = { GitHubRepository };
