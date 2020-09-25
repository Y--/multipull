const { s } = require('../helpers/utils');
const simpleGit = require('../helpers/simple-git');
const CleanTable = require('../helpers/clean-table');
const colors = require('colors/safe');

const factory = (context) => context.config.openprs ? listOpenPrsSpecs() : listBranchesSpecs();
factory.isFactory = true;

module.exports = factory;


function listOpenPrsSpecs() {
  return [{
    async runner(context, repo) {
      const ghRepo = await context.getGitHubAPI(repo);
      return simpleGit.listOpenPullRequests(ghRepo);
    },
  },
  {
    single: true,
    async runner(context, results) {
      const head = ['', 'Author', 'URL', 'Date', 'Title'];
      const table = new CleanTable({ head });
      for (const { repo, res } of results) {
        if (res.length === 0) {
          continue;
        }

        for (const pr of res) {
          const line = [pr.user.login, context.toPrintableUrl(pr.html_url), simpleDate(pr.created_at), cleanTitle(pr.title)];
          table.push({ [repo]: line });
        }
      }

      console.log(table.toString());
    },
  }];
}

function listBranchesSpecs() {
  return [{
    single: true,
    runner(context) {
      context.total = 0;
    }
  },
  {
    async runner(context, repo) {
      const branch = context.getWorkingBranch();
      const sg = context.getGitAPI(repo);

      await sg.fetch(['origin']);

      try {
        await sg.revparse(['--verify', 'origin/' + branch]);
      } catch (err) {
        if (err.message.includes('Needed a single revision')) {
          return null; // Branch doesn't exist
        }

        throw err;
      }

      context.total++;
      const ghRepo = await context.getGitHubAPI(repo);
      return { repo, branch, owner: ghRepo.__owner };
    },
  },
  {
    single: true,
    async runner(context, results) {
      const branch = context.getWorkingBranch();
      console.log(`Branch '${branch}' was found in ${context.total} repo${s(context.total)}:`);
      const encodedBranch = encodeURIComponent(branch);
      for (const { repo, res } of results) {
        if (!res) {
          continue;
        }

        console.log(`* ${context.toPrintableUrl(`https://github.com/${res.owner}/${repo}/tree/${encodedBranch}`, repo)}`);
      }
    },
  }];
}

function cleanTitle(title) {
  if (!title.startsWith('PR ')) {
    return title;
  }

  if (title.startsWith('PR from `') || title.startsWith('PR on `')) {
    return title.split('`')[1];
  }

  return title;
}


function simpleDate(date) {
  const d = new Date(date);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const now = new Date();
  if (year !== now.getFullYear()) {
    return colors.red(`${month}/${day}/${year}`);
  }

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const monthDiff = (now - d) / THIRTY_DAYS_MS;
  const dateTxt = `${month}/${day}`;
  if (monthDiff < 1) {
    return dateTxt;
  } else if (monthDiff < 2) {
    return colors.yellow(dateTxt);
  } else {
    return colors.red(dateTxt);
  }
}
