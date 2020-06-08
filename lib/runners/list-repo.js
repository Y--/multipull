const { s } = require('../helpers/utils');

module.exports = [
  {
    async runner(context, repo) {
      const branch = context.getWorkingBranch();
      const sg = context.getGitAPI(repo);

      await sg.fetch(['origin']);

      try {
        await sg.revparse(['--verify', 'origin/' + branch]);
        return true;
      } catch (err) {
        return false;
      }
    },
  },
  {
    single: true,
    async runner(context, verifyResults) {
      const repos = [];
      for (const { repo, res } of verifyResults) {
        if (res) {
          repos.push(repo);
        }
      }

      const n = repos.length;
      console.log(`Branch '${context.getWorkingBranch()}' was found in ${n} repo${s(n)}:`);
      console.log(repos.join(', '));
      process.exit();
    },
  },
];
