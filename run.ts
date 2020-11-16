import { join } from "path";
import { tmpdir } from "os";
import { v4 } from "uuid";
import { runCommandLine } from "./run-command-line";
import mkdirp = require("mkdirp");
import del = require("del");
import tar = require("tar");
import { promises } from "fs";
import { CoreProperties } from "@schemastore/package";
import { transformFileAsync } from "@babel/core";
import toSemver = require("to-semver");

(async () => {
  console.log(`Creating temporary directory...`);
  const temporaryDirectory = join(tmpdir(), v4());
  await mkdirp(temporaryDirectory);

  console.log(`Listing Hyperapp versions...`);
  const hyperappVersionsJson = await runCommandLine(
    `npm view hyperapp versions --json`,
    process.cwd()
  );
  const hyperappVersions: ReadonlyArray<string> = toSemver(
    JSON.parse(hyperappVersionsJson)
  ).reverse();

  console.log(`Listing Hyperapp-CJS versions...`);
  let hyperappCjsVersions: ReadonlyArray<string>;

  try {
    const hyperappCjsVersionsJson = await runCommandLine(
      `npm view hyperapp-cjs versions  --json`,
      process.cwd()
    );
    hyperappCjsVersions = JSON.parse(hyperappCjsVersionsJson);
  } catch (e) {
    if (
      e
        .toString()
        .includes(`npm ERR! 404 'hyperapp-cjs' is not in the npm registry.`)
    ) {
      console.log(`The package is not yet published.`);
      hyperappCjsVersions = [];
    } else {
      throw e;
    }
  }

  const newVersions = hyperappVersions.filter(
    (version) => !hyperappCjsVersions.includes(version)
  );

  for (const newVersion of newVersions) {
    console.log(`Version ${JSON.stringify(newVersion)}...`);

    console.log(`\tCreating directory...`);
    const versionDirectory = join(temporaryDirectory, v4());
    await mkdirp(versionDirectory);

    console.log(`\tRetrieving...`);
    await runCommandLine(`npm pack hyperapp@${newVersion}`, versionDirectory);

    console.log(`\tDecompressing...`);
    await tar.x({
      file: join(versionDirectory, `hyperapp-${newVersion}.tgz`),
      cwd: versionDirectory,
    });

    console.log(`\tReading package.json...`);
    const packageJsonJson = await promises.readFile(
      join(versionDirectory, `package`, `package.json`),
      `utf8`
    );
    const packageJson: CoreProperties = JSON.parse(packageJsonJson);

    if (packageJson.type === `module`) {
      console.log(`\tReplacing content...`);
      packageJson.repository = `jameswilddev/hyperapp-cjs`;
      packageJson.name = `hyperapp-cjs`;
      packageJson.description = `A mirror of Hyperapp, transpiled from a MJS to a CJS using Babel.`;
      delete packageJson.type;

      console.log(`\tWriting package.json...`);
      await promises.writeFile(
        join(versionDirectory, `package`, `package.json`),
        JSON.stringify(packageJson)
      );

      console.log(`\tWriting README.md...`);
      await promises.writeFile(
        join(versionDirectory, `package`, `README.md`),
        `# \`hyperapp-cjs\`

A mirror of [Hyperapp](https://github.com/jorgebucaran/hyperapp), transpiled from a MJS to a CJS using Babel.

If you don't know what this is, you probably don't need it.

Original readme at (https://www.npmjs.com/package/hyperapp/v/${newVersion}).
`
      );

      console.log(`\tConverting MJS to CJS...`);
      const transformed = await transformFileAsync(
        join(versionDirectory, `package`, packageJson.main as string),
        { plugins: ["@babel/plugin-transform-modules-commonjs"] }
      );

      console.log(`\tWriting...`);
      await promises.writeFile(
        join(versionDirectory, `package`, packageJson.main as string),
        transformed?.code as string
      );

      console.log(`\tDeleting map files...`);
      await del(join(versionDirectory, `**`, `*.map`), { force: true });

      console.log(`\tPublishing...`);
      await runCommandLine(`npm publish`, join(versionDirectory, `package`));
    } else {
      console.log(`\tThis is not a MJS package.`);
    }

    console.log(`\tDeleting directory...`);
    await del(versionDirectory, { force: true });
  }

  console.log(`Cleaning up temporary directory...`);
  await del(temporaryDirectory, { force: true });
})().then(
  () => {
    console.log(`Done.`);
    process.exit(0);
  },
  (err: Error) => {
    console.error(`Error: ${err}.`);
    process.exit(1);
  }
);
